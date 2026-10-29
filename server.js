'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = Number(process.env.PORT || 3000);
const MAP_LENGTH = 1250;
const GROUND_Y = 430;
const SPAWN_SAFE_ZONE = { left: 0, right: 280, top: 315, bottom: 440 };
const GOAL_SAFE_ZONE = { left: 1090, right: 1249, top: 250, bottom: 422 };
const OBJECT_DELETE_COST = 50;
const OBJECT_DELETE_OTHER_COST = OBJECT_DELETE_COST * 2;
const OBJECT_MOVE_COST = 12;
const PLATFORM_LAYOUTS = {
  meadow: [
    { x: 0, width: 310, top: 430 }, { x: 330, width: 135, top: 450 },
    { x: 500, width: 155, top: 390 }, { x: 700, width: 145, top: 430 },
    { x: 915, width: 125, top: 445 }, { x: MAP_LENGTH - 142, width: 142, top: 390 }
  ],
  moon: [
    { x: 0, width: 310, top: 430 }, { x: 330, width: 135, top: 410 },
    { x: 500, width: 155, top: 365 }, { x: 700, width: 145, top: 410 },
    { x: 915, width: 125, top: 380 }, { x: MAP_LENGTH - 142, width: 142, top: 390 }
  ],
  mars: [
    { x: 0, width: 310, top: 430 }, { x: 330, width: 135, top: 455 },
    { x: 500, width: 155, top: 400 }, { x: 700, width: 145, top: 445 },
    { x: 915, width: 125, top: 410 }, { x: MAP_LENGTH - 142, width: 142, top: 390 }
  ],
  city: [
    { x: 0, width: 310, top: 430 }, { x: 330, width: 135, top: 445 },
    { x: 500, width: 155, top: 385 }, { x: 700, width: 145, top: 420 },
    { x: 915, width: 125, top: 370 }, { x: MAP_LENGTH - 142, width: 142, top: 390 }
  ]
};
function platformsForTheme(theme) { return PLATFORM_LAYOUTS[theme] || PLATFORM_LAYOUTS.meadow; }
function generatePlatformLayout(theme = 'meadow') {
  const base = platformsForTheme(theme);
  const rand = (amount) => Math.round((Math.random() * 2 - 1) * amount);
  const result = [];
  for (let index = 0; index < base.length; index += 1) {
    const platform = base[index];
    if (index === 0) { result.push({ ...platform }); continue; }
    if (index === base.length - 1) { result.push({ ...platform, x: MAP_LENGTH - platform.width }); continue; }
    const width = Math.max(112, Math.min(176, platform.width + rand(16)));
    const previous = result[result.length - 1];
    const minimumX = previous.x + previous.width + 18;
    const nextBaseX = base[index + 1].x;
    const maximumX = Math.min(MAP_LENGTH - 235, nextBaseX - width - 22);
    const proposedX = platform.x + rand(index === 1 ? 15 : 27);
    const topVariation = rand(index === 2 ? 27 : 25);
    const minTop = index === 2 ? 345 : 380;
    const maxTop = index === 2 ? 425 : 472;
    result.push({
      x: Math.max(minimumX, Math.min(maximumX, proposedX)),
      width,
      top: Math.max(minTop, Math.min(maxTop, platform.top + topVariation))
    });
  }
  return result;
}
function platformsForRoom(room) { return Array.isArray(room.platforms) && room.platforms.length ? room.platforms : platformsForTheme(room.settings.mapTheme); }
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, game: 'AllatKáosz' }));

const rooms = new Map();
const CUP_DATA_PATH = path.join(__dirname, 'data', 'player_cups.json');
function loadCupLedger() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CUP_DATA_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}
const cupLedger = loadCupLedger();
function cupKey(name) { return cleanName(name).toLocaleLowerCase('hu-HU'); }
function getCupCount(name) { return Math.max(0, Number(cupLedger[cupKey(name)]?.cups) || 0); }
function saveCupLedger() {
  try {
    fs.mkdirSync(path.dirname(CUP_DATA_PATH), { recursive: true });
    fs.writeFileSync(CUP_DATA_PATH, JSON.stringify(cupLedger, null, 2), 'utf8');
  } catch (err) { console.error('A kupák mentése nem sikerült:', err.message); }
}
function awardCup(name) {
  const key = cupKey(name);
  const record = cupLedger[key] || { name: cleanName(name), cups: 0 };
  record.name = cleanName(name);
  record.cups = Math.max(0, Number(record.cups) || 0) + 1;
  record.updatedAt = new Date().toISOString();
  cupLedger[key] = record;
  saveCupLedger();
  return record.cups;
}
const ANIMALS = new Set(['pig', 'capybara', 'horse', 'penguin', 'raccoon']);
const ITEMS = {
  crate: { name: 'Fa láda', cost: 10 },
  stairs: { name: 'Fa lépcső', cost: 18 },
  ladder: { name: 'Fa létra', cost: 22 },
  spikecrate: { name: 'Váltakozó tüskés láda', cost: 28 },
  spring: { name: 'Rugós kilövő', cost: 30 },
  barrel: { name: 'Díszes fahordó', cost: 25 },
  fan: { name: 'Szélfújó ventilátor', cost: 32 },
  icicle: { name: 'Leeső jégcsap', cost: 30 },
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
  if (type === 'crate' || type === 'spikecrate') return { left: x - 25, right: x + 25, top: groundY - 43, bottom: groundY };
  if (type === 'stairs') return { left: x - 34, right: x + 34, top: groundY - 42, bottom: groundY };
  if (type === 'ladder') return { left: x - 17, right: x + 17, top: groundY - 122, bottom: groundY + 2 };
  if (type === 'spring') return { left: x - 26, right: x + 26, top: groundY - 40, bottom: groundY + 4 };
  if (type === 'barrel') return { left: x - 23, right: x + 23, top: groundY - 37, bottom: groundY + 3 };
  if (type === 'fan') return { left: x - 24, right: x + 24, top: groundY - 42, bottom: groundY + 4 };
  if (type === 'icicle') return { left: x - 20, right: x + 20, top: groundY - 90, bottom: groundY + 3 };
  return { left: x - 20, right: x + 20, top: groundY - 30, bottom: groundY + 3 };
}
function spikeCrateState(obstacle, time = Date.now()) {
  // Three reliable directions: left, right, then upward. Each cycle has a short
  // extend/retract animation and a matching active collision window.
  const period = 3600;
  const phase = ((time + (Number(obstacle.spikeOffset) || 0)) % period + period) % period;
  const slot = Math.floor(phase / 1200);
  const localPhase = phase - slot * 1200;
  let progress = 0;
  if (localPhase < 180) progress = localPhase / 180;
  else if (localPhase < 720) progress = 1;
  else if (localPhase < 900) progress = (900 - localPhase) / 180;
  const side = ['left', 'right', 'top'][Math.min(2, slot)];
  return { side, progress: Math.max(0, Math.min(1, progress)), extended: progress >= 0.72, phase: localPhase };
}
function spikeCrateHazardBounds(obstacle, time = Date.now()) {
  const state = spikeCrateState(obstacle, time);
  if (!state.extended) return null;
  const x = Number(obstacle.x) || 0, groundY = Number.isFinite(obstacle.groundY) ? obstacle.groundY : GROUND_Y;
  if (state.side === 'left') return { left: x - 62, right: x - 19, top: groundY - 51, bottom: groundY - 3 };
  if (state.side === 'right') return { left: x + 19, right: x + 62, top: groundY - 51, bottom: groundY - 3 };
  // Match the visibly extended top spikes, including their pointed tips.
  return { left: x - 24, right: x + 24, top: groundY - 84, bottom: groundY - 36 };
}
function icicleTriggerBounds(obstacle) {
  const x = Number(obstacle.x) || 0, groundY = Number.isFinite(obstacle.groundY) ? obstacle.groundY : GROUND_Y;
  // Trigger zone below the hanging icicle; impact is evaluated after its fall animation.
  return { left: x - 24, right: x + 24, top: groundY - 112, bottom: groundY + 8 };
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
    x: p.x, y: p.y, vy: p.vy || 0, face: p.face, moving: p.moving, jumping: p.jumping,
    score: p.score, gold: p.gold, cups: getCupCount(p.name), shields: p.shields, lifebuoys: p.lifebuoys || 0, jumpBoosts: p.jumpBoosts || 0, finished: p.finished,
    finishRank: p.finishRank, deaths: p.deaths, knockbackCount: p.knockbackCount || 0, connected: p.connected
  };
}
function publicRoom(room) {
  return {
    code: room.code, hostId: room.hostId, settings: { ...room.settings }, platforms: platformsForRoom(room).map(p => ({ ...p })),
    phase: room.phase, roundNo: room.roundNo, players: room.players.map(publicPlayer),
    obstacles: room.obstacles.map(o => { const copy = { ...o }; delete copy.dropTargetId; return copy; }), chat: room.chat.slice(-40),
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
    x: p.x, y: p.y, vy: p.vy || 0, face: p.face, moving: p.moving, jumping: p.jumping,
    score: p.score, gold: p.gold, cups: getCupCount(p.name), shields: p.shields, lifebuoys: p.lifebuoys || 0, jumpBoosts: p.jumpBoosts || 0, finished: p.finished,
    finishRank: p.finishRank, deaths: p.deaths, knockbackCount: p.knockbackCount || 0
  })));
}
function pushChat(room, name, text, system = false, kind = '') {
  room.chat.push({ name, text: String(text).slice(0, 260), system, kind, time: Date.now() });
  if (room.chat.length > 50) room.chat.splice(0, room.chat.length - 50);
  io.to(room.code).emit('chatUpdated', room.chat.slice(-40));
}
function createPlayer(socket, payload) {
  const animal = ANIMALS.has(payload && payload.animal) ? payload.animal : 'pig';
  const name = cleanName(payload && payload.name);
  return {
    id: socket.id, name, animal, joinOrder: nextJoinOrder++,
    startX: 45, x: 45, y: 0, face: 1, moving: false, jumping: false,
    score: 0, gold: 100, cups: getCupCount(name), shields: 0, lifebuoys: 0, jumpBoosts: 0, finished: false, finishRank: null, deaths: 0, knockbackCount: 0,
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
  p.x = p.startX; p.y = 0; p.vy = 0; p.face = 1; p.moving = false; p.jumping = false;
  p.finished = false; p.finishRank = null; p.maxMilestonePaid = 0; p.hitCooldownUntil = 0;
}
function platformAtX(x, padding = 24, theme = 'meadow') {
  return platformsForTheme(theme).find(p => x >= p.x + padding && x <= p.x + p.width - padding) || null;
}
function defaultObstacles(platforms) {
  // Each new game gets a fresh layout. These starter objects are placed on real platforms.
  const ps = Array.isArray(platforms) ? platforms : platformsForTheme('meadow');
  const placeOn = (index, offset = 0) => ({ x: Math.round(ps[index].x + ps[index].width / 2 + offset), groundY: ps[index].top });
  return [
    { id: 'course-crate', type: 'crate', ...placeOn(1, 8), ownerId: null, ownerName: 'Pálya', createdRound: 0, builtIn: true },
    { id: 'course-spikecrate', type: 'spikecrate', ...placeOn(2, -28), spikeOffset: Math.floor(Math.random() * 3000), ownerId: null, ownerName: 'Pálya', createdRound: 0, builtIn: true },
    { id: 'course-barrel', type: 'barrel', ...placeOn(3, 12), ownerId: null, ownerName: 'Pálya', createdRound: 0, builtIn: true },
    { id: 'course-stairs', type: 'stairs', ...placeOn(4, -8), ownerId: null, ownerName: 'Pálya', createdRound: 0, builtIn: true }
  ];
}
function startNewGame(room) {
  clearRoomTimer(room);
  room.roundNo = 0;
  room.platforms = generatePlatformLayout(room.settings.mapTheme);
  room.obstacles = defaultObstacles(room.platforms);
  room.lastResults = []; room.winnerId = null; room.raceStartsAt = null; room.cupAwarded = false;
  room.players.forEach(p => {
    p.score = 0; p.gold = room.settings.startGold; p.shields = 0; p.lifebuoys = 0; p.jumpBoosts = 0; p.deaths = 0; p.knockbackCount = 0; p.maxMilestonePaid = 0;
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
  player.y = platformsForRoom(room).slice(-1)[0].top - GROUND_Y;
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
  room.roundDeadline = null; room.raceStartsAt = null;
  room.lastRoundResults = [...room.players].sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return (a.finishRank || 99) - (b.finishRank || 99) || b.x - a.x;
  }).map((p, i) => ({ id: p.id, name: p.name, animal: p.animal, finished: p.finished, finishRank: p.finishRank, x: p.x, gold: p.gold, score: p.score, roundPlace: p.finished ? p.finishRank : null }));

  // The final (e.g. 5/5) round ends directly on the results screen; nobody gets a pointless last build turn.
  if (room.roundNo >= room.settings.rounds) {
    room.statusMessage = reason === 'finished' ? '🏁 Az utolsó kör véget ért! Eredményhirdetés következik.' : '⏱️ Lejárt az idő az utolsó körben! Eredményhirdetés következik.';
    pushChat(room, 'RENDSZER', room.statusMessage, true);
    endGame(room);
    return;
  }

  room.phase = 'build';
  room.statusMessage = reason === 'finished' ? 'Mindenki célba ért! Építkezési fázis következik.' : 'Lejárt az idő! Aki nem ért célba, erre a körre nem kap célba érési pontot.';
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
  if (room.phase === 'ended') return;
  clearRoomTimer(room);
  const sorted = [...room.players].sort((a, b) => b.score - a.score || b.gold - a.gold);
  room.winnerId = sorted[0] ? sorted[0].id : null;
  if (sorted[0] && !room.cupAwarded) {
    const winner = sorted[0];
    const newCupCount = awardCup(winner.name);
    room.cupAwarded = true;
    room.players.forEach(p => { p.cups = getCupCount(p.name); });
    pushChat(room, 'KUPA', `🏆 ${winner.name} megnyerte a versenyt és kapott 1 kupát! Összesen: ${newCupCount} kupa.`, true, 'cup');
  }
  room.phase = 'ended'; room.roundDeadline = null; room.raceStartsAt = null; room.currentBuilderId = null; room.buildTurnEndsAt = null;
  room.lastResults = sorted.map((p, i) => ({ id: p.id, name: p.name, animal: p.animal, score: p.score, gold: p.gold, cups: getCupCount(p.name), finalPlace: i + 1, finished: p.finished }));
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
      platforms: generatePlatformLayout(settings.mapTheme), obstacles: [], chat: [], roundDeadline: null, raceStartsAt: null, timer: null,
      currentBuilderId: null, buildQueue: [], buildIndex: 0, buildTurnEndsAt: null,
      lastResults: [], winnerId: null, cupAwarded: false, statusMessage: 'Várjuk a játékosokat!'
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
    player.cups = getCupCount(player.name);
    if (ANIMALS.has(payload.animal)) player.animal = payload.animal;
    ack({ ok: true }); emitRoom(room);
  });

  socket.on('updateSettings', (payload = {}, ack = () => {}) => {
    const room = getRoom(socket); if (!room) return ack({ ok: false, error: 'Nem vagy szobában.' });
    if (room.hostId !== socket.id) return ack({ ok: false, error: 'Csak a szobagazda állíthatja a beállításokat.' });
    if (room.phase !== 'lobby') return ack({ ok: false, error: 'A játék már elindult.' });
    room.settings = normalizeSettings(payload, room.players.length);
    room.platforms = generatePlatformLayout(room.settings.mapTheme);
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
    p.vy = clamp(Number(payload.vy) || 0, -900, 900);
    p.face = Number(payload.face) < 0 ? -1 : 1;
    p.moving = !!payload.moving; p.jumping = !!payload.jumping;
    const milestone = Math.floor(p.x / 250);
    if (milestone > p.maxMilestonePaid) {
      p.gold += (milestone - p.maxMilestonePaid) * 4;
      p.maxMilestonePaid = milestone;
    }
    const goalTop = platformsForRoom(room).slice(-1)[0].top;
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
      const platforms = platformsForRoom(room);
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
    const now = Date.now();
    if (now < p.hitCooldownUntil) return ack({ ok: false, error: 'A csapda még nem aktiválható újra.' });
    const obstacle = room.obstacles.find(o => o.id === payload.id);
    if (!obstacle || ['crate', 'stairs', 'ladder', 'barrel', 'fan'].includes(obstacle.type) || Math.abs(p.x - obstacle.x) > 100) return ack({ ok: false, error: 'Ez nem aktiválható csapda, vagy nem vagy a közelében.' });
    const obstacleGround = Number.isFinite(obstacle.groundY) ? obstacle.groundY : GROUND_Y;
    const playerFeet = GROUND_Y + p.y;
    const playerTop = playerFeet - 42;
    let b = null;
    if (obstacle.type === 'spikecrate') b = spikeCrateHazardBounds(obstacle, now);
    else if (obstacle.type === 'spring') b = { left: obstacle.x - 26, right: obstacle.x + 26, top: obstacleGround - 40, bottom: obstacleGround + 4 };
    else if (obstacle.type === 'icicle') b = icicleTriggerBounds(obstacle);
    else b = null;
    const playerRect = { left: p.x - 13, right: p.x + 13, top: playerTop, bottom: playerFeet + 3 };
    if (!b || !overlapsRect(playerRect, b, 5)) return ack({ ok: false, error: 'A csapda még nincs aktív helyzetben, vagy nem értél hozzá.' });

    if (obstacle.type === 'icicle') {
      if (Number(obstacle.cooldownUntil) > now || obstacle.dropTargetId) return ack({ ok: false, error: 'A jégcsapnak még vissza kell húzódnia.' });
      // Trigger now, show the fall animation, then apply the hit only if the
      // player is still under it when it reaches the player-height zone.
      obstacle.dropStartedAt = now;
      obstacle.cooldownUntil = now + 1800;
      obstacle.dropTargetId = p.id;
      pushChat(room, 'RENDSZER', `❄️ A jégcsap lezuhan ${p.name} fölött!`, true);
      emitRoom(room);
      ack({ ok: true, action: 'icicleStarted' });
      const roomCode = room.code, obstacleId = obstacle.id, playerId = p.id;
      setTimeout(() => {
        if (rooms.get(roomCode) !== room) return;
        const currentObstacle = room.obstacles.find(o => o.id === obstacleId);
        if (!currentObstacle || currentObstacle.dropTargetId !== playerId) return;
        currentObstacle.dropTargetId = null;
        if (room.phase !== 'race') { emitRoom(room); return; }
        const target = room.players.find(player => player.id === playerId);
        if (!target || target.finished) { emitRoom(room); return; }
        const currentNow = Date.now();
        const currentGround = Number.isFinite(currentObstacle.groundY) ? currentObstacle.groundY : GROUND_Y;
        const targetFeet = GROUND_Y + target.y;
        const targetRect = { left: target.x - 13, right: target.x + 13, top: targetFeet - 42, bottom: targetFeet + 3 };
        const impactBounds = { left: currentObstacle.x - 23, right: currentObstacle.x + 23, top: currentGround - 58, bottom: currentGround + 10 };
        if (!overlapsRect(targetRect, impactBounds, 2) || currentNow < target.hitCooldownUntil) {
          pushChat(room, 'RENDSZER', `❄️ ${target.name} kitért a leeső jégcsap elől!`, true);
          emitRoom(room);
          return;
        }
        target.hitCooldownUntil = currentNow + 900;
        if (target.shields > 0) {
          target.shields -= 1;
          target.x = clamp(target.x - 62, target.startX ?? 36, room.settings.mapLength - 40);
          target.moving = false; target.jumping = true;
          pushChat(room, 'RENDSZER', `🛡️ ${target.name} pajzsa kivédte a leeső jégcsapot!`, true);
        } else {
          target.deaths += 1; target.x = target.startX ?? 36; target.y = 0; target.moving = false; target.jumping = false;
          pushChat(room, 'RENDSZER', `🧊 ${target.name} eltalálta a leeső jégcsap, vissza a rajthoz!`, true);
        }
        emitPositions(room); emitRoom(room);
      }, 520);
      return;
    }

    p.hitCooldownUntil = now + 900;
    let action = 'death';
    if (obstacle.type === 'spring') {
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
      pushChat(room, 'RENDSZER', `💥 ${p.name} belefutott egy tüskés csapdába, és visszakerült a rajthoz!`, true);
    }
    emitPositions(room); emitRoom(room);
    ack({ ok: true, action, x: p.x, y: p.y, knockbackCount: p.knockbackCount || 0 });
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
      room.obstacles.push({ id: `${room.roundNo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type, x, groundY, ...(type === 'spikecrate' ? { spikeOffset: Math.floor(Math.random() * 3000) } : {}), ownerId: p.id, ownerName: p.name, createdRound: room.roundNo });
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
    // Saját objektum törlése 50 arany, más játékosé vagy pályaelemé 100 arany.
    const deleteCost = obstacle.ownerId === p.id ? OBJECT_DELETE_COST : OBJECT_DELETE_OTHER_COST;
    if (p.gold < deleteCost) return ack({ ok: false, error: `Ennek a tárgynak a törlése ${deleteCost} aranyba kerül.` });
    p.gold -= deleteCost;
    room.obstacles.splice(index, 1);
    pushChat(room, 'RENDSZER', `🗑️ ${p.name} törölt egy építményt (${deleteCost} aranyért).`, true);
    emitRoom(room);
    ack({ ok: true, gold: p.gold, cost: deleteCost });
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
  console.log('  ALLATKAOSZ 1.15.1 - online 2D versenyjatek');
  console.log(`  Helyben: http://localhost:${PORT}`);
  console.log('  Helyi halozaton: http://A_SZERVER_GEP_IP_CIME:' + PORT);
  console.log('  Leallitas: CTRL+C');
  console.log('==========================================');
});
