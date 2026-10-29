'use strict';
const socket = io();
const $ = (id) => document.getElementById(id);
const ANIMALS = {
  pig: { label: 'Malac', emoji: '🐷', color: '#f18ba1' },
  capybara: { label: 'Kapibara', emoji: '🦫', color: '#a87548' },
  horse: { label: 'Ló', emoji: '🐴', color: '#a75e36' },
  penguin: { label: 'Pingvin', emoji: '🐧', color: '#202c42' },
  raccoon: { label: 'Mosómedve', emoji: '🦝', color: '#8b98a8' }
};
// Local SVG sprite sheets: two leg poses per animal, drawn as crisp vector art.
const ANIMAL_SPRITES = Object.create(null);
for (const animalType of Object.keys(ANIMALS)) {
  const image = new Image();
  image.src = `/assets/animals/${animalType}.svg`;
  ANIMAL_SPRITES[animalType] = image;
}
const MAPS = { meadow: '🌳 Kezdő mező', moon: '🌙 Hold', mars: '🔴 Mars', city: '🌆 Város' };
const ITEMS = [
  { type: 'crate', name: 'Csapdaláda', icon: '📦', price: 10, desc: 'Ugorjátok át!' },
  { type: 'saw', name: 'Forgó fűrész', icon: '⚙️', price: 25, desc: 'Halálos csapda' },
  { type: 'spikes', name: 'Tüskék', icon: '🔺', price: 20, desc: 'Egy rossz lépés…' },
  { type: 'spring', name: 'Rugós kilövő', icon: '🌀', price: 30, desc: 'Magasra repít' },
  { type: 'barrel', name: 'Guruló hordó', icon: '🛢️', price: 25, desc: 'Veszélyes akadály' },
  { type: 'shield', name: 'Pajzs', icon: '🛡️', price: 20, desc: 'Egy csapdát kivéd' },
  { type: 'lifebuoy', name: 'Mentőöv', icon: '🛟', price: 30, desc: 'Egy leesést megúszol' },
  { type: 'jumpboots', name: 'Ugrócsizma', icon: '🥾', price: 35, desc: 'A következő ugrásod magasabb' }
];
const EDIT_TOOLS = [
  { type: 'delete-tool', name: 'Objektum törlése', icon: '🗑️', price: 8, desc: 'Saját 8, másé 16 arany' },
  { type: 'move-tool', name: 'Objektum mozgatása', icon: '↔️', price: 12, desc: 'Egy pályatárgy áthelyezése' }
];
let roomState = null;
let livePlayers = [];
let currentScreen = 'home';
let currentRenderedPhase = null;
let selectedBuildType = null;
let movingObstacleId = null;
let preferredName = '';
let toastTimeout = null;
let buildNoticeTimer = null;
let buildNoticeTurnKey = null;
let lastTick = performance.now();
let lastSendAt = 0;
let keys = Object.create(null);
let lastHitAt = Object.create(null);
let lastDeathCount = 0;
let lastShieldCount = 0;
let lastLifebuoyCount = 0;
let lastChromeUpdate = 0;
let jumpBoostActiveThisJump = false;
let lastFallAt = 0;
let physicsAccumulator = 0;
let remoteVisuals = new Map();
let sceneCache = { theme: null, canvas: null };
let lastObservedRoundKey = '';
let lastRoundBannerUntil = 0;
let serverClockOffset = 0;
function synchronizedNow() { return Date.now() + serverClockOffset; }
let motion = { x: 45, y: 0, vy: 0, face: 1, moving: false, jumping: false, grounded: true, coyoteUntil: 0, pauseUntil: 0 };
let mouseWorld = null;
let jumpQueuedUntil = 0;
let jumpHeld = false;
let jumpLaunchedByW = false;
let jumpHoldElapsed = 0;
let activeJumpHoldForce = 2150;
let activeJumpMaxPower = -625;
const JUMP_BUFFER_MS = 180;
const JUMP_START_POWER = -210;
const JUMP_HOLD_MAX_SECONDS = 0.26;
const JUMP_HOLD_FORCE = 2150;
const JUMP_FULL_POWER = -625;
const COYOTE_TIME_MS = 140;
let rafId = null;

const screenHome = $('screenHome');
const screenLobby = $('screenLobby');
const screenGame = $('screenGame');

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove('show'), 2800);
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}
function getMe() { return roomState?.players?.find(p => p.id === socket.id); }
function getLivePlayer(id) { return livePlayers.find(p => p.id === id); }
function switchScreen(which) {
  currentScreen = which;
  document.body.classList.toggle('game-mode', which === 'game');
  screenHome.classList.toggle('hidden', which !== 'home');
  screenLobby.classList.toggle('hidden', which !== 'lobby');
  screenGame.classList.toggle('hidden', which !== 'game');
}
function emitAck(event, data, successMessage) {
  socket.emit(event, data, result => {
    if (!result?.ok) toast(result?.error || 'Valami nem sikerült.');
    else if (successMessage) toast(successMessage);
  });
}

socket.on('connect', () => { $('connectionLabel').textContent = 'Kapcsolódva'; $('connectionLabel').style.color = '#78e5a8'; const hud = $('gameConnectionLabel'); if (hud) { hud.textContent = 'Kapcsolódva'; hud.style.color = '#78e5a8'; } });
socket.on('disconnect', () => { $('connectionLabel').textContent = 'Kapcsolat megszakadt'; $('connectionLabel').style.color = '#ff7c8d'; const hud = $('gameConnectionLabel'); if (hud) { hud.textContent = 'Kapcsolat megszakadt'; hud.style.color = '#ff7c8d'; } toast('Megszakadt a kapcsolat a szerverrel.'); });
socket.on('connect_error', () => { $('connectionLabel').textContent = 'Kapcsolódási hiba'; const hud = $('gameConnectionLabel'); if (hud) { hud.textContent = 'Kapcsolódási hiba'; hud.style.color = '#ff7c8d'; } });
socket.on('roomState', next => {
  const priorPhase = roomState?.phase;
  const priorCode = roomState?.code;
  const priorRoundNo = roomState?.roundNo;
  roomState = next;
  if (Number.isFinite(Number(next.serverNow))) serverClockOffset = Number(next.serverNow) - Date.now();
  const roundKey = `${next.code}:${next.roundNo}`;
  if (next.phase === 'race' && next.roundNo !== priorRoundNo && roundKey !== lastObservedRoundKey) {
    lastObservedRoundKey = roundKey;
    lastRoundBannerUntil = next.roundNo === next.settings.rounds ? synchronizedNow() + 4700 : 0;
  }
  if (priorCode !== next.code) { sceneCache = { theme: null, canvas: null }; lastObservedRoundKey = ''; lastRoundBannerUntil = 0; }
  livePlayers = (next.players || []).map(p => ({ ...p }));
  if (priorCode !== next.code) { selectedBuildType = null; movingObstacleId = null; }
  if (next.phase === 'lobby') {
    currentRenderedPhase = 'lobby'; renderLobby();
  } else if (next.phase === 'race' || next.phase === 'build') {
    const phaseChanged = currentScreen !== 'game' || currentRenderedPhase !== next.phase || priorCode !== next.code;
    if (phaseChanged) {
      currentRenderedPhase = next.phase;
      physicsAccumulator = 0;
      remoteVisuals = new Map((next.players || []).map(p => [p.id, {
        x: Number(p.x) || 0, y: Number(p.y) || 0,
        deaths: Number(p.deaths) || 0, finished: !!p.finished
      }]));
      if (next.phase === 'race') {
        const me = next.players.find(p => p.id === socket.id);
        motion = { x: me?.x ?? me?.startX ?? 45, y: me?.y ?? 0, vy: 0, face: 1, moving: false, jumping: false, grounded: true, coyoteUntil: 0, pauseUntil: 0 };
        lastDeathCount = me?.deaths ?? 0; lastShieldCount = me?.shields ?? 0; lastLifebuoyCount = me?.lifebuoys ?? 0;
        lastFallAt = 0; lastSendAt = 0;
        jumpQueuedUntil = 0; jumpHeld = false; jumpLaunchedByW = false; jumpHoldElapsed = 0; activeJumpHoldForce = JUMP_HOLD_FORCE; activeJumpMaxPower = JUMP_FULL_POWER; jumpBoostActiveThisJump = false;
      }
      if (next.phase !== 'build' || next.currentBuilderId !== socket.id) { selectedBuildType = null; movingObstacleId = null; }
      renderGame();
    } else {
      updateGameChrome(); updateScoreList(); updateChat();
      if (next.phase === 'build') updateBuildControls();
    }
  } else if (next.phase === 'ended') {
    currentRenderedPhase = 'ended'; renderEndScreen();
  }
});
socket.on('playersMoved', positions => {
  if (!roomState) return;
  // The fast movement packet contains only positions. Merge it into the complete
  // player record so animal/name/score never disappear between server updates.
  const byId = new Map(positions.map(p => [p.id, p]));
  roomState.players = (roomState.players || []).map(old => ({ ...old, ...(byId.get(old.id) || {}) }));
  livePlayers = roomState.players.map(p => ({ ...p }));
  const me = byId.get(socket.id);
  if (me && currentScreen === 'game' && roomState.phase === 'race') {
    // Keep the local avatar locally simulated. Replacing its coordinates with
    // every network snapshot causes visible shaking while jumping (packets arrive
    // later than the local physics frame). Only snap on explicit server teleports.
    const deathCount = Number(me.deaths) || 0;
    const shieldCount = Number(me.shields) || 0;
    const lifebuoyCount = Number(me.lifebuoys) || 0;
    const rescued = lifebuoyCount < lastLifebuoyCount;
    const respawned = deathCount > lastDeathCount || rescued;
    const shieldKnockback = shieldCount < lastShieldCount;
    if (respawned || shieldKnockback) {
      motion.x = Number.isFinite(Number(me.x)) ? Number(me.x) : (getMe()?.startX ?? 36);
      motion.y = Number.isFinite(Number(me.y)) ? Number(me.y) : 0;
      motion.vy = shieldKnockback && !respawned ? -260 : 0;
      motion.moving = false;
      motion.grounded = respawned ? true : false;
      motion.jumping = shieldKnockback && !respawned;
      motion.coyoteUntil = 0;
      motion.pauseUntil = performance.now() + (respawned ? 170 : 90);
      jumpQueuedUntil = 0; jumpLaunchedByW = false; jumpBoostActiveThisJump = false;
    }
    lastDeathCount = deathCount; lastShieldCount = shieldCount; lastLifebuoyCount = lifebuoyCount;
    if (me.finished) { motion.x = me.x; motion.y = me.y || 0; motion.vy = 0; motion.moving = false; motion.grounded = true; motion.jumping = false; }
  }
  updateScoreList();
});
socket.on('chatUpdated', messages => { if (roomState) roomState.chat = messages; updateChat(); });

$('createRoomBtn').addEventListener('click', () => {
  preferredName = $('homeName').value.trim() || 'Játékos';
  socket.emit('createRoom', { name: preferredName, animal: 'pig' }, result => {
    if (!result?.ok) toast(result?.error || 'Nem sikerült szobát létrehozni.');
  });
});
$('joinRoomBtn').addEventListener('click', () => {
  preferredName = $('joinName').value.trim() || 'Játékos';
  const code = $('roomCodeInput').value.trim().toUpperCase();
  if (!code) return toast('Írd be a szobakódot.');
  socket.emit('joinRoom', { code, name: preferredName, animal: 'pig' }, result => {
    if (!result?.ok) toast(result?.error || 'Nem sikerült csatlakozni.');
  });
});
$('roomCodeInput').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); });
$('brandHome').addEventListener('click', e => { e.preventDefault(); if (roomState) { socket.emit('leaveRoom'); roomState = null; livePlayers = []; currentRenderedPhase = null; } switchScreen('home'); });
$('helpButton').addEventListener('click', () => $('helpModal').classList.remove('hidden'));
$('closeHelp').addEventListener('click', () => $('helpModal').classList.add('hidden'));
$('helpModal').addEventListener('click', e => { if (e.target === $('helpModal')) $('helpModal').classList.add('hidden'); });

function renderLobby() {
  if (!roomState) return;
  switchScreen('lobby');
  const me = getMe();
  const isHost = roomState.hostId === socket.id;
  const players = roomState.players;
  const s = roomState.settings;
  const animalCards = Object.entries(ANIMALS).map(([key, animal]) => `
    <button class="animal-choice ${me?.animal === key ? 'selected' : ''}" data-animal="${key}" type="button">
      ${me?.animal === key ? '<span class="selected-label">KIVÁLASZTVA</span>' : ''}
      <span class="animal-sprite-preview"><img src="/assets/animals/${key}.svg" alt="" loading="eager"></span><strong>${animal.label}</strong>
    </button>`).join('');
  const playerRows = players.map(p => `
    <div class="player-row"><div class="player-avatar"><span class="animal-mini-sprite"><img src="/assets/animals/${ANIMALS[p.animal] ? p.animal : 'pig'}.svg" alt=""></span></div><div class="player-meta"><strong>${escapeHtml(p.name)} ${p.id === socket.id ? '<span class="muted">(Te)</span>' : ''}</strong><small>${ANIMALS[p.animal]?.label || 'Állat'} · ${p.connected ? 'Készen áll' : 'Kilépett'}</small></div>${p.id === roomState.hostId ? '<span class="host-tag">👑 GAZDA</span>' : ''}</div>`).join('');
  const waitingRows = Array.from({ length: Math.max(0, s.maxPlayers - players.length) }, () => '<div class="player-row waiting-row"><div class="player-avatar">＋</div><div class="player-meta"><strong>Várjuk a játékost…</strong><small>Szobakóddal csatlakozhat</small></div></div>').join('');
  screenLobby.innerHTML = `
    <div class="lobby-heading"><div><h1>🐾 ÁllatKáosz — váróterem</h1><p>Válassz állatot, hívd be a barátaidat, és készítsétek elő a pályát!</p></div><div class="code-badge"><div><small>MEGHÍVÓKÓD</small><strong>${roomState.code}</strong></div><button id="copyCodeBtn" class="ghost-button">📋 Másolás</button></div></div>
    <div class="lobby-grid"><section class="panel lobby-main"><div class="section-title"><h2>Válaszd ki az állatodat</h2><span class="muted">${players.length}/${s.maxPlayers} játékos</span></div>
      <div class="animal-grid">${animalCards}</div>
      <div class="lobby-identity"><div class="form-field"><label class="form-label" for="identityName">Játékosnév</label><input class="form-input" id="identityName" maxlength="16" value="${escapeHtml(me?.name || preferredName || '')}" placeholder="A neved"></div><button class="secondary-button" id="saveIdentityBtn">Mentés</button></div>
      <div class="section-title small-heading"><h2>Akik a rajtra várnak</h2><span class="muted">${players.length} bent</span></div><div class="lobby-player-list">${playerRows}${waitingRows}</div>
      <div class="lobby-actions"><button class="ghost-button" id="leaveRoomBtn">← Kilépés</button>${isHost ? `<button class="primary-button" id="startGameBtn" ${players.length < 2 ? 'disabled' : ''}>🏁 Indítás (${players.length}/2+)</button>` : '<button class="primary-button" disabled>⏳ Várakozás a gazdára</button>'}</div>
      ${players.length < 2 ? '<div class="setting-note">A verseny indításához legalább 2 játékos szükséges. Küldd el a szobakódot a barátaidnak!</div>' : ''}
    </section>
    <aside class="panel lobby-side"><div class="section-title"><h2>⚙️ Versenybeállítások</h2><span class="muted">${isHost ? 'Szerkeszthető' : 'Csak olvasható'}</span></div>
      <div class="setting-grid">
        <div><label class="form-label" for="setMaxPlayers">Játékosok száma</label><select class="form-input" id="setMaxPlayers" ${!isHost ? 'disabled' : ''}>${[2,3,4,5,6,7,8].map(n => `<option value="${n}" ${s.maxPlayers===n?'selected':''}>${n} játékos</option>`).join('')}</select></div>
        <div><label class="form-label" for="setGold">Kezdő arany</label><input class="form-input" id="setGold" type="number" min="0" max="9999" value="${s.startGold}" ${!isHost ? 'disabled' : ''}></div>
        <div><label class="form-label" for="setTime">Versenyidő (másodperc)</label><input class="form-input" id="setTime" type="number" min="15" max="600" value="${s.roundSeconds}" ${!isHost ? 'disabled' : ''}></div>
        <div><label class="form-label" for="setBuildTime">Építkezési idő / játékos (mp)</label><input class="form-input" id="setBuildTime" type="number" min="5" max="180" value="${s.buildSeconds || 30}" ${!isHost ? 'disabled' : ''}></div>
        <div><label class="form-label" for="setRounds">Körök száma</label><input class="form-input" id="setRounds" type="number" min="1" max="12" value="${s.rounds}" ${!isHost ? 'disabled' : ''}></div>
        <div class="map-setting"><label class="form-label" for="setMapTheme">Pályavilág</label><select class="form-input" id="setMapTheme" ${!isHost ? 'disabled' : ''}>${Object.entries(MAPS).map(([key,label]) => `<option value="${key}" ${(s.mapTheme || 'meadow')===key?'selected':''}>${label}</option>`).join('')}</select></div>
      </div>
      ${isHost ? '<button class="secondary-button full" id="saveSettingsBtn">Beállítások mentése</button>' : ''}
      <div class="setting-note">A versenyidő lejártakor a célba nem érők nem kapnak helyezési pontot. Az építkezési időt játékosonként a szobagazda állítja. A saját időd alatt annyi tárgyat építhetsz, amennyit az aranyad enged; a végén a tárgyak a pályán maradnak.</div>
    </aside></div>
    <div class="lobby-bottom"><span>🕹️ Mozgás: A/D vagy ←/→ · Ugrás: W · TAB: pontok/arany</span><span>Elsőként célba érő: több pont · Kör végén: építkezés</span></div>`;

  screenLobby.querySelectorAll('[data-animal]').forEach(btn => btn.addEventListener('click', () => {
    const name = $('identityName')?.value || me?.name || 'Játékos';
    socket.emit('updateIdentity', { name, animal: btn.dataset.animal }, result => { if (!result?.ok) toast(result?.error || 'Nem sikerült menteni.'); });
  }));
  $('saveIdentityBtn').addEventListener('click', () => {
    socket.emit('updateIdentity', { name: $('identityName').value, animal: getMe()?.animal || 'pig' }, result => {
      if (!result?.ok) toast(result?.error || 'Nem sikerült menteni.'); else toast('Játékosnév elmentve!');
    });
  });
  $('copyCodeBtn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(roomState.code); toast('Szobakód másolva: ' + roomState.code); }
    catch { toast('Szobakódod: ' + roomState.code + ' — jelöld ki és másold ki.'); }
  });
  $('leaveRoomBtn').addEventListener('click', () => { socket.emit('leaveRoom'); roomState = null; livePlayers = []; currentRenderedPhase = null; switchScreen('home'); });
  if (isHost) {
    $('saveSettingsBtn').addEventListener('click', () => {
      emitAck('updateSettings', {
        maxPlayers: Number($('setMaxPlayers').value), startGold: Number($('setGold').value),
        roundSeconds: Number($('setTime').value), buildSeconds: Number($('setBuildTime').value), rounds: Number($('setRounds').value), mapTheme: $('setMapTheme').value
      }, 'Beállítások elmentve.');
    });
    $('startGameBtn').addEventListener('click', () => emitAck('startGame', {}, 'A verseny indul!'));
  }
}

function renderGame() {
  if (!roomState) return;
  switchScreen('game');
  screenGame.classList.remove('end-screen');
  selectedBuildType = roomState.phase === 'build' && roomState.currentBuilderId === socket.id ? selectedBuildType : null;
  screenGame.innerHTML = `
    <div class="world-frame game-fullscreen-world">
      <canvas id="worldCanvas" width="1100" height="620" tabindex="0" aria-label="ÁllatKáosz játékpálya. Mozgás: A/D vagy nyilak, ugrás: W"></canvas>
      <header class="game-hud-top">
        <div class="game-hud-left">
          <div class="hud-brand"><span>🐾</span><strong>ÁLLAT<span>KÁOSZ</span></strong></div>
          <div class="hud-stat">🏁 Kör <b id="roundChip">${roomState.roundNo}/${roomState.settings.rounds}</b></div>
          <div class="hud-stat">🪙 Arany <b id="myGoldValue">${getMe()?.gold ?? 0}</b></div>
          <div id="gameStatusText" class="hud-status">${escapeHtml(roomState.statusMessage || '')}</div>
        </div>
        <div class="canvas-timer" id="canvasTimerBox"><small id="inCanvasTimerLabel">VERSENYIDŐ</small><strong id="inCanvasTimer">00:45</strong></div>
        <div class="game-hud-right">
          <span class="hud-connection"><span class="hud-connection-dot"></span><span id="gameConnectionLabel">${socket.connected ? 'Kapcsolódva' : 'Kapcsolódás…'}</span></span>
          <button class="ghost-button hud-button" id="gameHelpButton" type="button">❔ Súgó</button>
          <button class="ghost-button hud-button" id="fullscreenButton" type="button" title="Teljes képernyő">⛶ Teljes képernyő</button>
          <button class="ghost-button hud-button exit-button" id="exitGameBtn" type="button">Kilépés</button>
        </div>
      </header>
      <div class="canvas-overlay">
        <div class="canvas-pill" id="canvasModeLabel">🏃 VERSENY</div>
        <div class="canvas-pill right">🌍 <strong id="canvasMapName">${escapeHtml(MAPS[roomState.settings?.mapTheme || 'meadow'] || 'Kezdő mező')}</strong> · 🏁 Cél · TAB: pontok</div>
      </div>
      <div class="phase-center-notice hidden" id="phaseCenterNotice"><span class="phase-center-icon" id="phaseCenterIcon">🔨</span><div><strong id="phaseCenterTitle">XY MOST ÉPÍTKEZIK</strong><span id="phaseCenterSubtitle">Válassz tárgyakat, és használd fel az aranyad!</span></div></div>
      <div class="race-countdown hidden" id="raceCountdown" aria-live="polite"><strong id="raceCountdownNumber">3</strong><span id="raceCountdownLabel">Felkészülni!</span></div>
      <div class="last-round-banner hidden" id="lastRoundBanner">🔥 UTOLSÓ KÖR! GYERÜNK, VADÁLLATOK! 🔥</div>
      <section class="score-overlay hidden" id="scoreOverlay" aria-label="Pontok és arany"><div class="score-overlay-head"><strong>🏆 Pontok és arany</strong><button type="button" id="closeScoreButton" aria-label="Bezárás">×</button></div><div class="score-list" id="scoreList"></div><small>Engedd fel a TAB billentyűt az ablak bezárásához.</small></section>
      <section class="panel side-card chat-card hud-chat-card"><h3>💬 Játékchat <small>Szoba ${escapeHtml(roomState.code)}</small></h3><div class="chat-messages" id="chatMessages"></div><form class="chat-entry" id="chatForm"><input id="chatInput" maxlength="260" placeholder="Üzenet a csapatnak…" autocomplete="off"><button type="submit" aria-label="Küldés">➤</button></form></section>
      <section class="panel build-panel hud-build-panel hidden" id="buildPanel"></section>
      <div class="game-controls-hint"><span><b>A/D</b> vagy <b>←/→</b> mozgás</span><span><b>W</b> ugrás</span><span><b>TAB</b> pontok</span></div>
    </div>`;

  $('exitGameBtn').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); socket.emit('leaveRoom'); roomState = null; livePlayers = []; currentRenderedPhase = null; switchScreen('home'); });
  $('gameHelpButton').addEventListener('click', () => $('helpModal').classList.remove('hidden'));
  $('fullscreenButton').addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch { toast('A teljes képernyő módot a böngésző nem engedélyezte.'); }
  });
  updateFullscreenButton();
  $('chatForm').addEventListener('submit', e => { e.preventDefault(); const text = $('chatInput').value.trim(); if (!text) return; socket.emit('chat', { text }, result => { if (!result?.ok) toast(result?.error || 'Az üzenet nem küldhető el.'); }); $('chatInput').value = ''; $('chatInput').blur(); $('worldCanvas')?.focus({ preventScroll: true }); });
  $('closeScoreButton').addEventListener('click', () => $('scoreOverlay').classList.add('hidden'));
  const canvas = $('worldCanvas');
  canvas.addEventListener('pointerdown', () => { $('chatInput')?.blur(); canvas.focus({ preventScroll: true }); });
  canvas.addEventListener('pointermove', e => {
    const rect = canvas.getBoundingClientRect();
    mouseWorld = { x: ((e.clientX - rect.left) / rect.width) * CANVAS_W, y: ((e.clientY - rect.top) / rect.height) * CANVAS_H };
  });
  canvas.addEventListener('pointerleave', () => { mouseWorld = null; });
  canvas.focus({ preventScroll: true });
  canvas.addEventListener('click', e => {
    if (!roomState || roomState.phase !== 'build' || !selectedBuildType) return;
    if (roomState.currentBuilderId !== socket.id) return toast('Most nem te építkezel.');
    const rect = canvas.getBoundingClientRect();
    const rawX = ((e.clientX - rect.left) / rect.width) * CANVAS_W;
    const rawY = ((e.clientY - rect.top) / rect.height) * CANVAS_H;
    const x = Math.max(28, Math.min(CANVAS_W - 28, rawX));
    const groundY = Math.max(50, Math.min(600, rawY + 20));

    if (selectedBuildType === 'delete-tool') {
      const target = findObstacleAt(rawX, rawY);
      if (!target) return toast('Kattints egy lerakott tárgyra a törléshez.');
      const expectedCost = target.ownerId === socket.id ? 8 : 16;
      if ((getMe()?.gold ?? 0) < expectedCost) return toast(`Ennek a tárgynak a törlése ${expectedCost} aranyba kerül.`);
      socket.emit('deleteObstacle', { id: target.id }, result => {
        if (!result?.ok) toast(result?.error || 'Nem sikerült törölni.');
        else toast(`🗑️ Tárgy törölve. −${result.cost || expectedCost} arany. Maradt: ${result.gold}`);
      });
      return;
    }

    if (selectedBuildType === 'move-tool') {
      if (!movingObstacleId) {
        const target = findObstacleAt(rawX, rawY);
        if (!target) return toast('Először kattints arra a tárgyra, amelyet mozgatni szeretnél.');
        movingObstacleId = target.id; updateBuildControls();
        toast('Most kattints az új helyre. A mozgatás 12 aranyba kerül.'); return;
      }
      const target = roomState.obstacles.find(o => o.id === movingObstacleId);
      if (!target) { movingObstacleId = null; return toast('A kiválasztott tárgy már nem található.'); }
      const placementError = getBuildPlacementError(target.type, x, groundY, movingObstacleId);
      if (placementError) return toast(placementError);
      socket.emit('moveObstacle', { id: movingObstacleId, x, groundY }, result => {
        if (!result?.ok) toast(result?.error || 'Nem sikerült áthelyezni.');
        else { movingObstacleId = null; toast(`↔️ Tárgy áthelyezve. −12 arany. Maradt: ${result.gold}`); updateBuildControls(); }
      }); return;
    }
    if (['shield', 'lifebuoy', 'jumpboots'].includes(selectedBuildType)) return toast('Ezt a segítséget a boltban a vásárlás gombbal aktiválhatod.');
    const type = selectedBuildType;
    const placementError = getBuildPlacementError(type, x, groundY);
    if (placementError) return toast(placementError);
    socket.emit('placeBuild', { type, x, groundY }, result => {
      if (!result?.ok) toast(result?.error || 'Nem sikerült építeni.');
      else toast('Elhelyezve! Még építhetsz, amíg van aranyad és időd.');
    });
  });
  updateGameChrome(); updateScoreList(); updateChat(); updateBuildControls();
  if (rafId) cancelAnimationFrame(rafId);
  lastTick = performance.now(); rafId = requestAnimationFrame(gameLoop);
}
function updateFullscreenButton() {
  const button = $('fullscreenButton');
  if (!button) return;
  button.textContent = document.fullscreenElement ? '⤢ Kilépés a teljes képernyőből' : '⛶ Teljes képernyő';
}
document.addEventListener('fullscreenchange', updateFullscreenButton);

function renderEndScreen() {
  switchScreen('game'); screenGame.classList.add('end-screen'); currentRenderedPhase = 'ended';
  const sorted = roomState.lastResults || [];
  const winner = sorted[0];
  screenGame.innerHTML = `<section class="panel end-layout"><div class="eyebrow">🏁 VERSENY VÉGE</div><h1>${winner ? `${ANIMALS[winner.animal]?.emoji || '🏆'} ${escapeHtml(winner.name)} nyert!` : 'Véget ért a verseny!'}</h1><p>A győztes az összes kör alatt szerzett pontok alapján dőlt el. Készen álltok a visszavágóra?</p><div class="results-list">${sorted.map((p,i)=>`<div class="result-row ${i===0?'winner':''}"><div class="result-place">${i+1}.</div><div class="result-animal">${ANIMALS[p.animal]?.emoji || '🐾'}</div><div class="result-details"><strong>${escapeHtml(p.name)} ${p.id===socket.id?'(Te)':''}</strong><small>🪙 ${p.gold} arany</small></div><div class="result-score">${p.score} pont</div></div>`).join('')}</div><div class="lobby-actions"><button class="ghost-button" id="endLeaveBtn">← Főmenü</button>${roomState.hostId===socket.id?'<button class="primary-button" id="restartGameBtn">🔄 Új verseny</button>':'<button class="primary-button" disabled>Várakozás a szobagazdára…</button>'}</div><p class="setting-note">A következő verseny ugyanazon a rövid pályán, új pontszámokkal indul; a szobabeállítások megmaradnak.</p></section>`;
  $('endLeaveBtn').addEventListener('click', () => { socket.emit('leaveRoom'); roomState = null; livePlayers = []; currentRenderedPhase = null; switchScreen('home'); });
  if ($('restartGameBtn')) $('restartGameBtn').addEventListener('click', () => emitAck('startGame', {}, 'Új verseny indul!'));
}

function updateGameChrome() {
  if (currentScreen !== 'game' || !roomState) return;
  const me = getMe();
  const status = $('gameStatusText'); if (status) status.textContent = roomState.statusMessage || '';
  const round = $('roundChip'); if (round) round.textContent = `${roomState.roundNo}/${roomState.settings.rounds}`;
  const gold = $('myGoldValue'); if (gold) gold.textContent = me?.gold ?? 0;
  const label = $('canvasModeLabel'); if (label) label.textContent = roomState.phase === 'build' ? '🔨 ÉPÍTKEZÉS' : '🏃 VERSENY';
  const mapLabel = $('canvasMapName'); if (mapLabel) mapLabel.textContent = MAPS[roomState.settings?.mapTheme || 'meadow'] || MAPS.meadow;
  const instr = $('progressInstruction'); if (instr) instr.textContent = roomState.phase === 'build' ? 'A saját időd alatt több tárgyat is építhetsz, amíg van aranyad.' : 'Minden 250 megtett egység után +4 arany.';
  const inv = $('inventoryInfo'); if (inv && me) inv.innerHTML = `🛡️ Pajzsok: <b style="color:#ffd66c">${me.shields || 0}</b><br>🛟 Mentőöv: <b style="color:#8de5ff">${me.lifebuoys || 0}</b><br>🥾 Ugrócsizma: <b style="color:#caa7ff">${me.jumpBoosts || 0}</b><br>💀 Halálok: <b>${me.deaths}</b><br>🪙 Arany: <b style="color:#ffd66c">${me.gold}</b><br>🏆 Összpont: <b>${me.score}</b>`;
  const timer = $('inCanvasTimer');
  let seconds = 0;
  if (roomState.phase === 'race' && roomState.roundDeadline) seconds = Math.max(0, Math.ceil((roomState.roundDeadline - Math.max(synchronizedNow(), roomState.raceStartsAt || 0)) / 1000));
  else if (roomState.phase === 'build' && roomState.buildTurnEndsAt) seconds = Math.max(0, Math.ceil((roomState.buildTurnEndsAt - synchronizedNow()) / 1000));
  if (timer) {
    timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
    timer.classList.toggle('urgent', seconds <= 8);
  }
  const countdown = $('raceCountdown');
  const countdownNumber = $('raceCountdownNumber');
  const countdownLabel = $('raceCountdownLabel');
  const startRemaining = roomState.phase === 'race' && roomState.raceStartsAt ? roomState.raceStartsAt - synchronizedNow() : 0;
  if (countdown && startRemaining > 0) {
    countdown.classList.remove('hidden');
    if (startRemaining > 2650) { if (countdownNumber) countdownNumber.textContent = '3'; if (countdownLabel) countdownLabel.textContent = 'Felkészülni!'; }
    else if (startRemaining > 1650) { if (countdownNumber) countdownNumber.textContent = '2'; if (countdownLabel) countdownLabel.textContent = 'Helyezkedj!'; }
    else if (startRemaining > 600) { if (countdownNumber) countdownNumber.textContent = '1'; if (countdownLabel) countdownLabel.textContent = 'Mindjárt rajt!'; }
    else { if (countdownNumber) countdownNumber.textContent = 'MEHET!'; if (countdownLabel) countdownLabel.textContent = 'Gyerünk, vadállatok!'; }
  } else if (countdown) countdown.classList.add('hidden');
  const lastRoundBanner = $('lastRoundBanner');
  if (lastRoundBanner) lastRoundBanner.classList.toggle('hidden', !(roomState.phase === 'race' && synchronizedNow() < lastRoundBannerUntil));
  const timerLabel = $('inCanvasTimerLabel');
  const builder = roomState.players?.find(p => p.id === roomState.currentBuilderId);
  if (timerLabel) timerLabel.textContent = roomState.phase === 'build' ? `${builder?.name || 'ÉPÍTKEZÉS'} IDEJE` : 'VERSENYIDŐ';
  const notice = $('phaseCenterNotice');
  if (notice) {
    const building = roomState.phase === 'build';
    const isWaitingForOther = building && !!builder && builder.id !== socket.id;
    const turnKey = building && builder ? `${roomState.code}:${roomState.roundNo}:${builder.id}` : null;
    const title = $('phaseCenterTitle');
    const subtitle = $('phaseCenterSubtitle');
    const icon = $('phaseCenterIcon');
    if (!building || !builder) {
      notice.classList.add('hidden');
      if (buildNoticeTimer) clearTimeout(buildNoticeTimer);
      buildNoticeTimer = null;
      buildNoticeTurnKey = null;
    } else {
      if (title) title.textContent = `${builder.name || 'A következő játékos'} MOST ÉPÍTKEZIK`;
      if (subtitle) subtitle.textContent = `Most ${builder.name || 'egy játékos'} köre van. Építkezési idő: ${roomState.settings?.buildSeconds || 30} mp.`;
      if (icon) icon.textContent = '🔨';
      // The active builder never sees this big banner. Other players see it for
      // two seconds only when a new player's building turn starts.
      if (!isWaitingForOther) {
        notice.classList.add('hidden');
        if (buildNoticeTimer) clearTimeout(buildNoticeTimer);
        buildNoticeTimer = null;
        buildNoticeTurnKey = turnKey;
      } else if (turnKey !== buildNoticeTurnKey) {
        if (buildNoticeTimer) clearTimeout(buildNoticeTimer);
        buildNoticeTurnKey = turnKey;
        notice.classList.remove('hidden');
        buildNoticeTimer = setTimeout(() => {
          if (buildNoticeTurnKey === turnKey) notice.classList.add('hidden');
        }, 2000);
      }
    }
  }
}
function updateScoreList() {
  const el = $('scoreList'); if (!el || !roomState) return;
  const list = [...(livePlayers.length ? livePlayers : roomState.players)].sort((a,b)=>b.score-a.score || b.gold-a.gold);
  el.innerHTML = list.map((p,i)=>`<div class="score-row ${p.id===socket.id?'me':''}"><span class="score-rank">${i+1}</span><span class="score-animal">${ANIMALS[p.animal]?.emoji || '🐾'}</span><span class="score-name">${escapeHtml(p.name)}</span><span class="score-stats"><b>${p.score} p</b>🪙 ${p.gold}</span></div>`).join('');
}
function updateChat() {
  const el = $('chatMessages'); if (!el || !roomState) return;
  const messages = roomState.chat || [];
  el.innerHTML = messages.slice(-40).map(m => {
    const kind = m.kind === 'first-place' ? ' first-place' : (m.kind === 'finish' ? ' finish-event' : '');
    return `<div class="chat-line ${m.system ? 'system' : ''}${kind}"><span class="chat-name">${escapeHtml(m.name)}:</span> ${escapeHtml(m.text)}</div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}
function updateBuildControls() {
  const panel = $('buildPanel'); if (!panel || !roomState) return;
  if (roomState.phase !== 'build') { panel.classList.add('hidden'); panel.innerHTML=''; movingObstacleId = null; return; }
  panel.classList.remove('hidden');
  const me = getMe(); const isMe = roomState.currentBuilderId === socket.id;
  const builder = roomState.players.find(p => p.id === roomState.currentBuilderId);
  if (!isMe) { selectedBuildType = null; movingObstacleId = null; }
  if (isMe && selectedBuildType) {
    const selectedItem = ITEMS.find(item => item.type === selectedBuildType) || EDIT_TOOLS.find(item => item.type === selectedBuildType);
    if (!selectedItem || (me?.gold ?? 0) < selectedItem.price) { selectedBuildType = null; movingObstacleId = null; }
  }
  const cards = ITEMS.map(item => `<button type="button" class="shop-item ${selectedBuildType===item.type?'selected':''}" data-item="${item.type}" ${!isMe || (me?.gold ?? 0) < item.price ? 'disabled' : ''}><span class="shop-icon">${item.icon}</span><strong>${item.name}</strong><small>🪙 ${item.price}</small><span class="item-desc">${item.desc}</span></button>`).join('');
  const editCards = EDIT_TOOLS.map(item => `<button type="button" class="shop-item edit-tool ${selectedBuildType===item.type?'selected':''}" data-item="${item.type}" ${!isMe || (me?.gold ?? 0) < item.price ? 'disabled' : ''}><span class="shop-icon">${item.icon}</span><strong>${item.name}</strong><small>🪙 ${item.price}/művelet</small><span class="item-desc">${item.desc}</span></button>`).join('');
  const affordable = ITEMS.some(item => (me?.gold ?? 0) >= item.price) || EDIT_TOOLS.some(item => (me?.gold ?? 0) >= item.price);
  let helpText = 'Válassz tárgyat, majd kattints a pályára. Törlésnél kattints a tárgyra; mozgatásnál először válaszd ki a tárgyat, majd az új helyét.';
  if (selectedBuildType === 'move-tool' && movingObstacleId) helpText = 'Áthelyezés: kattints a pálya új pontjára. A célzónák és más tárgyak nem fedhetők le.';
  else if (selectedBuildType === 'delete-tool') helpText = 'Törlés: saját tárgy 8 arany, más játékosé 16 arany. Kattints a tárgyra.';
  else if (isMe && !affordable) helpText += ' Nincs elég aranyad új műveletre — kihagyhatod a körödet.';
  const obstacleIcons = { crate: '📦', saw: '⚙️', spikes: '🔺', spring: '🌀', barrel: '🛢️' };
  const obstacleNames = { crate: 'Láda', saw: 'Forgó fűrész', spikes: 'Tüskék', spring: 'Rugós kilövő', barrel: 'Hordó' };
  const existingObstacleRows = (roomState.obstacles || []).map(o => { const deleteCost = o.ownerId === socket.id ? 8 : 16; const ownerLabel = o.ownerId === socket.id ? 'Saját tárgy' : (o.builtIn || o.ownerName === 'Pálya' ? 'Alap pályaelem' : `Építette: ${escapeHtml(o.ownerName || 'Játékos')}`); return `<div class="obstacle-admin-row"><div class="obstacle-admin-info"><span class="obstacle-admin-icon">${obstacleIcons[o.type] || '🧱'}</span><span><strong>${escapeHtml(obstacleNames[o.type] || 'Építmény')}</strong><small>${ownerLabel} · X: ${Math.round(Number(o.x) || 0)}</small></span></div><button type="button" class="obstacle-delete-button" data-delete-obstacle="${escapeHtml(o.id)}" data-delete-cost="${deleteCost}" ${!isMe || (me?.gold ?? 0) < deleteCost ? 'disabled' : ''} title="Saját: 8 arany, másé: 16 arany">🗑️ Törlés · ${deleteCost}🪙</button></div>`; }).join('');
  panel.innerHTML = `<div class="build-top"><div><h3>🔨 Építkezési fázis</h3><p>${isMe ? `Aranyad: ${me?.gold ?? 0} · A saját időd alatt több tárgyat is elhelyezhetsz vagy módosíthatsz.` : `Most ${escapeHtml(builder?.name || 'egy játékos')} építkezik.`}</p></div><span class="build-turn-pill">${isMe?'TE JÖSSZ':'VÁRJ A SORODRA'}</span></div><div class="shop-grid">${cards}</div><div class="edit-tools-block"><h4>🛠️ Tárgyak kezelése</h4><div class="shop-grid edit-tool-grid">${editCards}</div></div><div class="obstacle-admin"><div class="obstacle-admin-heading"><h4>📋 Pályán lévő tárgyak</h4><small>${(roomState.obstacles || []).length} db · saját törlése 8, másé 16 arany</small></div><div class="obstacle-admin-list">${existingObstacleRows || '<div class="obstacle-admin-empty">Nincs lerakott tárgy.</div>'}</div></div><div class="build-footer"><span class="build-help">${escapeHtml(helpText)}</span>${isMe?'<button class="ghost-button" id="skipBuildBtn">Kész / Kihagyom →</button>':''}</div>`;
  panel.querySelectorAll('[data-delete-obstacle]').forEach(btn => btn.addEventListener('click', () => {
    if (!isMe) return toast('Most nem te építkezel.');
    const id = btn.dataset.deleteObstacle;
    const deleteCost = Number(btn.dataset.deleteCost || 8);
    if ((getMe()?.gold ?? 0) < deleteCost) return toast(`A tárgy törlése ${deleteCost} aranyba kerül.`);
    selectedBuildType = null; movingObstacleId = null;
    socket.emit('deleteObstacle', { id }, result => {
      if (!result?.ok) toast(result?.error || 'Nem sikerült törölni a tárgyat.');
      else { toast(`🗑️ Tárgy törölve. −${result.cost || deleteCost} arany. Maradt: ${result.gold}`); updateBuildControls(); }
    });
  }));
  panel.querySelectorAll('[data-item]').forEach(btn => btn.addEventListener('click', () => {
    const type = btn.dataset.item;
    if (EDIT_TOOLS.some(item => item.type === type)) {
      selectedBuildType = type; movingObstacleId = null; updateBuildControls();
      toast(type === 'delete-tool' ? 'Törlés kiválasztva: kattints bármelyik pályatárgyra.' : 'Mozgatás kiválasztva: kattints bármelyik pályatárgyra.');
      return;
    }
    if (['shield', 'lifebuoy', 'jumpboots'].includes(type)) {
      selectedBuildType = null; movingObstacleId = null;
      const labels = { shield: 'Pajzs megvéve!', lifebuoy: 'Mentőöv megvéve! Egy leesést túlélhetsz.', jumpboots: 'Ugrócsizma megvéve! A következő W-ugrásod magasabb lesz.' };
      socket.emit('placeBuild', { type }, result => { if (!result?.ok) toast(result?.error || 'Nem sikerült megvenni.'); else toast(labels[type] || 'Segítség megvéve.'); });
    } else { selectedBuildType = type; movingObstacleId = null; updateBuildControls(); toast('Az akadály előnézete követi az egeret. Kattints oda, ahová építeni szeretnél.'); }
  }));
  if ($('skipBuildBtn')) $('skipBuildBtn').addEventListener('click', () => emitAck('skipBuild', {}, 'Építkezés befejezve.'));
}

const CANVAS_W = 1100, CANVAS_H = 620, GROUND_Y = 430, PLAYER_H = 40, PLAYER_HALF_W = 10;
// Build-protected rectangles around both the starting field and the finish flag.
const SPAWN_SAFE_ZONE = { left: 0, right: 260, top: 315, bottom: 440 };
const GOAL_SAFE_ZONE = { left: 948, right: 1098, top: 250, bottom: 422 };
function rectanglesOverlap(a, b, gap = 0) {
  return a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;
}
function getBuildPlacementError(type, x, groundY, ignoreObstacleId = null) {
  const candidate = getObstacleBounds({ type, x, groundY });
  if (rectanglesOverlap(candidate, SPAWN_SAFE_ZONE)) return 'A rajt körüli védett mezőt szabadon kell hagyni!';
  if (rectanglesOverlap(candidate, GOAL_SAFE_ZONE)) return 'A zászló körüli védett négyzetet szabadon kell hagyni!';
  const other = (roomState?.obstacles || []).find(o => o.id !== ignoreObstacleId && rectanglesOverlap(candidate, getObstacleBounds(o), 1));
  if (other) return 'Itt már van egy tárgy — ne rakd egymásra az építményeket!';
  return '';
}
function findObstacleAt(x, y) {
  // Larger click zone than the physics box makes small traps much easier to select.
  const hits = [];
  for (const o of [...(roomState?.obstacles || [])].reverse()) {
    const b = getObstacleBounds(o), padX = 12, padY = 12;
    if (x < b.left - padX || x > b.right + padX || y < b.top - padY || y > b.bottom + padY) continue;
    const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
    const dx = (x - cx) / Math.max(1, (b.right - b.left) / 2 + padX);
    const dy = (y - cy) / Math.max(1, (b.bottom - b.top) / 2 + padY);
    hits.push({ obstacle: o, distance: dx * dx + dy * dy });
  }
  hits.sort((a, b) => a.distance - b.distance);
  return hits[0]?.obstacle || null;
}
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
function getPlatformLayout() { return PLATFORM_LAYOUTS[roomState?.settings?.mapTheme || 'meadow'] || PLATFORM_LAYOUTS.meadow; }
function getSolidSurfaces() {
  const surfaces = getPlatformLayout().map((p, i) => ({ x: p.x, width: p.width, top: p.top, kind: 'platform', key: `platform-${i}` }));
  for (const o of (roomState?.obstacles || [])) {
    // Crates are solid blocks: the top is a stable landing surface and the
    // sides/underside stop the avatar. Other props are hazards/boosters.
    if (o.type === 'crate') {
      const groundY = Number.isFinite(o.groundY) ? o.groundY : GROUND_Y;
      surfaces.push({ x: o.x - 21, width: 42, top: groundY - 39, bottom: groundY, kind: 'crate', key: o.id, object: o });
    }
  }
  return surfaces;
}
function overlapsHorizontally(x, surface) {
  return x + PLAYER_HALF_W > surface.x + 2 && x - PLAYER_HALF_W < surface.x + surface.width - 2;
}
function findPlatformAtX(x, padding = 8) {
  return getPlatformLayout().find(p => x >= p.x + padding && x <= p.x + p.width - padding) || null;
}
function isStandingOnPlatform(x, feetY) {
  return getSolidSurfaces().some(s => overlapsHorizontally(x, s) && Math.abs(feetY - s.top) <= 8);
}
function getObstacleBounds(o) {
  const x = Number(o.x) || 0;
  const ground = Number.isFinite(o.groundY) ? o.groundY : GROUND_Y;
  if (o.type === 'crate') return { left: x - 21, right: x + 21, top: ground - 39, bottom: ground };
  if (o.type === 'saw') return { left: x - 25, right: x + 25, top: ground - 47, bottom: ground + 2 };
  if (o.type === 'spikes') return { left: x - 27, right: x + 27, top: ground - 30, bottom: ground + 4 };
  if (o.type === 'spring') return { left: x - 26, right: x + 26, top: ground - 40, bottom: ground + 4 };
  if (o.type === 'barrel') return { left: x - 23, right: x + 23, top: ground - 37, bottom: ground + 3 };
  return { left: x - 20, right: x + 20, top: ground - 30, bottom: ground + 3 };
}
function avatarOverlapsObstacle(x, feetY, o) {
  const b = getObstacleBounds(o);
  const avatar = { left: x - PLAYER_HALF_W, right: x + PLAYER_HALF_W, top: feetY - PLAYER_H, bottom: feetY + 3 };
  return avatar.right > b.left && avatar.left < b.right && avatar.bottom > b.top && avatar.top < b.bottom;
}
function gameLoop(now) {
  if (currentScreen !== 'game' || !roomState || !['race','build'].includes(roomState.phase)) { rafId = null; physicsAccumulator = 0; return; }
  // Keep simulation steps small and deterministic, even after a delayed browser frame.
  const frameDt = Math.min(0.05, Math.max(0, (now - lastTick) / 1000));
  lastTick = now;
  physicsAccumulator += frameDt;
  const fixedStep = 1 / 120;
  let steps = 0;
  while (physicsAccumulator >= fixedStep && steps < 8) {
    physicsStep(fixedStep, now);
    physicsAccumulator -= fixedStep;
    steps++;
  }
  // Drop excessive catch-up after a stalled tab; don't turn it into a burst of jumps.
  if (steps === 8 && physicsAccumulator > fixedStep * 2) physicsAccumulator = 0;
  drawWorld(now);
  if (now - lastChromeUpdate >= 100) { updateGameChrome(); lastChromeUpdate = now; }
  rafId = requestAnimationFrame(gameLoop);
}
function physicsStep(dt, now) {
  if (!roomState || roomState.phase !== 'race') return;
  if (roomState.raceStartsAt && synchronizedNow() < roomState.raceStartsAt) {
    motion.moving = false; motion.vy = 0; motion.jumping = false; motion.grounded = true;
    jumpQueuedUntil = 0;
    return;
  }
  const me = getMe();
  if (!me || me.finished) { motion.moving = false; return; }
  if (now < motion.pauseUntil) return;

  let feetY = GROUND_Y + motion.y;
  if (motion.grounded && !isStandingOnPlatform(motion.x, feetY)) {
    motion.grounded = false;
    motion.coyoteUntil = now + COYOTE_TIME_MS;
  }
  if (motion.grounded) motion.coyoteUntil = now + COYOTE_TIME_MS;

  // W is buffered briefly and has a small coyote window, so a landing/ledge
  // frame can't randomly eat the jump input on slower machines.
  if (jumpQueuedUntil && now > jumpQueuedUntil) jumpQueuedUntil = 0;
  if (jumpQueuedUntil && (motion.grounded || now <= motion.coyoteUntil)) {
    // Begin with a small hop. Holding W adds upward force for a bounded time;
    // releasing early stops the boost and produces a short hop.
    const me = getMe();
    const hasJumpBoots = !jumpBoostActiveThisJump && (Number(me?.jumpBoosts) || 0) > 0;
    motion.vy = hasJumpBoots ? JUMP_START_POWER * 1.18 : JUMP_START_POWER;
    activeJumpHoldForce = hasJumpBoots ? JUMP_HOLD_FORCE * 1.12 : JUMP_HOLD_FORCE;
    activeJumpMaxPower = hasJumpBoots ? JUMP_FULL_POWER * 1.12 : JUMP_FULL_POWER;
    jumpHoldElapsed = 0;
    if (hasJumpBoots) { jumpBoostActiveThisJump = true; socket.emit('useJumpBoost', {}, result => { if (!result?.ok) pushLocalMessage(result.error || 'Az ugrócsizma nem aktiválható.'); }); }
    motion.grounded = false;
    motion.jumping = true;
    jumpLaunchedByW = true;
    jumpQueuedUntil = 0;
    motion.coyoteUntil = 0;
  }

  const left = !!(keys.ArrowLeft || keys.KeyA), right = !!(keys.ArrowRight || keys.KeyD);
  motion.moving = left !== right;
  const previousX = motion.x;
  let nextX = motion.x;
  if (left !== right) {
    motion.face = right ? 1 : -1;
    nextX += (right ? 155 : -155) * dt;
  }
  nextX = Math.max(PLAYER_HALF_W + 2, Math.min(CANVAS_W - PLAYER_HALF_W - 5, nextX));

  // Crates have real, solid side collisions. Being above the top lets the
  // player pass over them; touching the side while grounded stops movement.
  const currentFeet = GROUND_Y + motion.y;
  const currentHead = currentFeet - PLAYER_H;
  for (const o of (roomState.obstacles || [])) {
    if (o.type !== 'crate') continue;
    const b = getObstacleBounds(o);
    const verticalOverlap = currentFeet > b.top + 2 && currentHead < b.bottom - 2;
    const horizontalOverlap = nextX + PLAYER_HALF_W > b.left && nextX - PLAYER_HALF_W < b.right;
    if (verticalOverlap && horizontalOverlap && nextX !== previousX) {
      if (right && previousX <= b.left - PLAYER_HALF_W + 1) nextX = b.left - PLAYER_HALF_W;
      else if (left && previousX >= b.right + PLAYER_HALF_W - 1) nextX = b.right + PLAYER_HALF_W;
      else if (right && previousX < o.x) nextX = Math.min(nextX, b.left - PLAYER_HALF_W);
      else if (left && previousX > o.x) nextX = Math.max(nextX, b.right + PLAYER_HALF_W);
    }
  }
  motion.x = Math.max(PLAYER_HALF_W + 2, Math.min(CANVAS_W - PLAYER_HALF_W - 5, nextX));

  feetY = GROUND_Y + motion.y;
  if (motion.grounded && !isStandingOnPlatform(motion.x, feetY)) {
    motion.grounded = false;
    motion.coyoteUntil = now + COYOTE_TIME_MS;
  }

  if (!motion.grounded) {
    const previousFeet = feetY;
    const previousHead = previousFeet - PLAYER_H;
    motion.vy += 1500 * dt;
    if (jumpHeld && jumpLaunchedByW && jumpHoldElapsed < JUMP_HOLD_MAX_SECONDS && motion.vy < 0) {
      motion.vy -= activeJumpHoldForce * dt;
      motion.vy = Math.max(motion.vy, activeJumpMaxPower);
      jumpHoldElapsed += dt;
    }
    feetY = previousFeet + motion.vy * dt;
    const currentHeadAfter = feetY - PLAYER_H;
    const surfaces = getSolidSurfaces();
    if (motion.vy >= 0) {
      // Swept landing collision catches narrow platforms even if a frame jumps over the edge.
      let landing = null;
      for (const surface of surfaces) {
        if (!overlapsHorizontally(motion.x, surface)) continue;
        if (previousFeet <= surface.top + 3 && feetY >= surface.top) {
          if (!landing || surface.top < landing.top) landing = surface;
        }
      }
      if (landing) {
        feetY = landing.top;
        motion.vy = 0;
        motion.grounded = true;
        jumpLaunchedByW = false;
        jumpHoldElapsed = 0; activeJumpHoldForce = JUMP_HOLD_FORCE; activeJumpMaxPower = JUMP_FULL_POWER;
        jumpBoostActiveThisJump = false;
        motion.coyoteUntil = now + COYOTE_TIME_MS;
      }
    } else {
      // Hit the underside of an airborne crate instead of passing through it.
      for (const o of (roomState.obstacles || [])) {
        if (o.type !== 'crate') continue;
        const b = getObstacleBounds(o);
        const horizontalOverlap = motion.x + PLAYER_HALF_W > b.left && motion.x - PLAYER_HALF_W < b.right;
        if (horizontalOverlap && previousHead >= b.bottom - 2 && currentHeadAfter <= b.bottom) {
          feetY = b.bottom + PLAYER_H;
          motion.vy = 0;
          break;
        }
      }
    }
    motion.y = feetY - GROUND_Y;
  } else {
    motion.vy = 0;
  }

  // Fall recovery is immediate: no long period where the avatar falls below the canvas.
  if (feetY > CANVAS_H - 52 && now - lastFallAt > 300) {
    lastFallAt = now;
    motion.x = getMe()?.startX ?? 36;
    motion.y = 0; motion.vy = 0; motion.grounded = true;
    motion.moving = false; motion.jumping = false; motion.coyoteUntil = 0;
    motion.pauseUntil = now + 170;
    jumpQueuedUntil = 0; jumpLaunchedByW = false; jumpHeld = false; jumpHoldElapsed = 0; activeJumpHoldForce = JUMP_HOLD_FORCE; activeJumpMaxPower = JUMP_FULL_POWER; jumpBoostActiveThisJump = false;
    socket.emit('fellOffCourse');
    pushLocalMessage('💦 Leestél a pályáról — visszakerültél a rajthoz!');
    return;
  }
  motion.jumping = !motion.grounded;

  // Full rectangular hitboxes make the visible art and collisions agree.
  // Crates are handled as solid platforms; hazards and spring are trigger objects.
  for (const o of (roomState.obstacles || [])) {
    if (o.type === 'crate') continue;
    if (!avatarOverlapsObstacle(motion.x, GROUND_Y + motion.y, o)) continue;
    if (lastHitAt[o.id] && now - lastHitAt[o.id] <= 1000) continue;
    lastHitAt[o.id] = now;
    if (o.type === 'spring') {
      motion.vy = -700;
      motion.grounded = false;
      motion.jumping = true;
      jumpLaunchedByW = false;
      motion.coyoteUntil = 0;
      socket.emit('hitHazard', { id: o.id });
    } else if (['saw','spikes','barrel'].includes(o.type)) {
      // Freeze briefly on contact and let the server decide death vs shield.
      // This avoids one machine guessing a respawn while another machine doesn't.
      motion.moving = false;
      motion.pauseUntil = now + 180;
      jumpQueuedUntil = 0;
      socket.emit('hitHazard', { id: o.id }, result => {
        if (!result?.ok) {
          // A stale network snapshot/cooldown rejected this contact; retry after a
          // short delay instead of leaving the character permanently invulnerable.
          lastHitAt[o.id] = performance.now() - 760;
          motion.pauseUntil = performance.now() + 100;
        }
      });
      return;
    }
  }

  // Goal can only be reached while on the final flag platform. This prevents
  // accidental finishes while falling past the flag or touching it from below.
  if (motion.x >= CANVAS_W - 90 && Math.abs((GROUND_Y + motion.y) - getPlatformLayout()[getPlatformLayout().length - 1].top) <= 30) {
    if (now - lastSendAt > 55) {
      lastSendAt = now;
      socket.emit('playerPosition', { x: motion.x, y: motion.y, face: motion.face, moving: motion.moving, jumping: motion.jumping });
    }
    return;
  }
  if (now - lastSendAt > 55) {
    lastSendAt = now;
    socket.emit('playerPosition', { x: motion.x, y: motion.y, face: motion.face, moving: motion.moving, jumping: motion.jumping });
  }
}
function pushLocalMessage(message) { toast(message); }
function drawWorld(now) {
  const canvas = $('worldCanvas'); if (!canvas || !roomState) return;
  const ctx = canvas.getContext('2d'); const w = canvas.width, h = canvas.height; const length = CANVAS_W; const isBuild = roomState.phase === 'build';
  const theme = roomState.settings?.mapTheme || 'meadow';
  ctx.clearRect(0, 0, w, h);
  // Cache the static scenery and platforms per map: this removes dozens of path/gradient operations from every animation frame.
  if (!sceneCache.canvas || sceneCache.theme !== theme) {
    const bg = document.createElement('canvas'); bg.width = CANVAS_W; bg.height = CANVAS_H;
    drawScenery(bg.getContext('2d'), CANVAS_W, 0, 0, theme);
    sceneCache = { theme, canvas: bg };
  }
  ctx.drawImage(sceneCache.canvas, 0, 0);
  drawMapMotion(ctx, theme, now);
  for (const o of roomState.obstacles || []) drawObstacle(ctx, o, now);
  drawGoal(ctx, length, now);
  if (isBuild) {
    ctx.save();
    ctx.fillStyle = '#35d88c40'; ctx.fillRect(SPAWN_SAFE_ZONE.left, SPAWN_SAFE_ZONE.top, SPAWN_SAFE_ZONE.right - SPAWN_SAFE_ZONE.left, SPAWN_SAFE_ZONE.bottom - SPAWN_SAFE_ZONE.top);
    ctx.strokeStyle = '#48e5a0'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
    ctx.strokeRect(SPAWN_SAFE_ZONE.left, SPAWN_SAFE_ZONE.top, SPAWN_SAFE_ZONE.right - SPAWN_SAFE_ZONE.left, SPAWN_SAFE_ZONE.bottom - SPAWN_SAFE_ZONE.top);
    ctx.setLineDash([]); ctx.fillStyle = '#104f3be8'; roundRect(ctx, SPAWN_SAFE_ZONE.left + 3, SPAWN_SAFE_ZONE.top - 26, 140, 22, 7); ctx.fill();
    ctx.fillStyle = '#e1fff0'; ctx.font = 'bold 11px Nunito'; ctx.textAlign = 'left'; ctx.fillText('🛡️ RAJT – VÉDETT', SPAWN_SAFE_ZONE.left + 10, SPAWN_SAFE_ZONE.top - 11);
    ctx.fillStyle = '#ff536340'; ctx.fillRect(GOAL_SAFE_ZONE.left, GOAL_SAFE_ZONE.top, GOAL_SAFE_ZONE.right - GOAL_SAFE_ZONE.left, GOAL_SAFE_ZONE.bottom - GOAL_SAFE_ZONE.top);
    ctx.strokeStyle = '#ff6b7d'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.strokeRect(GOAL_SAFE_ZONE.left, GOAL_SAFE_ZONE.top, GOAL_SAFE_ZONE.right - GOAL_SAFE_ZONE.left, GOAL_SAFE_ZONE.bottom - GOAL_SAFE_ZONE.top); ctx.setLineDash([]);
    ctx.fillStyle = '#552638e8'; roundRect(ctx, GOAL_SAFE_ZONE.left - 1, GOAL_SAFE_ZONE.top - 26, 145, 22, 7); ctx.fill();
    ctx.fillStyle = '#fff1f3'; ctx.font = 'bold 11px Nunito'; ctx.textAlign = 'left'; ctx.fillText('🏁 CÉLZÓNA – TILOS', GOAL_SAFE_ZONE.left + 8, GOAL_SAFE_ZONE.top - 11);
    ctx.restore();
  }
  const latest = new Map((livePlayers.length ? livePlayers : roomState.players).map(p => [p.id, p]));
  const players = (roomState.players || []).map(p => ({ ...p, ...(latest.get(p.id) || {}) }));
  for (const p of players) {
    // Stagger nameplates at the start, and interpolate remote players between
    // network snapshots so their jumps/runs look smooth instead of stuttering.
    const labelOffset = (((Number(p.joinOrder) || 1) - 1) % 4) * 11;
    let drawP;
    if (p.id === socket.id) {
      drawP = { ...p, x: motion.x, y: motion.y, moving: motion.moving, jumping: motion.jumping, face: motion.face, labelOffset };
    } else {
      let v = remoteVisuals.get(p.id);
      const teleport = !v || v.deaths !== (Number(p.deaths) || 0) || v.finished !== !!p.finished || Math.abs((Number(p.x) || 0) - v.x) > 170 || Math.abs((Number(p.y) || 0) - v.y) > 190;
      if (teleport) {
        v = { x: Number(p.x) || 0, y: Number(p.y) || 0, deaths: Number(p.deaths) || 0, finished: !!p.finished };
        remoteVisuals.set(p.id, v);
      } else {
        const smoothing = 0.34;
        v.x += ((Number(p.x) || 0) - v.x) * smoothing;
        v.y += ((Number(p.y) || 0) - v.y) * smoothing;
      }
      drawP = { ...p, x: v.x, y: v.y, labelOffset };
    }
    drawAnimal(ctx, drawP, now);
  }
  if (isBuild && selectedBuildType && mouseWorld) {
    const px = Math.max(28, Math.min(length - 28, mouseWorld.x));
    const ground = Math.max(50, Math.min(600, mouseWorld.y + 20));
    ctx.save();
    if (selectedBuildType === 'delete-tool') {
      const target = findObstacleAt(mouseWorld.x, mouseWorld.y);
      if (target) {
        const b = getObstacleBounds(target); ctx.strokeStyle = '#ff6177'; ctx.lineWidth = 4;
        ctx.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
        ctx.fillStyle = '#42192b'; roundRect(ctx, Math.max(4, Math.min(w - 130, target.x - 60)), Math.max(52, b.top - 29), 120, 22, 7); ctx.fill();
        ctx.fillStyle = '#fff1f3'; ctx.font = 'bold 11px Nunito'; ctx.textAlign = 'center'; ctx.fillText('TÖRLÉS · 8 ARANY', Math.max(64, Math.min(w - 64, target.x)), Math.max(67, b.top - 15));
      } else {
        ctx.fillStyle = '#42192b'; roundRect(ctx, Math.max(4, Math.min(w - 144, px - 68)), Math.max(52, ground - 72), 136, 23, 8); ctx.fill();
        ctx.fillStyle = '#fff1f3'; ctx.font = 'bold 11px Nunito'; ctx.textAlign = 'center'; ctx.fillText('VÁLASSZ TÁRGYAT', Math.max(72, Math.min(w - 72, px)), Math.max(67, ground - 57));
      }
    } else if (selectedBuildType === 'move-tool') {
      if (!movingObstacleId) {
        const target = findObstacleAt(mouseWorld.x, mouseWorld.y);
        if (target) { const b = getObstacleBounds(target); ctx.strokeStyle = '#55d8ff'; ctx.lineWidth = 4; ctx.strokeRect(b.left, b.top, b.right-b.left, b.bottom-b.top); }
        ctx.fillStyle = '#123247ee'; roundRect(ctx, Math.max(4, Math.min(w - 154, px - 73)), 52, 146, 23, 8); ctx.fill();
        ctx.fillStyle = '#e1f8ff'; ctx.font = 'bold 11px Nunito'; ctx.textAlign = 'center'; ctx.fillText('VÁLASSZ TÁRGYAT', Math.max(77, Math.min(w - 77, px)), 67);
      } else {
        const original = roomState.obstacles.find(o => o.id === movingObstacleId);
        if (original) {
          const err = getBuildPlacementError(original.type, px, ground, movingObstacleId);
          const blocked = !!err;
          ctx.globalAlpha = .72; ctx.strokeStyle = blocked ? '#ff6177' : '#55d8ff'; ctx.lineWidth = 2; ctx.setLineDash([5,5]);
          ctx.strokeRect(px-30, ground-60, 60, 60); ctx.setLineDash([]);
          drawObstacle(ctx, { ...original, x: px, groundY: ground }, now); ctx.globalAlpha = 1;
          ctx.fillStyle = blocked ? '#651d31' : '#123d50'; roundRect(ctx, Math.max(4, Math.min(w-148, px-70)), Math.max(52, ground-72), 140, 23, 8); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Nunito'; ctx.textAlign='center'; ctx.fillText(blocked ? 'IDE NEM TEHETŐ' : 'ÚJ HELY · 12 ARANY', Math.max(74, Math.min(w-74, px)), Math.max(67, ground-57));
        }
      }
    } else if (['crate','saw','spikes','spring','barrel'].includes(selectedBuildType)) {
      const placementError = getBuildPlacementError(selectedBuildType, px, ground);
      const blocked = !!placementError;
      ctx.globalAlpha = 0.72;
      ctx.strokeStyle = blocked ? '#ff6177' : '#ffe16a'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(px, Math.max(15, ground - 60)); ctx.lineTo(px, Math.min(CANVAS_H - 8, ground + 8)); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 0.7;
      drawObstacle(ctx, { type: selectedBuildType, x: px, groundY: ground }, now);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = blocked ? '#ff6177' : '#5be89b'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(px, ground + 2, 29, 9, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = blocked ? '#651d31' : '#123d30'; roundRect(ctx, Math.max(4, Math.min(w - 135, px - 65)), Math.max(52, ground - 72), 130, 23, 8); ctx.fill();
      ctx.fillStyle = blocked ? '#fff0f2' : '#ddffe9'; ctx.font = 'bold 11px Nunito'; ctx.textAlign = 'center';
      ctx.fillText(blocked ? (placementError.includes('zászló') ? 'CÉLZÓNA – TILOS' : placementError.includes('rajt') ? 'RAJT – VÉDETT' : 'FOGLALT – TILOS') : 'IDE ÉPÜL', Math.max(68, Math.min(w - 68, px)), Math.max(67, ground - 57));
    }
    ctx.restore();
  }
  if (!isBuild) {
    const myP = players.find(p => p.id === socket.id);
    if (myP?.finished) { ctx.fillStyle='#10233ddb'; roundRect(ctx,w/2-145,65,290,46,14); ctx.fillStyle='#ffe078'; ctx.font='bold 17px Nunito'; ctx.textAlign='center'; ctx.fillText(`🏁 CÉLBA ÉRTÉL! Helyezés: ${myP.finishRank}.`,w/2,94); }
  }
}
function roundRect(ctx,x,y,w,h,r) { ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function drawScenery(ctx, length, now, cam, theme = 'meadow') {
  // Four selectable worlds use the same simple physics style but distinct terrain and scenery.
  if (theme === 'moon') {
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H); sky.addColorStop(0, '#071126'); sky.addColorStop(.65, '#131e3c'); sky.addColorStop(1, '#25304a'); ctx.fillStyle = sky; ctx.fillRect(0, 0, length, CANVAS_H);
    // Static star field with deterministic positions so it can be cached.
    for (let i = 0; i < 90; i++) { const x = (i * 137 + 29) % length, y = (i * 67 + 19) % 380, r = i % 9 === 0 ? 2 : .8 + (i % 3) * .35; ctx.fillStyle = i % 5 === 0 ? '#ffe9b8' : '#d8e7ff'; ctx.globalAlpha = .45 + (i % 4) * .13; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1;
    ctx.fillStyle = '#d7e5ff'; ctx.beginPath(); ctx.arc(860, 105, 43, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#95aacb'; [[842,93,8],[877,115,12],[852,130,5],[888,81,6]].forEach(([x,y,r])=>{ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();});
    ctx.fillStyle = '#1a2745'; ctx.beginPath(); ctx.moveTo(0,480); for(let x=0;x<=length+20;x+=20)ctx.lineTo(x,410+Math.sin(x*.018)*17+Math.sin(x*.041)*7); ctx.lineTo(length,520);ctx.lineTo(0,520);ctx.closePath();ctx.fill();
    ctx.fillStyle = '#252e48'; ctx.fillRect(0, 500, length, 120); for(let i=0;i<19;i++){const x=i*61+9,y=520+(i%4)*19;ctx.fillStyle='#3c4660';ctx.beginPath();ctx.ellipse(x,y,18+(i%3)*3,5+(i%2)*2,0,0,Math.PI*2);ctx.fill();}
  } else if (theme === 'mars') {
    const sky = ctx.createLinearGradient(0,0,0,CANVAS_H); sky.addColorStop(0,'#5b1e36');sky.addColorStop(.48,'#d95b50');sky.addColorStop(1,'#f8b16e');ctx.fillStyle=sky;ctx.fillRect(0,0,length,CANVAS_H);
    const sun=ctx.createRadialGradient(850,100,8,850,100,80);sun.addColorStop(0,'#fff2b7');sun.addColorStop(.55,'#ffbd73');sun.addColorStop(1,'#ffbd7300');ctx.fillStyle=sun;ctx.fillRect(750,0,200,200);ctx.fillStyle='#ffdd9a';ctx.beginPath();ctx.arc(850,100,27,0,Math.PI*2);ctx.fill();
    for(let i=0;i<9;i++){const x=i*140-38,y=270+(i%3)*24;ctx.fillStyle=i%2?'#a74745':'#873746';ctx.beginPath();ctx.moveTo(x-70,500);ctx.lineTo(x-50,y+30);ctx.lineTo(x-10,y);ctx.lineTo(x+28,y+20);ctx.lineTo(x+60,y+4);ctx.lineTo(x+100,500);ctx.closePath();ctx.fill();ctx.fillStyle='#d66b53';ctx.fillRect(x-10,y+24,28,4);}
    ctx.fillStyle='#9b453b';ctx.fillRect(0,500,length,120);for(let i=0;i<20;i++){const x=(i*71+22)%length,y=516+(i%5)*20;ctx.fillStyle=i%2?'#ba5c43':'#733744';ctx.beginPath();ctx.ellipse(x,y,12+(i%4)*4,4+(i%2)*2,.1,0,Math.PI*2);ctx.fill();}
  } else if (theme === 'city') {
    const sky=ctx.createLinearGradient(0,0,0,CANVAS_H);sky.addColorStop(0,'#111c3e');sky.addColorStop(.5,'#3e477d');sky.addColorStop(1,'#f08a78');ctx.fillStyle=sky;ctx.fillRect(0,0,length,CANVAS_H);
    const glow=ctx.createRadialGradient(860,100,5,860,100,110);glow.addColorStop(0,'#ffe7accc');glow.addColorStop(1,'#ffe7ac00');ctx.fillStyle=glow;ctx.fillRect(740,0,230,220);ctx.fillStyle='#ffe3b3';ctx.beginPath();ctx.arc(860,100,25,0,Math.PI*2);ctx.fill();
    for(let i=0;i<20;i++){const x=i*58-8,bh=70+((i*41)%180),top=500-bh;ctx.fillStyle=['#1a2c4d','#263454','#293b5b','#25304e'][i%4];ctx.fillRect(x,top,48,bh+15);ctx.fillStyle='#6b80a6';ctx.fillRect(x+3,top+4,42,3);for(let r=0;r<Math.floor(bh/19);r++)for(let c=0;c<3;c++){ctx.fillStyle=(i*7+r*3+c)%5===0?'#91dfff':((i+r+c)%3===0?'#ffc76d':'#496287');ctx.globalAlpha=.75;ctx.fillRect(x+7+c*13,top+12+r*18,6,8);}ctx.globalAlpha=1;}
    ctx.fillStyle='#16243a';ctx.fillRect(0,500,length,120);ctx.strokeStyle='#6ad6f5';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(0,502);ctx.lineTo(length,502);ctx.stroke();for(let i=0;i<24;i++){ctx.fillStyle=i%3===0?'#ffb86d':'#72d7ff';ctx.globalAlpha=.4;ctx.fillRect(i*49+4,533+(i%4)*19,22+(i%3)*8,2);}ctx.globalAlpha=1;
  } else {
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H); sky.addColorStop(0, '#41aaf0'); sky.addColorStop(.37, '#8bd7fb'); sky.addColorStop(.72, '#d0f4ff'); sky.addColorStop(1, '#f3fcff'); ctx.fillStyle = sky; ctx.fillRect(0, 0, length, CANVAS_H);
    const glow = ctx.createRadialGradient(900, 82, 8, 900, 82, 118); glow.addColorStop(0, '#fff8c9cc'); glow.addColorStop(.35, '#fff4b866'); glow.addColorStop(1, '#fff4b800'); ctx.fillStyle = glow; ctx.fillRect(770, 0, 260, 220); ctx.fillStyle = '#fff7ca'; ctx.beginPath(); ctx.arc(900, 82, 26, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 8; i++) { const x = i * 165 - 65, peakY = 174 + (i % 3) * 27; ctx.fillStyle = i % 2 ? '#8bb7d5' : '#a0c9de'; ctx.beginPath(); ctx.moveTo(x - 55, 440); ctx.lineTo(x + 40, peakY); ctx.lineTo(x + 94, peakY + 54); ctx.lineTo(x + 143, 440); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#eaf8ff'; ctx.beginPath(); ctx.moveTo(x + 24, peakY + 29); ctx.lineTo(x + 40, peakY); ctx.lineTo(x + 59, peakY + 30); ctx.lineTo(x + 48, peakY + 25); ctx.lineTo(x + 40, peakY + 35); ctx.lineTo(x + 33, peakY + 26); ctx.closePath(); ctx.fill(); }
    const hillGrad = ctx.createLinearGradient(0,270,0,485);hillGrad.addColorStop(0,'#75bf9e');hillGrad.addColorStop(1,'#398f76');ctx.fillStyle=hillGrad;ctx.beginPath();ctx.moveTo(0,450);for(let x=0;x<=length+30;x+=30)ctx.lineTo(x,360+Math.sin(x*.008)*28+Math.sin(x*.021)*13);ctx.lineTo(length,500);ctx.lineTo(0,500);ctx.closePath();ctx.fill();
    ctx.fillStyle='#4f9e73';ctx.beginPath();ctx.moveTo(0,472);for(let x=0;x<=length+30;x+=26)ctx.lineTo(x,405+Math.sin(x*.011+1.7)*23+Math.sin(x*.027)*10);ctx.lineTo(length,510);ctx.lineTo(0,510);ctx.closePath();ctx.fill();
    for(let i=0;i<37;i++){const x=i*32-8,y=438+Math.sin(i*1.7)*15,h=28+((i*17)%27);ctx.fillStyle=i%3===0?'#2e806b':(i%2?'#347f6b':'#3d9270');ctx.beginPath();ctx.moveTo(x-15,y);ctx.lineTo(x,y-h);ctx.lineTo(x+16,y);ctx.closePath();ctx.fill();ctx.fillStyle='#72ba8a88';ctx.beginPath();ctx.moveTo(x-7,y-h*.36);ctx.lineTo(x,y-h);ctx.lineTo(x+7,y-h*.38);ctx.closePath();ctx.fill();}
    for(let i=0;i<5;i++){const x=((i*267)% (length+150))-70,y=72+(i%3)*54;ctx.fillStyle='#ffffffad';ctx.beginPath();ctx.ellipse(x,y+9,32,12,0,0,Math.PI*2);ctx.ellipse(x+22,y-2,24,20,0,0,Math.PI*2);ctx.ellipse(x+48,y+8,30,13,0,0,Math.PI*2);ctx.fill();}
    const water = ctx.createLinearGradient(0,490,0,CANVAS_H);water.addColorStop(0,'#45d3ee');water.addColorStop(.22,'#26a8df');water.addColorStop(1,'#125d9c');ctx.fillStyle=water;ctx.fillRect(0,500,length,CANVAS_H-500);
  }
  const platforms = getPlatformLayout();
  for (const p of platforms) drawPlatform(ctx, p, now, theme);
  const startTop = platforms[0].top;
  ctx.fillStyle = theme === 'city' ? '#b6e9ff' : (theme === 'moon' ? '#dae8ff' : (theme === 'mars' ? '#ffd4ac' : '#e9f5ff'));
  ctx.fillRect(17, startTop - 36, 4, 36); ctx.fillStyle = theme === 'city' ? '#172642' : (theme === 'moon' ? '#1d2946' : (theme === 'mars' ? '#6a2834' : '#17334c'));
  roundRect(ctx,13,startTop-57,58,18,5);ctx.fill();ctx.fillStyle='#fff';ctx.font='900 11px Nunito';ctx.textAlign='center';ctx.fillText('RAJT',42,startTop-44);
}
function drawMapMotion(ctx, theme, now) {
  // A few cheap moving details keep each themed scene alive while the static scenery stays cached.
  if (theme === 'meadow') {
    ctx.strokeStyle = '#c8fbff'; ctx.lineWidth = 2;
    for (let i=0;i<7;i++){const x=(i*171+now*.055)%CANVAS_W,y=514+(i%4)*24;ctx.globalAlpha=.35+(i%3)*.1;ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(x+9,y-3,x+18,y);ctx.stroke();}ctx.globalAlpha=1;
  } else if (theme === 'moon') {
    for(let i=0;i<8;i++){const x=(i*137+now*.018)%CANVAS_W,y=35+(i*53)%340;ctx.fillStyle='#eaf5ff';ctx.globalAlpha=.25+.55*Math.abs(Math.sin(now/450+i));ctx.beginPath();ctx.arc(x,y,i%3===0?2:1,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;
  } else if (theme === 'mars') {
    for(let i=0;i<12;i++){const x=(i*97+now*.025)%CANVAS_W,y=165+(i*47)%330;ctx.fillStyle='#ffd4a0';ctx.globalAlpha=.15+(i%3)*.08;ctx.beginPath();ctx.ellipse(x,y,5+(i%4),1.5,0,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;
  } else if (theme === 'city') {
    for(let i=0;i<8;i++){const x=(i*139+35)%CANVAS_W,y=310+(i*29)%175;ctx.fillStyle=Math.sin(now/600+i)>0?'#7ce6ff':'#ffcb7a';ctx.globalAlpha=.2+.5*Math.abs(Math.sin(now/700+i));ctx.fillRect(x,y,5,8);}ctx.globalAlpha=1;
  }
}
function drawPlatform(ctx, p, now, theme = 'meadow') {
  const depth = 30;
  if (theme === 'moon') {
    ctx.fillStyle='#323e5d';ctx.fillRect(p.x,p.top,p.width,depth);ctx.fillStyle='#64718d';ctx.fillRect(p.x,p.top,p.width,5);ctx.strokeStyle='#a5b6d6';ctx.lineWidth=1.4;
    for(let x=p.x+8;x<p.x+p.width-5;x+=32){ctx.beginPath();ctx.arc(x,p.top+14,3+(x%3),0,Math.PI*2);ctx.stroke();ctx.fillStyle='#8794ab';ctx.fillRect(x+6,p.top+19,12,3);}
    ctx.fillStyle='#7c89a2';ctx.fillRect(p.x+8,p.top+5,6,3);ctx.fillRect(p.x+p.width-15,p.top+5,6,3);
  } else if (theme === 'mars') {
    ctx.fillStyle='#803c3a';ctx.fillRect(p.x,p.top,p.width,depth);ctx.fillStyle='#c9684f';ctx.fillRect(p.x,p.top,p.width,7);ctx.fillStyle='#e28b63';
    for(let x=p.x+5;x<p.x+p.width-2;x+=26){ctx.beginPath();ctx.moveTo(x,p.top+10);ctx.lineTo(x+8,p.top+5+(x%4));ctx.lineTo(x+17,p.top+10);ctx.closePath();ctx.fill();ctx.fillStyle='#67313b';ctx.fillRect(x+4,p.top+18,13,4);ctx.fillStyle='#e28b63';}
  } else if (theme === 'city') {
    ctx.fillStyle='#384b68';ctx.fillRect(p.x,p.top,p.width,depth);ctx.fillStyle='#8196ab';ctx.fillRect(p.x,p.top,p.width,5);ctx.fillStyle='#55d7f5';ctx.fillRect(p.x,p.top+4,p.width,2);ctx.fillStyle='#263852';
    for(let x=p.x+7;x<p.x+p.width-3;x+=21){ctx.fillRect(x,p.top+11,12,14);ctx.fillStyle='#ffc86e';ctx.fillRect(x+3,p.top+14,3,4);ctx.fillRect(x+8,p.top+14,3,4);ctx.fillStyle='#263852';}
  } else {
    ctx.fillStyle = '#8a5734'; ctx.fillRect(p.x, p.top, p.width, depth); ctx.fillStyle = '#b87943';
    for (let x = p.x + 4; x < p.x + p.width; x += 37) { ctx.fillRect(x, p.top + 9, Math.min(27, p.x + p.width - x - 2), 7); ctx.fillRect(x + 11, p.top + 21, 18, 6); }
    ctx.fillStyle = '#50ad45'; ctx.fillRect(p.x, p.top - 8, p.width, 11); ctx.fillStyle = '#8ae05c'; ctx.fillRect(p.x, p.top - 8, p.width, 3);
    for (let x = p.x + 9; x < p.x + p.width - 3; x += 23) { ctx.strokeStyle = '#318a3e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, p.top - 5); ctx.lineTo(x - 3, p.top - 12 - Math.sin(x + now / 400) * 2); ctx.stroke(); }
  }
  if (theme === 'meadow' && p.top < 460 && p.x > 250 && p.x < 950) {
    ctx.fillStyle = '#795036'; ctx.fillRect(p.x+12,p.top+depth,15,Math.min(500-p.top-depth,55)); ctx.fillRect(p.x+p.width-28,p.top+depth,15,Math.min(500-p.top-depth,55));
  } else if (theme === 'city' && p.x > 250 && p.x < 950) {
    ctx.fillStyle='#2d3c56';ctx.fillRect(p.x+12,p.top+depth,12,Math.min(500-p.top-depth,55));ctx.fillRect(p.x+p.width-26,p.top+depth,12,Math.min(500-p.top-depth,55));
  }
}

function drawGoal(ctx, length, now) {
  const x = length - 76;
  const goalPlatform = getPlatformLayout()[getPlatformLayout().length - 1];
  const ground = goalPlatform.top;
  ctx.fillStyle = '#425c74'; ctx.fillRect(x, ground - 69, 5, 69);
  ctx.fillStyle = '#fff9dc'; ctx.fillRect(x + 4, ground - 67, 42, 24);
  const cell = 6; for (let row=0; row<4; row++) for (let col=0; col<7; col++) { ctx.fillStyle=(row+col)%2===0?'#172940':'#fff'; ctx.fillRect(x+4+col*cell,ground-67+row*6,cell,6); }
  ctx.fillStyle = '#ef4f5f'; ctx.beginPath(); ctx.moveTo(x+4,ground-43); ctx.lineTo(x+34,ground-32+Math.sin(now/220)*2); ctx.lineTo(x+4,ground-21); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#17334c'; ctx.font = '900 12px Nunito'; ctx.textAlign = 'center'; ctx.fillText('CÉL', x + 18, ground - 77);
}
function drawObstacle(ctx, o, now) {
  const x = o.x; const ground = Number.isFinite(o.groundY) ? o.groundY : GROUND_Y;
  if (o.type === 'crate') {
    ctx.fillStyle='#87512d'; ctx.fillRect(x-21,ground-39,42,39); ctx.fillStyle='#c88a4b'; ctx.fillRect(x-18,ground-36,36,33); ctx.strokeStyle='#754323'; ctx.lineWidth=4; ctx.strokeRect(x-17,ground-35,34,31); ctx.beginPath(); ctx.moveTo(x-16,ground-34); ctx.lineTo(x+16,ground-3); ctx.moveTo(x+16,ground-34); ctx.lineTo(x-16,ground-3); ctx.stroke(); ctx.fillStyle='#f3ca7d'; ctx.fillRect(x-4,ground-21,8,4);
  } else if (o.type === 'saw') {
    ctx.save(); ctx.translate(x,ground-23); ctx.rotate(now/180); ctx.fillStyle='#687c90'; ctx.strokeStyle='#edf6ff'; ctx.lineWidth=3; ctx.beginPath(); for(let i=0;i<24;i++){const a=i*Math.PI*2/24;const r=i%2===0?24:17;const px=Math.cos(a)*r,py=Math.sin(a)*r;if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);}ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle='#d6e4f3';ctx.beginPath();ctx.arc(0,0,7,0,Math.PI*2);ctx.fill();ctx.fillStyle='#425269';ctx.beginPath();ctx.arc(0,0,3,0,Math.PI*2);ctx.fill();ctx.restore();ctx.fillStyle='#384c66';ctx.fillRect(x-19,ground-3,38,5);
  } else if (o.type === 'spikes') {
    ctx.fillStyle='#b9c9d9';ctx.strokeStyle='#617b97';ctx.lineWidth=2;ctx.beginPath();for(let i=0;i<3;i++){const sx=x-24+i*16;ctx.moveTo(sx,ground);ctx.lineTo(sx+8,ground-27);ctx.lineTo(sx+16,ground);}ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle='#647b93';ctx.fillRect(x-25,ground-2,50,5);
  } else if (o.type === 'spring') {
    ctx.fillStyle='#2cb56c';ctx.fillRect(x-24,ground-8,48,8);ctx.strokeStyle='#f2f6ff';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(x,ground-8);for(let i=0;i<4;i++)ctx.lineTo(x+(i%2===0?13:-13),ground-11-i*7);ctx.stroke();ctx.fillStyle='#ff5d69';ctx.fillRect(x-22,ground-38,44,8);ctx.fillStyle='#ff9ba1';ctx.fillRect(x-18,ground-36,36,3);
  } else if (o.type === 'barrel') {
    ctx.save();ctx.translate(x,ground-18);ctx.rotate(now/320);ctx.fillStyle='#ad682f';ctx.strokeStyle='#633c27';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(0,0,20,18,0,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.strokeStyle='#e2b16c';ctx.lineWidth=4;ctx.beginPath();ctx.ellipse(0,0,13,18,0,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(-19,0);ctx.lineTo(19,0);ctx.stroke();ctx.restore();
  }
  ctx.fillStyle='#14263d55';ctx.beginPath();ctx.ellipse(x,ground+2,o.type==='saw'?24:19,4,0,0,Math.PI*2);ctx.fill();
}
function drawAnimalNameTag(ctx, p, x, base, bob) {
  ctx.save();
  ctx.font = '900 13px Nunito';
  const label = p.name || 'Játékos';
  const width = ctx.measureText(label).width;
  const tx = x - width / 2 - 8;
  const ty = base - 68 + bob - (p.labelOffset || 0);
  ctx.fillStyle = p.id === socket.id ? '#153c54' : '#203752';
  roundRect(ctx, tx, ty, width + 16, 20, 7); ctx.fill();
  ctx.strokeStyle = p.id === socket.id ? '#ffe17c' : '#ffffffa0'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x, ty + 10);
  ctx.restore();
}
function drawAnimal(ctx,p,now) {
  const type=ANIMALS[p.animal] ? p.animal : 'pig';
  const bob=p.jumping ? -2.2 : (p.moving ? Math.abs(Math.sin(now/92))*2.4 : Math.sin(now/520+p.joinOrder)*.9);
  const base=GROUND_Y+(p.y||0);
  const x=p.x;
  const sprite = ANIMAL_SPRITES[type];
  if (sprite && sprite.complete && sprite.naturalWidth >= 160) {
    ctx.save();
    ctx.fillStyle = '#18465e42'; ctx.beginPath(); ctx.ellipse(x, base + 2, p.moving ? 13 : 14, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.translate(x, base + bob);
    if (p.face < 0) ctx.scale(-1, 1);
    if (p.moving) ctx.rotate(Math.sin(now / 70) * .055);
    const frame = p.moving ? (Math.floor(now / 170) % 2) : 0;
    const squash = p.jumping ? 1.035 : (p.moving ? 0.96 + Math.abs(Math.sin(now / 72)) * 0.06 : 1);
    ctx.scale(1 / Math.sqrt(squash), squash);
    ctx.drawImage(sprite, frame * 80, 0, 80, 80, -30, -58, 60, 60);
    if ((p.shields || 0) > 0) {
      ctx.strokeStyle = '#8ee9ffbb'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, -23, 18, 22, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#b8f6ff'; ctx.font = 'bold 11px Nunito'; ctx.textAlign = 'center'; ctx.fillText('🛡', 0, -44);
    }
    ctx.restore();
    drawAnimalNameTag(ctx, p, x, base, bob);
    return;
  }
  ctx.save();
  // shadow
  ctx.fillStyle='#18465e42';ctx.beginPath();ctx.ellipse(x,base+3,p.moving?16:19,4,0,0,Math.PI*2);ctx.fill();
  ctx.translate(x,base+bob); ctx.scale(.78,.78); if(p.face<0)ctx.scale(-1,1);
  const legSwing=p.moving?Math.sin(now/43)*.42:Math.sin(now/240)*.05;
  // tail
  if(type==='pig'){ctx.strokeStyle='#f18ba1';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-15,-20);ctx.bezierCurveTo(-25,-27,-23,-13,-17,-16);ctx.stroke();}
  if(type==='raccoon'){ctx.save();ctx.translate(-17,-19);ctx.rotate(-.2+Math.sin(now/230)*.12);ctx.fillStyle='#8b98a8';ctx.beginPath();ctx.ellipse(-7,0,13,6,-.1,0,Math.PI*2);ctx.fill();for(let i=0;i<3;i++){ctx.fillStyle=i%2?'#f5f2e9':'#4b5668';ctx.fillRect(-16+i*6,-5,4,10);}ctx.restore();}
  // legs animate by rotation
  const legColor=type==='penguin'?'#f6a93e':type==='horse'?'#71412f':type==='capybara'?'#795239':type==='raccoon'?'#667183':'#d6778a';
  for(const lx of [-10,7]){ctx.save();ctx.translate(lx,-7);ctx.rotate(lx<0?legSwing:-legSwing);ctx.fillStyle=legColor;roundRect(ctx,-4,-1,8,13,3);ctx.fill();ctx.restore();}
  // body
  if(type==='pig'){
    ctx.fillStyle='#f18ba1';ctx.beginPath();ctx.ellipse(0,-20,19,14,-.08,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#ffb0bf';ctx.beginPath();ctx.ellipse(8,-34,13,12,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#ed8197';ctx.beginPath();ctx.moveTo(0,-43);ctx.lineTo(-3,-54);ctx.lineTo(7,-47);ctx.closePath();ctx.fill();ctx.beginPath();ctx.moveTo(11,-44);ctx.lineTo(18,-53);ctx.lineTo(20,-42);ctx.closePath();ctx.fill();
    ctx.fillStyle='#ffcada';ctx.beginPath();ctx.ellipse(18,-31,8,6,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#a84c65';ctx.beginPath();ctx.arc(16,-31,1.5,0,Math.PI*2);ctx.arc(20,-31,1.5,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#302438';ctx.beginPath();ctx.arc(11,-38,2.2,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(11.5,-38.7,.7,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#a84c65';ctx.lineWidth=1.4;ctx.beginPath();ctx.arc(10,-29,3,0.1,1.2);ctx.stroke();
  } else if(type==='capybara'){
    ctx.fillStyle='#a87548';ctx.beginPath();ctx.ellipse(-1,-21,20,14,-.06,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#c58b59';ctx.beginPath();ctx.ellipse(9,-32,14,12,.2,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#9a633d';ctx.beginPath();ctx.ellipse(18,-28,9,6,.2,0,Math.PI*2);ctx.fill();ctx.fillStyle='#262a30';ctx.beginPath();ctx.arc(22,-30,2.2,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#8d5d3b';ctx.beginPath();ctx.ellipse(2,-43,4,3,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(12,-37,3,0,Math.PI*2);ctx.fill();ctx.fillStyle='#1d2533';ctx.beginPath();ctx.arc(13,-37,1.8,0,Math.PI*2);ctx.fill();
  } else if(type==='horse'){
    ctx.fillStyle='#ad633a';ctx.beginPath();ctx.ellipse(-1,-20,19,13,-.15,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#b97144';ctx.beginPath();ctx.ellipse(8,-34,10,15,-.35,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(17,-40,13,8,.15,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#4a2d2b';ctx.beginPath();ctx.moveTo(-2,-44);ctx.quadraticCurveTo(2,-60,13,-52);ctx.lineTo(15,-43);ctx.lineTo(8,-45);ctx.lineTo(4,-39);ctx.closePath();ctx.fill();
    ctx.fillStyle='#ad633a';ctx.beginPath();ctx.moveTo(2,-44);ctx.lineTo(-3,-54);ctx.lineTo(8,-49);ctx.closePath();ctx.fill();ctx.beginPath();ctx.moveTo(13,-46);ctx.lineTo(19,-54);ctx.lineTo(20,-43);ctx.closePath();ctx.fill();
    ctx.fillStyle='#e8b18c';ctx.beginPath();ctx.ellipse(25,-39,6,4,.1,0,Math.PI*2);ctx.fill();ctx.fillStyle='#2b2230';ctx.beginPath();ctx.arc(18,-43,2.2,0,Math.PI*2);ctx.fill();
  } else if(type==='penguin'){
    ctx.fillStyle='#27344a';ctx.beginPath();ctx.ellipse(0,-23,17,21,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#f7f4eb';ctx.beginPath();ctx.ellipse(3,-20,10,15,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#202b41';ctx.beginPath();ctx.arc(3,-41,13,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#f7f4eb';ctx.beginPath();ctx.ellipse(4,-40,8,7,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#ffb33c';ctx.beginPath();ctx.moveTo(12,-38);ctx.lineTo(24,-34);ctx.lineTo(12,-31);ctx.closePath();ctx.fill();
    ctx.fillStyle='#141c2d';ctx.beginPath();ctx.arc(7,-42,2,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#ffa72e';roundRect(ctx,-13,-3,10,5,2);ctx.fill();roundRect(ctx,4,-3,10,5,2);ctx.fill();
    ctx.fillStyle='#19263a';ctx.beginPath();ctx.ellipse(-14,-22,5,11,-.4,0,Math.PI*2);ctx.fill();
  } else if(type==='raccoon'){
    ctx.fillStyle='#929dad';ctx.beginPath();ctx.ellipse(-1,-21,19,14,-.08,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#aab4c1';ctx.beginPath();ctx.arc(9,-35,13,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#596474';ctx.beginPath();ctx.moveTo(1,-43);ctx.lineTo(-3,-53);ctx.lineTo(7,-48);ctx.closePath();ctx.fill();ctx.beginPath();ctx.moveTo(12,-44);ctx.lineTo(20,-52);ctx.lineTo(21,-41);ctx.closePath();ctx.fill();
    ctx.fillStyle='#424d5d';ctx.beginPath();ctx.ellipse(8,-35,12,5,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(5,-36,2,0,Math.PI*2);ctx.arc(13,-36,2,0,Math.PI*2);ctx.fill();ctx.fillStyle='#263144';ctx.beginPath();ctx.arc(5,-36,1,0,Math.PI*2);ctx.arc(13,-36,1,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#e7e9ed';ctx.beginPath();ctx.ellipse(20,-30,5,4,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#252e40';ctx.beginPath();ctx.arc(22,-31,1.5,0,Math.PI*2);ctx.fill();
  }
  // cheeks and tiny highlight
  if(type!=='penguin'){ctx.fillStyle='#fff';ctx.globalAlpha=.45;ctx.beginPath();ctx.ellipse(-6,-28,3,2,-.3,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}
  // name tag
  ctx.restore();
  ctx.save();ctx.font='900 13px Nunito';const label=p.name||'Játékos';const tw=ctx.measureText(label).width;const tx=x-tw/2-8;const ty=base-58+bob-(p.labelOffset||0);
  ctx.fillStyle=p.id===socket.id?'#153c54':'#203752';roundRect(ctx,tx,ty,tw+16,20,7);ctx.fill();ctx.strokeStyle=p.id===socket.id?'#ffe17c':'#ffffff75';ctx.lineWidth=1.5;ctx.stroke();ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,x,ty+10);ctx.restore();
}

window.addEventListener('keydown', e => {
  if (currentScreen !== 'game') return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.code === 'Tab') {
    e.preventDefault();
    $('scoreOverlay')?.classList.remove('hidden');
    return;
  }
  if (roomState?.phase !== 'race') return;
  if (e.code === 'Space') { e.preventDefault(); return; } // W is the only jump key.
  if (e.code === 'KeyW') {
    e.preventDefault();
    jumpHeld = true;
    if (!e.repeat) jumpQueuedUntil = performance.now() + JUMP_BUFFER_MS;
    return;
  }
  if (['ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
});
window.addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'KeyW') {
    jumpHeld = false;
    // The upward hold force stops instantly on release; a quick tap remains a small hop.
    jumpLaunchedByW = false;
  }
  if (e.code === 'Tab') $('scoreOverlay')?.classList.add('hidden');
});
window.addEventListener('blur', () => { keys = Object.create(null); jumpQueuedUntil = 0; jumpHeld = false; jumpLaunchedByW = false; jumpHoldElapsed = 0; $('scoreOverlay')?.classList.add('hidden'); });

// Keep the timer fresh even in the lobby-to-game transitions.
setInterval(() => { if (currentScreen === 'game' && roomState) updateGameChrome(); }, 250);
