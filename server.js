'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = Number(process.env.PORT || 3000);
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, game: 'AllatKáosz' }));

const rooms = new Map();
const ANIMALS = new Set(['pig', 'capybara', 'horse', 'penguin', 'raccoon']);
const ITEMS = {
  crate: { name: 'Csapdaláda', cost: 10 },
  saw: { name: 'Forgó fűrész', cost: 25 },
  spikes: { name: 'Tüskék', cost: 20 },
  spring: { name: 'Rugós kilövő', cost: 30 },
  barrel: { name: 'Guruló hordó', cost: 25 },
  shield: { name: 'Pajzs', cost: 20 }
};
const SCORE_BY_RANK = [100, 75, 55, 40, 30, 25, 20, 15];
const GOLD_BY_RANK = [30, 24, 20, 16, 13, 11, 9, 7];
let nextJoinOrder = 1;

function cleanName(value) {
  const name = String(value || '').trim().replace(/[<>]/g, '').slice(0, 16);
  return name || 'Játékos';
}
function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(''); }
  while (rooms.has(code));
  return code;
}
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function getRoom(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}
function getPlayer(room, id) { return room.players.find(p => p.id === id); }
function publicPlayer(p) {
  return {
    id: p.id, name: p.name, animal: p.animal, joinOrder: p.joinOrder,
    x: p.x, y: p.y, face: p.face, moving: p.moving, jumping: p.jumping,
    score: p.score, gold: p.gold, shields: p.shields, finished: p.finished,
    finishRank: p.finishRank, deaths: p.deaths, connected: p.connected
  };
}
function publicRoom(room) {
  return {
    code: room.code, hostId: room.hostId, settings: { ...room.settings },
    phase: room.phase, roundNo: room.roundNo, players: room.players.map(publicPlayer),
    obstacles: room.obstacles.map(o => ({ ...o })), chat: room.chat.slice(-40),
    roundDeadline: room.roundDeadline, currentBuilderId: room.currentBuilderId,
    buildQueue: room.buildQueue.slice(), buildTurnEndsAt: room.buildTurnEndsAt,
    lastResults: room.lastResults.map(r => ({ ...r })), winnerId: room.winnerId,
    serverNow: Date.now(), statusMessage: room.statusMessage
  };
}
function emitRoom(room) { io.to(room.code).emit('roomState', publicRoom(room)); }
function emitPositions(room) {
  io.to(room.code).emit('playersMoved', room.players.map(p => ({
    id: p.id, x: p.x, y: p.y, face: p.face, moving: p.moving, jumping: p.jumping,
    score: p.score, gold: p.gold, shields: p.shields, finished: p.finished,
    finishRank: p.finishRank, deaths: p.deaths
  })));
}
function pushChat(room, name, text, system = false) {
  room.chat.push({ name, text: String(text).slice(0, 260), system, time: Date.now() });
  if (room.chat.length > 50) room.chat.splice(0, room.chat.length - 50);
  io.to(room.code).emit('chatUpdated', room.chat.slice(-40));
}
function createPlayer(socket, payload) {
  const animal = ANIMALS.has(payload && payload.animal) ? payload.animal : 'pig';
  return {
    id: socket.id, name: cleanName(payload && payload.name), animal, joinOrder: nextJoinOrder++,
    x: 45, y: 0, face: 1, moving: false, jumping: false,
    score: 0, gold: 100, shields: 0, finished: false, finishRank: null, deaths: 0,
    connected: true, maxMilestonePaid: 0, hitCooldownUntil: 0
  };
}
function normalizeSettings(raw, currentCount = 0) {
  raw = raw || {};
  return {
    maxPlayers: clamp(Math.round(Number(raw.maxPlayers) || 8), Math.max(2, currentCount), 8),
    startGold: clamp(Math.round(raw.startGold === 0 || raw.startGold === '0' ? 0 : (Number(raw.startGold) || 100)), 0, 9999),
    roundSeconds: clamp(Math.round(Number(raw.roundSeconds) || 45), 15, 600),
    rounds: clamp(Math.round(Number(raw.rounds) || 5), 1, 12),
    mapLength: clamp(Math.round(Number(raw.mapLength) || 2200), 1500, 3600)
  };
}
function roomForSocket(socket) {
  const room = getRoom(socket);
  if (!room) throw new Error('Nem vagy szobában.');
  return room;
}
function clearRoomTimer(room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
}
function resetPlayerForRace(p) {
  p.x = 45; p.y = 0; p.face = 1; p.moving = false; p.jumping = false;
  p.finished = false; p.finishRank = null; p.maxMilestonePaid = 0; p.hitCooldownUntil = 0;
}
function startNewGame(room) {
  clearRoomTimer(room);
  room.roundNo = 0; room.obstacles = []; room.lastResults = []; room.winnerId = null;
  room.players.forEach(p => {
    p.score = 0; p.gold = room.settings.startGold; p.shields = 0; p.deaths = 0; p.maxMilestonePaid = 0;
  });
  pushChat(room, 'RENDSZER', 'Új verseny indul! Építsetek okosan, és jussatok el a zászlóhoz.', true);
  startRound(room);
}
function startRound(room) {
  clearRoomTimer(room);
  room.roundNo += 1;
  room.phase = 'race'; room.roundDeadline = Date.now() + room.settings.roundSeconds * 1000;
  room.currentBuilderId = null; room.buildQueue = []; room.buildTurnEndsAt = null;
  room.lastResults = [];
  room.players.forEach(resetPlayerForRace);
  room.statusMessage = `Verseny! ${room.settings.roundSeconds} másodpercetek van a célba érni.`;
  pushChat(room, 'RENDSZER', `A(z) ${room.roundNo}. kör elindult! Mindenki egyszerre rajtol.`, true);
  emitRoom(room); emitPositions(room);
  const expectedRound = room.roundNo;
  room.timer = setTimeout(() => {
    if (rooms.get(room.code) === room && room.phase === 'race' && room.roundNo === expectedRound) endRound(room, 'time');
  }, room.settings.roundSeconds * 1000);
}
function finishPlayer(room, player) {
  if (room.phase !== 'race' || player.finished) return;
  player.finished = true;
  player.finishRank = room.players.filter(p => p.finished).length;
  const rankIndex = player.finishRank - 1;
  player.score += SCORE_BY_RANK[rankIndex] || 10;
  player.gold += GOLD_BY_RANK[rankIndex] || 5;
  player.x = room.settings.mapLength - 66;
  player.y = 0;
  player.moving = false;
  pushChat(room, 'RENDSZER', `🏁 ${player.name} beért a(z) ${player.finishRank}. helyen! +${SCORE_BY_RANK[rankIndex] || 10} pont.`, true);
  emitPositions(room); emitRoom(room);
  if (room.players.every(p => p.finished)) endRound(room, 'finished');
}
function endRound(room, reason) {
  if (room.phase !== 'race') return;
  clearRoomTimer(room);
  room.phase = 'build'; room.roundDeadline = null;
  room.lastResults = [...room.players].sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return (a.finishRank || 99) - (b.finishRank || 99) || b.x - a.x;
  }).map((p, i) => ({ id: p.id, name: p.name, animal: p.animal, finished: p.finished, finishRank: p.finishRank, x: p.x, gold: p.gold, score: p.score, roundPlace: p.finished ? p.finishRank : null }));
  room.statusMessage = reason === 'finished' ? 'Mindenki célba ért! Építkezési fázis következik.' : 'Lejárt az idő! Aki nem ért célba, erre a körre nem kap célba érési pontot.';
  // Fair one-by-one build order, rotating the first player every round.
  const ordered = [...room.players].sort((a, b) => a.joinOrder - b.joinOrder);
  if (ordered.length) {
    const rotate = (room.roundNo - 1) % ordered.length;
    room.buildQueue = ordered.slice(rotate).concat(ordered.slice(0, rotate)).map(p => p.id);
  } else room.buildQueue = [];
  room.buildIndex = 0;
  pushChat(room, 'RENDSZER', room.statusMessage, true);
  beginBuildTurn(room);
  emitRoom(room);
}
function beginBuildTurn(room) {
  clearRoomTimer(room);
  if (room.phase !== 'build') return;
  if (room.buildIndex >= room.buildQueue.length) {
    if (room.roundNo >= room.settings.rounds) { endGame(room); return; }
    startRound(room); return;
  }
  room.currentBuilderId = room.buildQueue[room.buildIndex];
  room.buildTurnEndsAt = Date.now() + 20000;
  const builder = getPlayer(room, room.currentBuilderId);
  room.statusMessage = builder ? `${builder.name} építkezik. Helyezzen el egy akadályt, vagy vásároljon pajzsot.` : 'Építkezés folyamatban.';
  emitRoom(room);
  const expectedId = room.currentBuilderId;
  room.timer = setTimeout(() => {
    if (room.phase === 'build' && room.currentBuilderId === expectedId) {
      pushChat(room, 'RENDSZER', `${builder ? builder.name : 'A játékos'} ideje lejárt; kimaradt az építésből.`, true);
      room.buildIndex += 1;
      beginBuildTurn(room);
    }
  }, 20000);
}
function endGame(room) {
  clearRoomTimer(room);
  room.phase = 'ended'; room.roundDeadline = null; room.currentBuilderId = null; room.buildTurnEndsAt = null;
  const sorted = [...room.players].sort((a, b) => b.score - a.score || b.gold - a.gold);
  room.winnerId = sorted[0] ? sorted[0].id : null;
  room.lastResults = sorted.map((p, i) => ({ id: p.id, name: p.name, animal: p.animal, score: p.score, gold: p.gold, finalPlace: i + 1, finished: p.finished }));
  room.statusMessage = sorted[0] ? `🏆 ${sorted[0].name} lett a verseny győztese!` : 'A verseny véget ért.';
  pushChat(room, 'RENDSZER', room.statusMessage, true);
  emitRoom(room);
}
function advanceBuild(room) {
  clearRoomTimer(room);
  room.buildIndex += 1;
  beginBuildTurn(room);
}

io.on('connection', socket => {
  socket.on('createRoom', (payload = {}, ack = () => {}) => {
    const code = makeCode();
    const player = createPlayer(socket, payload);
    const settings = normalizeSettings(payload.settings, 1);
    player.gold = settings.startGold;
    const room = {
      code, hostId: socket.id, settings, players: [player], phase: 'lobby', roundNo: 0,
      obstacles: [], chat: [], roundDeadline: null, timer: null,
      currentBuilderId: null, buildQueue: [], buildIndex: 0, buildTurnEndsAt: null,
      lastResults: [], winnerId: null, statusMessage: 'Várjuk a játékosokat!'
    };
    rooms.set(code, room); socket.join(code); socket.data.roomCode = code;
    pushChat(room, 'RENDSZER', `${player.name} létrehozta a szobát.`, true);
    ack({ ok: true, code }); emitRoom(room);
  });

  socket.on('joinRoom', (payload = {}, ack = () => {}) => {
    const code = String(payload.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: 'Nincs ilyen szobakód.' });
    if (room.phase !== 'lobby') return ack({ ok: false, error: 'Ez a játék már elkezdődött.' });
    if (room.players.length >= room.settings.maxPlayers) return ack({ ok: false, error: 'Megtelt a szoba.' });
    const player = createPlayer(socket, payload);
    player.gold = room.settings.startGold;
    room.players.push(player); socket.join(code); socket.data.roomCode = code;
    pushChat(room, 'RENDSZER', `${player.name} csatlakozott.`, true);
    ack({ ok: true, code }); emitRoom(room);
  });

  socket.on('updateIdentity', (payload = {}, ack = () => {}) => {
    const room = getRoom(socket); if (!room) return ack({ ok: false, error: 'Nem vagy szobában.' });
    const player = getPlayer(room, socket.id); if (!player) return ack({ ok: false, error: 'Játékos nem található.' });
    if (room.phase !== 'lobby') return ack({ ok: false, error: 'Játék közben most nem változtatható.' });
    player.name = cleanName(payload.name);
    if (ANIMALS.has(payload.animal)) player.animal = payload.animal;
    ack({ ok: true }); emitRoom(room);
  });

  socket.on('updateSettings', (payload = {}, ack = () => {}) => {
    const room = getRoom(socket); if (!room) return ack({ ok: false, error: 'Nem vagy szobában.' });
    if (room.hostId !== socket.id) return ack({ ok: false, error: 'Csak a szobagazda állíthatja a beállításokat.' });
    if (room.phase !== 'lobby') return ack({ ok: false, error: 'A játék már elindult.' });
    room.settings = normalizeSettings(payload, room.players.length);
    room.players.forEach(p => { if (p.gold === room.settings.startGold || p.score === 0) p.gold = room.settings.startGold; });
    emitRoom(room); ack({ ok: true });
  });

  socket.on('startGame', (_payload, ack = () => {}) => {
    const room = getRoom(socket); if (!room) return ack({ ok: false, error: 'Nem vagy szobában.' });
    if (room.hostId !== socket.id) return ack({ ok: false, error: 'Csak a szobagazda indíthatja el.' });
    if (room.phase !== 'lobby' && room.phase !== 'ended') return ack({ ok: false, error: 'A játék már fut.' });
    if (room.players.length < 2) return ack({ ok: false, error: 'Legalább 2 játékos kell az induláshoz.' });
    startNewGame(room); ack({ ok: true });
  });

  socket.on('playerPosition', (payload = {}) => {
    const room = getRoom(socket); if (!room || room.phase !== 'race') return;
    const p = getPlayer(room, socket.id); if (!p || p.finished) return;
    const maxX = room.settings.mapLength - 40;
    p.x = clamp(Number(payload.x) || p.x, 0, maxX);
    p.y = clamp(Number(payload.y) || 0, -220, 800);
    p.face = Number(payload.face) < 0 ? -1 : 1;
    p.moving = !!payload.moving; p.jumping = !!payload.jumping;
    const milestone = Math.floor(p.x / 250);
    if (milestone > p.maxMilestonePaid) {
      p.gold += (milestone - p.maxMilestonePaid) * 4;
      p.maxMilestonePaid = milestone;
    }
    if (p.x >= room.settings.mapLength - 95) finishPlayer(room, p);
    else emitPositions(room);
  });

  socket.on('hitHazard', (payload = {}) => {
    const room = getRoom(socket); if (!room || room.phase !== 'race') return;
    const p = getPlayer(room, socket.id); if (!p || p.finished || Date.now() < p.hitCooldownUntil) return;
    const obstacle = room.obstacles.find(o => o.id === payload.id);
    if (!obstacle || Math.abs(p.x - obstacle.x) > 105) return;
    p.hitCooldownUntil = Date.now() + 850;
    if (obstacle.type === 'spring') {
      p.y = -145; p.x = Math.min(room.settings.mapLength - 100, p.x + 18);
      pushChat(room, 'RENDSZER', `${p.name} felrepült a rugós kilövővel!`, true);
    } else if (obstacle.type === 'crate') {
      return;
    } else if (p.shields > 0) {
      p.shields -= 1; p.x = Math.max(45, p.x - 90); p.y = 0;
      pushChat(room, 'RENDSZER', `🛡️ ${p.name} pajzsa megvédte a csapdától!`, true);
    } else {
      p.deaths += 1; p.x = 45; p.y = 0; p.moving = false; p.jumping = false;
      pushChat(room, 'RENDSZER', `💥 ${p.name} belefutott egy csapdába, és visszakerült a rajthoz!`, true);
    }
    emitPositions(room); emitRoom(room);
  });

  socket.on('placeBuild', (payload = {}, ack = () => {}) => {
    const room = getRoom(socket); if (!room) return ack({ ok: false, error: 'Nem vagy szobában.' });
    const p = getPlayer(room, socket.id);
    if (room.phase !== 'build' || room.currentBuilderId !== socket.id) return ack({ ok: false, error: 'Most nem te építkezel.' });
    const type = String(payload.type || ''); const item = ITEMS[type];
    if (!item) return ack({ ok: false, error: 'Ismeretlen építmény.' });
    if (p.gold < item.cost) return ack({ ok: false, error: 'Nincs elég aranyad ehhez.' });
    if (type === 'shield') {
      p.gold -= item.cost; p.shields += 1;
      pushChat(room, 'RENDSZER', `🛡️ ${p.name} vásárolt egy pajzsot.`, true);
    } else {
      const x = clamp(Math.round(Number(payload.x) || 0), 220, room.settings.mapLength - 180);
      if (room.obstacles.some(o => Math.abs(o.x - x) < (type === 'crate' ? 66 : 88))) return ack({ ok: false, error: 'Túl közel van egy másik akadályhoz; válassz másik helyet.' });
      p.gold -= item.cost;
      room.obstacles.push({ id: `${room.roundNo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type, x, ownerId: p.id, ownerName: p.name, createdRound: room.roundNo });
      pushChat(room, 'RENDSZER', `🔨 ${p.name} épített egyet: ${item.name}.`, true);
    }
    ack({ ok: true });
    room.buildIndex += 1; beginBuildTurn(room); emitRoom(room);
  });

  socket.on('skipBuild', (_payload, ack = () => {}) => {
    const room = getRoom(socket); if (!room) return ack({ ok: false, error: 'Nem vagy szobában.' });
    if (room.phase !== 'build' || room.currentBuilderId !== socket.id) return ack({ ok: false, error: 'Most nem te építkezel.' });
    pushChat(room, 'RENDSZER', `${getPlayer(room, socket.id).name} kihagyta az építkezést.`, true);
    room.buildIndex += 1; beginBuildTurn(room); ack({ ok: true });
  });

  socket.on('chat', (payload = {}, ack = () => {}) => {
    const room = getRoom(socket); if (!room) return ack({ ok: false, error: 'Nem vagy szobában.' });
    const player = getPlayer(room, socket.id); const message = String(payload.text || '').trim().slice(0, 260);
    if (!message) return ack({ ok: false, error: 'Írj egy üzenetet.' });
    pushChat(room, player ? player.name : 'Játékos', message, false); ack({ ok: true });
  });

  socket.on('leaveRoom', () => { leaveRoom(socket); });
  socket.on('disconnect', () => { leaveRoom(socket); });
});

function leaveRoom(socket) {
  const room = getRoom(socket); if (!room) return;
  const p = getPlayer(room, socket.id);
  if (p) {
    room.players = room.players.filter(x => x.id !== socket.id);
    pushChat(room, 'RENDSZER', `${p.name} kilépett a szobából.`, true);
  }
  socket.leave(room.code);
  socket.data.roomCode = null;
  if (!room.players.length) {
    clearRoomTimer(room); rooms.delete(room.code); return;
  }
  if (room.hostId === socket.id) {
    room.hostId = room.players[0].id;
    pushChat(room, 'RENDSZER', `${room.players[0].name} lett az új szobagazda.`, true);
  }
  if (room.phase === 'build') {
    const leftIndex = room.buildQueue.indexOf(socket.id);
    const wasCurrentBuilder = room.currentBuilderId === socket.id;
    if (leftIndex >= 0) {
      room.buildQueue.splice(leftIndex, 1);
      if (leftIndex < room.buildIndex) room.buildIndex -= 1;
    }
    if (wasCurrentBuilder) beginBuildTurn(room);
    else emitRoom(room);
  } else if (room.phase === 'race' && room.players.length && room.players.every(x => x.finished)) {
    endRound(room, 'finished');
  }
  emitRoom(room); emitPositions(room);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('==========================================');
  console.log('  ALLATKAOSZ - online 2D versenyjatek');
  console.log(`  Helyben: http://localhost:${PORT}`);
  console.log('  Helyi halozaton: http://A_SZERVER_GEP_IP_CIME:' + PORT);
  console.log('  Leallitas: CTRL+C');
  console.log('==========================================');
});
