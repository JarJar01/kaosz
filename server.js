'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = Number(process.env.PORT || 3000);
const MAP_LENGTH = 1100;
const GROUND_Y = 430;
const SPAWN_SAFE_ZONE = { left: 0, right: 260, top: 315, bottom: 440 };
const GOAL_SAFE_ZONE = { left: 948, right: 1098, top: 250, bottom: 422 };
const OBJECT_DELETE_COST = 8;
const OBJECT_MOVE_COST = 12;
const PLATFORM_LAYOUTS = {
  meadow: [
    { x: 0, width: 290, top: 430 }, { x: 324, width: 128, top: 475 },
    { x: 475, width: 166, top: 395 }, { x: 665, width: 142, top: 428 },
    { x: 830, width: 116, top: 470 }, { x: 958, width: 142, top: 390 }
  ],
  moon: [
    { x: 0, width: 290, top: 430 }, { x: 315, width: 130, top: 405 },
    { x: 470, width: 160, top: 360 }, { x: 660, width: 145, top: 410 },
    { x: 825, width: 120, top: 375 }, { x: 958, width: 142, top: 390 }
  ],
  mars: [
    { x: 0, width: 300, top: 430 }, { x: 330, width: 135, top: 455 },
    { x: 490, width: 150, top: 395 }, { x: 670, width: 140, top: 445 },
    { x: 835, width: 115, top: 400 }, { x: 958, width: 142, top: 390 }
  ],
  city: [
    { x: 0, width: 300, top: 430 }, { x: 320, width: 130, top: 450 },
    { x: 472, width: 160, top: 385 }, { x: 660, width: 150, top: 420 },
    { x: 838, width: 112, top: 365 }, { x: 958, width: 142, top: 390 }
  ]
};
function platformsForTheme(theme) { return PLATFORM_LAYOUTS[theme] || PLATFORM_LAYOUTS.meadow; }
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
  shield: { name: 'Pajzs', cost: 20 },
  lifebuoy: { name: 'Mentőöv', cost: 30 },
  jumpboots: { name: 'Ugrócsizma', cost: 35 }
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
function obstacleBounds(type, x, groundY) {
  if (type === 'crate') return { left: x - 21, right: x + 21, top: groundY - 39, bottom: groundY };
  if (type === 'saw') return { left: x - 25, right: x + 25, top: groundY - 47, bottom: groundY + 2 };
  if (type === 'spikes') return { left: x - 27, right: x + 27, top: groundY - 30, bottom: groundY + 4 };
  if (type === 'spring') return { left: x - 26, right: x + 26, top: groundY - 40, bottom: groundY + 4 };
  if (type === 'barrel') return { left: x - 23, right: x + 23, top: groundY - 37, bottom: groundY + 3 };
  return { left: x - 20, right: x + 20, top: groundY - 30, bottom: groundY + 3 };
}
function overlapsRect(a, b, gap = 0) {
  return a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;
}
function getRoom(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}
function getPlayer(room, id) { return room.players.find(p => p.id === id); }
function publicPlayer(p) {
  return {
    id: p.id, name: p.name, animal: p.animal, joinOrder: p.joinOrder, startX: p.startX,
    x: p.x, y: p.y, face: p.face, moving: p.moving, jumping: p.jumping,
    score: p.score, gold: p.gold, shields: p.shields, lifebuoys: p.lifebuoys || 0, jumpBoosts: p.jumpBoosts || 0, finished: p.finished,
    finishRank: p.finishRank, deaths: p.deaths, connected: p.connected
  };
}
function publicRoom(room) {
  return {
    code: room.code, hostId: room.hostId, settings: { ...room.settings },
    phase: room.phase, roundNo: room.roundNo, players: room.players.map(publicPlayer),
    obstacles: room.obstacles.map(o => ({ ...o })), chat: room.chat.slice(-40),
    roundDeadline: room.roundDeadline, raceStartsAt: room.raceStartsAt, currentBuilderId: room.currentBuilderId,
    buildQueue: room.buildQueue.slice(), buildTurnEndsAt: room.buildTurnEndsAt,
    lastResults: room.lastResults.map(r => ({ ...r })), winnerId: room.winnerId,
    serverNow: Date.now(), statusMessage: room.statusMessage
  };
}
function emitRoom(room) { io.to(room.code).emit('roomState', publicRoom(room)); }
function emitPositions(room) {
  io.to(room.code).emit('playersMoved', room.players.map(p => ({
    id: p.id, name: p.name, animal: p.animal, joinOrder: p.joinOrder, startX: p.startX,
    x: p.x, y: p.y, face: p.face, moving: p.moving, jumping: p.jumping,
    score: p.score, gold: p.gold, shields: p.shields, lifebuoys: p.lifebuoys || 0, jumpBoosts: p.jumpBoosts || 0, finished: p.finished,
    finishRank: p.finishRank, deaths: p.deaths
  })));
}
function pushChat(room, name, text, system = false, kind = '') {
  room.chat.push({ name, text: String(text).slice(0, 260), system, kind, time: Date.now() });
  if (room.chat.length > 50) room.chat.splice(0, room.chat.length - 50);
  io.to(room.code).emit('chatUpdated', room.chat.slice(-40));
}
function createPlayer(socket, payload) {
  const animal = ANIMALS.has(payload && payload.animal) ? payload.animal : 'pig';
  return {
    id: socket.id, name: cleanName(payload && payload.name), animal, joinOrder: nextJoinOrder++,
    startX: 45, x: 45, y: 0, face: 1, moving: false, jumping: false,
    score: 0, gold: 100, shields: 0, lifebuoys: 0, jumpBoosts: 0, finished: false, finishRank: null, deaths: 0,
    connected: true, maxMilestonePaid: 0, hitCooldownUntil: 0
  };
}
function normalizeSettings(raw, currentCount = 0) {
  raw = raw || {};
  return {
    maxPlayers: clamp(Math.round(Number(raw.maxPlayers) || 8), Math.max(2, currentCount), 8),
    startGold: clamp(Math.round(raw.startGold === 0 || raw.startGold === '0' ? 0 : (Number(raw.startGold) || 100)), 0, 9999),
    roundSeconds: clamp(Math.round(Number(raw.roundSeconds) || 45), 15, 600),
    buildSeconds: clamp(Math.round(Number(raw.buildSeconds) || 30), 5, 180),
    rounds: clamp(Math.round(Number(raw.rounds) || 5), 1, 12),
    mapTheme: ['meadow', 'moon', 'mars', 'city'].includes(String(raw.mapTheme || 'meadow')) ? String(raw.mapTheme || 'meadow') : 'meadow',
    mapLength: MAP_LENGTH
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
function resetPlayerForRace(p, index = 0) {
  // Slightly stagger the starting spots so all chosen animals and nameplates remain visible.
  // The entire group still begins on the left-most starting platform.
  p.startX = 36 + index * 28;
  p.x = p.startX; p.y = 0; p.face = 1; p.moving = false; p.jumping = false;
  p.finished = false; p.finishRank = null; p.maxMilestonePaid = 0; p.hitCooldownUntil = 0;
}
function platformAtX(x, padding = 24, theme = 'meadow') {
  return platformsForTheme(theme).find(p => x >= p.x + padding && x <= p.x + p.width - padding) || null;
}
function defaultObstacles(theme = 'meadow') {
  // A few starter hazards are placed on reachable platforms for each world.
  const ps = platformsForTheme(theme);
  const placeOn = (index, offset = 0) => ({ x: Math.round(ps[index].x + ps[index].width / 2 + offset), groundY: ps[index].top });
  return [
    { id: 'course-crate', type: 'crate', ...placeOn(1), ownerId: null, ownerName: 'Pálya', createdRound: 0, builtIn: true },
    { id: 'course-spikes', type: 'spikes', ...placeOn(2, 14), ownerId: null, ownerName: 'Pálya', createdRound: 0, builtIn: true },
    { id: 'course-saw', type: 'saw', ...placeOn(4), ownerId: null, ownerName: 'Pálya', createdRound: 0, builtIn: true }
  ];
}
function startNewGame(room) {
  clearRoomTimer(room);
  room.roundNo = 0; room.obstacles = defaultObstacles(room.settings.mapTheme); room.lastResults = []; room.winnerId = null; room.raceStartsAt = null;
  room.players.forEach(p => {
    p.score = 0; p.gold = room.settings.startGold; p.shields = 0; p.lifebuoys = 0; p.jumpBoosts = 0; p.deaths = 0; p.maxMilestonePaid = 0;
  });
  pushChat(room, 'RENDSZER', 'Új verseny indul! Építsetek okosan, és jussatok el a zászlóhoz.', true);
  startRound(room);
}
function startRound(room) {
  clearRoomTimer(room);
  room.roundNo += 1;
  const countdownMs = 3500;
  room.phase = 'race';
  room.raceStartsAt = Date.now() + countdownMs;
  room.roundDeadline = room.raceStartsAt + room.settings.roundSeconds * 1000;
  room.currentBuilderId = null; room.buildQueue = []; room.buildTurnEndsAt = null;
  room.lastResults = [];
  [...room.players].sort((a, b) => a.joinOrder - b.joinOrder).forEach((p, index) => resetPlayerForRace(p, index));
  const isLastRound = room.roundNo === room.settings.rounds;
  room.statusMessage = isLastRound
    ? `🔥 ${room.roundNo}/${room.settings.rounds} – UTOLSÓ KÖR! GYERÜNK, VADÁLLATOK!`
    : `Rajt 3… 2… 1… Mindenki egyszerre indul!`;
  pushChat(room, 'RENDSZER', isLastRound
    ? `🔥 ${room.roundNo}/${room.settings.rounds} – UTOLSÓ KÖR! GYERÜNK, VADÁLLATOK!`
    : `A(z) ${room.roundNo}. kör rajtol 3… 2… 1…` , true);
  emitRoom(room); emitPositions(room);
  const expectedRound = room.roundNo;
  setTimeout(() => {
    if (rooms.get(room.code) === room && room.phase === 'race' && room.roundNo === expectedRound) {
      room.statusMessage = isLastRound ? '🔥 UTOLSÓ KÖR! Hajrá, vadállatok!' : 'MEHET! Érj elsőként a zászlóhoz!';
      pushChat(room, 'RENDSZER', '🟢 MEHET! A verseny elindult!', true);
      emitRoom(room);
    }
  }, countdownMs);
  room.timer = setTimeout(() => {
    if (rooms.get(room.code) === room && room.phase === 'race' && room.roundNo === expectedRound) endRound(room, 'time');
  }, countdownMs + room.settings.roundSeconds * 1000);
}
function finishPlayer(room, player) {
  if (room.phase !== 'race' || player.finished) return;
  player.finished = true;
  player.finishRank = room.players.filter(p => p.finished).length;
  const rankIndex = player.finishRank - 1;
  const pointsReward = SCORE_BY_RANK[rankIndex] || 10;
  const goldReward = GOLD_BY_RANK[rankIndex] || 5;
  player.score += pointsReward;
  player.gold += goldReward;
  player.x = room.settings.mapLength - 66;
  player.y = platformsForTheme(room.settings.mapTheme).slice(-1)[0].top - GROUND_Y;
  player.moving = false;
  const finishText = player.finishRank === 1
    ? `🏆 ELSŐ HELYEZETT: ${player.name}! +${pointsReward} pont és +${goldReward} arany a célba érésért!`
    : `🏁 ${player.name} célba ért a(z) ${player.finishRank}. helyen. Jutalom: +${pointsReward} pont, +${goldReward} arany.`;
  pushChat(room, 'CÉLBA ÉRÉS', finishText, true, player.finishRank === 1 ? 'first-place' : 'finish');
  emitPositions(room); emitRoom(room);
  if (room.players.every(p => p.finished)) endRound(room, 'finished');
}
function endRound(room, reason) {
  if (room.phase !== 'race') return;
  clearRoomTimer(room);
  room.phase = 'build'; room.roundDeadline = null; room.raceStartsAt = null;
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
  const turnSeconds = room.settings.buildSeconds || 30;
  room.buildTurnEndsAt = Date.now() + turnSeconds * 1000;
  const builder = getPlayer(room, room.currentBuilderId);
  room.statusMessage = builder ? `${builder.name} most építkezik. Több tárgyat is lerakhat, amíg van aranya.` : 'Építkezés folyamatban.';
  pushChat(room, 'RENDSZER', `🔨 ${builder ? builder.name : 'A következő játékos'} most építkezik (${turnSeconds} mp).`, true);
  emitRoom(room);
  const expectedId = room.currentBuilderId;
  const expectedDeadline = room.buildTurnEndsAt;
  room.timer = setTimeout(() => {
    if (room.phase === 'build' && room.currentBuilderId === expectedId && room.buildTurnEndsAt === expectedDeadline) {
      pushChat(room, 'RENDSZER', `${builder ? builder.name : 'A játékos'} építkezési ideje lejárt.`, true);
      room.buildIndex += 1;
      beginBuildTurn(room);
    }
  }, turnSeconds * 1000);
}
function endGame(room) {
  clearRoomTimer(room);
  room.phase = 'ended'; room.roundDeadline = null; room.raceStartsAt = null; room.currentBuilderId = null; room.buildTurnEndsAt = null;
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
      obstacles: [], chat: [], roundDeadline: null, raceStartsAt: null, timer: null,
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
    if (room.raceStartsAt && Date.now() < room.raceStartsAt) return;
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
    const goalTop = platformsForTheme(room.settings.mapTheme).slice(-1)[0].top;
    // The flag only counts when the player has actually landed on its platform,
    // not merely when they pass the x coordinate while falling or jumping below it.
    if (p.x >= room.settings.mapLength - 90 && Math.abs((GROUND_Y + p.y) - goalTop) <= 32) finishPlayer(room, p);
    else emitPositions(room);
  });

  socket.on('fellOffCourse', () => {
    const room = getRoom(socket); if (!room || room.phase !== 'race') return;
    const p = getPlayer(room, socket.id); if (!p || p.finished) return;
    // The optional lifebuoy rescues one fall and returns the player to the last platform.
    if ((p.lifebuoys || 0) > 0) {
      p.lifebuoys -= 1;
      const platforms = platformsForTheme(room.settings.mapTheme);
      const lastPlatform = [...platforms].reverse().find(surface => surface.x < p.x - 10) || platforms[0];
      p.x = clamp(p.x - 45, lastPlatform.x + 14, lastPlatform.x + lastPlatform.width - 14);
      p.y = lastPlatform.top - GROUND_Y;
      p.face = 1; p.moving = false; p.jumping = false;
      p.hitCooldownUntil = Date.now() + 650;
      pushChat(room, 'RENDSZER', `🛟 ${p.name} mentőöve megmentette az eséstől!`, true);
      emitPositions(room); emitRoom(room); return;
    }
    p.deaths += 1;
    p.x = p.startX ?? 36; p.y = 0; p.face = 1; p.moving = false; p.jumping = false;
    p.hitCooldownUntil = Date.now() + 650;
    pushChat(room, 'RENDSZER', `💦 ${p.name} leesett a pályáról, és visszakerült a rajthoz.`, true);
    emitPositions(room); emitRoom(room);
  });

  socket.on('useJumpBoost', (_payload = {}, ack = () => {}) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'race' || (room.raceStartsAt && Date.now() < room.raceStartsAt)) return ack({ ok: false, error: 'Most nem használható az ugrócsizma.' });
    const p = getPlayer(room, socket.id);
    if (!p || p.finished || !(p.jumpBoosts > 0)) return ack({ ok: false, error: 'Nincs töltött ugrócsizmád.' });
    p.jumpBoosts -= 1;
    emitRoom(room);
    ack({ ok: true, jumpBoosts: p.jumpBoosts });
  });

  socket.on('hitHazard', (payload = {}, ack = () => {}) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'race' || (room.raceStartsAt && Date.now() < room.raceStartsAt)) return ack({ ok: false, error: 'Most még nem aktív a verseny.' });
    const p = getPlayer(room, socket.id);
    if (!p || p.finished) return ack({ ok: false, error: 'Ez a játékos már nem versenyez.' });
    if (Date.now() < p.hitCooldownUntil) return ack({ ok: false, error: 'A csapda még nem aktiválható újra.' });
    const obstacle = room.obstacles.find(o => o.id === payload.id);
    if (!obstacle || obstacle.type === 'crate' || Math.abs(p.x - obstacle.x) > 82) return ack({ ok: false, error: 'A csapdaérintés nem érvényes.' });
    const obstacleGround = Number.isFinite(obstacle.groundY) ? obstacle.groundY : GROUND_Y;
    const playerFeet = GROUND_Y + p.y;
    const playerTop = playerFeet - 42;
    // Position packets arrive slightly after collision due to network latency.
    // Use each sprite's actual rectangle with a small network tolerance instead
    // of requiring exact feet-to-object alignment.
    const boxes = {
      saw: { left: obstacle.x - 25, right: obstacle.x + 25, top: obstacleGround - 47, bottom: obstacleGround + 2 },
      spikes: { left: obstacle.x - 27, right: obstacle.x + 27, top: obstacleGround - 30, bottom: obstacleGround + 4 },
      spring: { left: obstacle.x - 26, right: obstacle.x + 26, top: obstacleGround - 40, bottom: obstacleGround + 4 },
      barrel: { left: obstacle.x - 23, right: obstacle.x + 23, top: obstacleGround - 37, bottom: obstacleGround + 3 }
    };
    const b = boxes[obstacle.type];
    if (!b || p.x + 11 < b.left - 14 || p.x - 11 > b.right + 14 || playerFeet + 2 < b.top - 54 || playerTop > b.bottom + 54) {
      return ack({ ok: false, error: 'A karakter még nincs a csapda közelében.' });
    }
    p.hitCooldownUntil = Date.now() + 850;
    let action = 'death';
    if (obstacle.type === 'spring') {
      // The local client applies the spring impulse immediately. Keeping the
      // server Y here avoids an authoritative snap that fights the jump arc.
      action = 'spring';
      p.jumping = true;
      pushChat(room, 'RENDSZER', `${p.name} felrepült a rugós kilövővel!`, true);
    } else if (p.shields > 0) {
      p.shields -= 1;
      p.x = clamp(p.x - 62, p.startX ?? 36, room.settings.mapLength - 40);
      p.moving = false; p.jumping = true;
      action = 'shield';
      pushChat(room, 'RENDSZER', `🛡️ ${p.name} pajzsa megvédte a csapdától!`, true);
    } else {
      p.deaths += 1; p.x = p.startX ?? 36; p.y = 0; p.moving = false; p.jumping = false;
      action = 'death';
      pushChat(room, 'RENDSZER', `💥 ${p.name} belefutott egy csapdába, és visszakerült a rajthoz!`, true);
    }
    emitPositions(room); emitRoom(room);
    ack({ ok: true, action });
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
    } else if (type === 'lifebuoy') {
      p.gold -= item.cost; p.lifebuoys = (p.lifebuoys || 0) + 1;
      pushChat(room, 'RENDSZER', `🛟 ${p.name} vásárolt egy mentőövet. Egy esést megúszhat vele.`, true);
    } else if (type === 'jumpboots') {
      p.gold -= item.cost; p.jumpBoosts = (p.jumpBoosts || 0) + 1;
      pushChat(room, 'RENDSZER', `🥾 ${p.name} vásárolt egy ugrócsizmát. A következő ugrása magasabb lesz.`, true);
    } else {
      // Placeable at any visible world coordinate: ground, platform, water area or air.
      const rawX = Number(payload.x);
      const rawGroundY = Number(payload.groundY);
      const x = clamp(Math.round(Number.isFinite(rawX) ? rawX : 28), 28, MAP_LENGTH - 28);
      const groundY = clamp(Math.round(Number.isFinite(rawGroundY) ? rawGroundY : GROUND_Y), 50, 600);
      // Keep only a small square around the goal flag clear, allowing building
      // elsewhere on the course, in mid-air or over water.
      const candidateBounds = obstacleBounds(type, x, groundY);
      if (overlapsRect(candidateBounds, SPAWN_SAFE_ZONE)) return ack({ ok: false, error: 'A rajt körüli védett mezőbe nem lehet építeni!' });
      if (overlapsRect(candidateBounds, GOAL_SAFE_ZONE)) return ack({ ok: false, error: 'A zászló körüli kis négyzetet szabadon kell hagyni!' });
      // Every object has a matching hitbox; reject placements that would overlap
      // an existing object, so players cannot stack traps or crates on each other.
      const collides = room.obstacles.some(o => overlapsRect(candidateBounds, obstacleBounds(o.type, Number(o.x) || 0, Number.isFinite(o.groundY) ? o.groundY : GROUND_Y), 1));
      if (collides) return ack({ ok: false, error: 'Itt már van egy tárgy — ne rakd egymásra az építményeket!' });
      p.gold -= item.cost;
      room.obstacles.push({ id: `${room.roundNo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type, x, groundY, ownerId: p.id, ownerName: p.name, createdRound: room.roundNo });
      pushChat(room, 'RENDSZER', `🔨 ${p.name} épített egyet: ${item.name}.`, true);
    }
    // A builder stays active after every purchase/placement and may keep building
    // until their configurable timer ends or they press Skip.
    emitRoom(room);
    ack({ ok: true, gold: p.gold, shields: p.shields, buildTurnEndsAt: room.buildTurnEndsAt });
  });

  socket.on('deleteObstacle', (payload = {}, ack = () => {}) => {
    const room = getRoom(socket); if (!room) return ack({ ok: false, error: 'Nem vagy szobában.' });
    const p = getPlayer(room, socket.id);
    if (room.phase !== 'build' || room.currentBuilderId !== socket.id) return ack({ ok: false, error: 'Most nem te építkezel.' });
    const index = room.obstacles.findIndex(o => o.id === String(payload.id || ''));
    if (index < 0) return ack({ ok: false, error: 'A kiválasztott tárgy már nem található.' });
    const obstacle = room.obstacles[index];
    if (p.gold < OBJECT_DELETE_COST) return ack({ ok: false, error: `A törlés ${OBJECT_DELETE_COST} aranyba kerül.` });
    p.gold -= OBJECT_DELETE_COST;
    room.obstacles.splice(index, 1);
    pushChat(room, 'RENDSZER', `🗑️ ${p.name} törölt egy építményt (${OBJECT_DELETE_COST} aranyért).`, true);
    emitRoom(room);
    ack({ ok: true, gold: p.gold, cost: OBJECT_DELETE_COST });
  });

  socket.on('moveObstacle', (payload = {}, ack = () => {}) => {
    const room = getRoom(socket); if (!room) return ack({ ok: false, error: 'Nem vagy szobában.' });
    const p = getPlayer(room, socket.id);
    if (room.phase !== 'build' || room.currentBuilderId !== socket.id) return ack({ ok: false, error: 'Most nem te építkezel.' });
    const obstacle = room.obstacles.find(o => o.id === String(payload.id || ''));
    if (!obstacle) return ack({ ok: false, error: 'A kiválasztott tárgy már nem található.' });
    if (p.gold < OBJECT_MOVE_COST) return ack({ ok: false, error: `A mozgatás ${OBJECT_MOVE_COST} aranyba kerül.` });
    const rawX = Number(payload.x), rawGroundY = Number(payload.groundY);
    const x = clamp(Math.round(Number.isFinite(rawX) ? rawX : obstacle.x), 28, MAP_LENGTH - 28);
    const groundY = clamp(Math.round(Number.isFinite(rawGroundY) ? rawGroundY : obstacle.groundY), 50, 600);
    const candidateBounds = obstacleBounds(obstacle.type, x, groundY);
    if (overlapsRect(candidateBounds, SPAWN_SAFE_ZONE)) return ack({ ok: false, error: 'A rajt körüli védett mezőbe nem lehet tárgyat mozgatni.' });
    if (overlapsRect(candidateBounds, GOAL_SAFE_ZONE)) return ack({ ok: false, error: 'A zászló körüli védett négyzetet szabadon kell hagyni.' });
    const collides = room.obstacles.some(o => o.id !== obstacle.id && overlapsRect(candidateBounds, obstacleBounds(o.type, Number(o.x) || 0, Number.isFinite(o.groundY) ? o.groundY : GROUND_Y), 1));
    if (collides) return ack({ ok: false, error: 'Itt már van egy tárgy — ne rakd egymásra az építményeket!' });
    p.gold -= OBJECT_MOVE_COST;
    obstacle.x = x; obstacle.groundY = groundY;
    pushChat(room, 'RENDSZER', `↔️ ${p.name} áthelyezett egy építményt (${OBJECT_MOVE_COST} aranyért).`, true);
    emitRoom(room);
    ack({ ok: true, gold: p.gold, cost: OBJECT_MOVE_COST });
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
  console.log('  ALLATKAOSZ 1.9 - online 2D versenyjatek');
  console.log(`  Helyben: http://localhost:${PORT}`);
  console.log('  Helyi halozaton: http://A_SZERVER_GEP_IP_CIME:' + PORT);
  console.log('  Leallitas: CTRL+C');
  console.log('==========================================');
});
