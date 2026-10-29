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
const ITEMS = [
  { type: 'crate', name: 'Csapdaláda', icon: '📦', price: 10, desc: 'Ugorjátok át!' },
  { type: 'saw', name: 'Forgó fűrész', icon: '⚙️', price: 25, desc: 'Halálos csapda' },
  { type: 'spikes', name: 'Tüskék', icon: '🔺', price: 20, desc: 'Egy rossz lépés…' },
  { type: 'spring', name: 'Rugós kilövő', icon: '🌀', price: 30, desc: 'Magasra repít' },
  { type: 'barrel', name: 'Guruló hordó', icon: '🛢️', price: 25, desc: 'Veszélyes akadály' },
  { type: 'shield', name: 'Pajzs', icon: '🛡️', price: 20, desc: 'Egy találatot véd' }
];
let roomState = null;
let livePlayers = [];
let currentScreen = 'home';
let currentRenderedPhase = null;
let selectedBuildType = null;
let preferredName = '';
let toastTimeout = null;
let lastTick = performance.now();
let lastSendAt = 0;
let keys = Object.create(null);
let lastHitAt = Object.create(null);
let lastDeathCount = 0;
let lastShieldCount = 0;
let lastFallAt = 0;
let physicsAccumulator = 0;
let remoteVisuals = new Map();
let motion = { x: 45, y: 0, vy: 0, face: 1, moving: false, jumping: false, grounded: true, coyoteUntil: 0, pauseUntil: 0 };
let mouseWorld = null;
let jumpQueuedUntil = 0;
const JUMP_BUFFER_MS = 180;
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

socket.on('connect', () => { $('connectionLabel').textContent = 'Kapcsolódva'; $('connectionLabel').style.color = '#78e5a8'; });
socket.on('disconnect', () => { $('connectionLabel').textContent = 'Kapcsolat megszakadt'; $('connectionLabel').style.color = '#ff7c8d'; toast('Megszakadt a kapcsolat a szerverrel.'); });
socket.on('connect_error', () => { $('connectionLabel').textContent = 'Kapcsolódási hiba'; });
socket.on('roomState', next => {
  const priorPhase = roomState?.phase;
  const priorCode = roomState?.code;
  roomState = next;
  livePlayers = (next.players || []).map(p => ({ ...p }));
  if (priorCode !== next.code) selectedBuildType = null;
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
        lastDeathCount = me?.deaths ?? 0; lastShieldCount = me?.shields ?? 0;
        lastFallAt = 0; lastSendAt = 0;
        jumpQueuedUntil = 0;
      }
      if (next.phase !== 'build' || next.currentBuilderId !== socket.id) selectedBuildType = null;
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
    const respawned = deathCount > lastDeathCount;
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
      jumpQueuedUntil = 0;
    }
    lastDeathCount = deathCount; lastShieldCount = shieldCount;
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
      <span class="animal-emoji">${animal.emoji}</span><strong>${animal.label}</strong>
    </button>`).join('');
  const playerRows = players.map(p => `
    <div class="player-row"><div class="player-avatar">${ANIMALS[p.animal]?.emoji || '🐾'}</div><div class="player-meta"><strong>${escapeHtml(p.name)} ${p.id === socket.id ? '<span class="muted">(Te)</span>' : ''}</strong><small>${ANIMALS[p.animal]?.label || 'Állat'} · ${p.connected ? 'Készen áll' : 'Kilépett'}</small></div>${p.id === roomState.hostId ? '<span class="host-tag">👑 GAZDA</span>' : ''}</div>`).join('');
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
        <div><label class="form-label" for="setTime">Köridő (másodperc)</label><input class="form-input" id="setTime" type="number" min="15" max="600" value="${s.roundSeconds}" ${!isHost ? 'disabled' : ''}></div>
        <div><label class="form-label" for="setRounds">Körök száma</label><input class="form-input" id="setRounds" type="number" min="1" max="12" value="${s.rounds}" ${!isHost ? 'disabled' : ''}></div>
        
      </div>
      ${isHost ? '<button class="secondary-button full" id="saveSettingsBtn">Beállítások mentése</button>' : ''}
      <div class="setting-note">A köridő lejártakor a célba nem érők nem kapnak helyezési pontot. Az aranyat a megtett útért is gyűjtitek. Az építmények a további körökben is a pályán maradnak.</div>
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
        roundSeconds: Number($('setTime').value), rounds: Number($('setRounds').value)
      }, 'Beállítások elmentve.');
    });
    $('startGameBtn').addEventListener('click', () => emitAck('startGame', {}, 'A verseny indul!'));
  }
}

function renderGame() {
  if (!roomState) return;
  switchScreen('game');
  selectedBuildType = roomState.phase === 'build' && roomState.currentBuilderId === socket.id ? selectedBuildType : null;
  screenGame.innerHTML = `
    <div class="game-top"><div class="game-title"><h1>🐾 ÁllatKáosz</h1><p id="gameStatusText">${escapeHtml(roomState.statusMessage || '')}</p></div><div class="game-statuses"><div class="status-chip">🏁 Kör <b id="roundChip">${roomState.roundNo}/${roomState.settings.rounds}</b></div><div class="status-chip">⏱️ <b id="timerValue">--:--</b></div><div class="status-chip">🪙 Arany <b id="myGoldValue">${getMe()?.gold ?? 0}</b></div><button class="ghost-button" id="exitGameBtn">Kilépés</button></div></div>
    <div class="game-layout"><section class="game-main-col"><div class="world-frame"><canvas id="worldCanvas" width="1100" height="620" tabindex="0" aria-label="Az egyetlen közös akadálypálya. Kattints a pályára, majd W ugrás"></canvas><div class="canvas-overlay"><div class="canvas-pill" id="canvasModeLabel">🏃 VERSENY</div><div class="canvas-pill right">🏁 <strong>Érd el a zászlót!</strong> · TAB: pontok</div></div>
      <section class="score-overlay hidden" id="scoreOverlay" aria-label="Pontok és arany"><div class="score-overlay-head"><strong>🏆 Pontok és arany</strong><button type="button" id="closeScoreButton" aria-label="Bezárás">×</button></div><div class="score-list" id="scoreList"></div><small>Engedd fel a TAB billentyűt az ablak bezárásához.</small></section>
    </div>
      <div class="game-instructions" id="gameInstructions"><span><b>IRÁNYÍTÁS</b> <span class="keycap">A</span><span class="keycap">D</span> / <span class="keycap">←</span><span class="keycap">→</span> futás · <span class="keycap">W</span> ugrás · <span class="keycap">TAB</span> pontok</span><span id="progressInstruction">Aranyat kapsz a megtett útért is.</span></div>
    </section><aside class="side-column"><section class="panel build-panel hidden" id="buildPanel"></section><section class="panel side-card chat-card"><h3>💬 Játékchat</h3><div class="chat-messages" id="chatMessages"></div><form class="chat-entry" id="chatForm"><input id="chatInput" maxlength="260" placeholder="Üzenet a csapatnak…" autocomplete="off"><button type="submit" aria-label="Küldés">➤</button></form></section><section class="panel side-card"><h3>🧰 A táskád</h3><div id="inventoryInfo" class="muted" style="font-size:11px;line-height:1.7"></div></section></aside></div>`;
  $('exitGameBtn').addEventListener('click', () => { socket.emit('leaveRoom'); roomState = null; livePlayers = []; currentRenderedPhase = null; switchScreen('home'); });
  $('chatForm').addEventListener('submit', e => { e.preventDefault(); const text = $('chatInput').value.trim(); if (!text) return; socket.emit('chat', { text }, result => { if (!result?.ok) toast(result?.error || 'Az üzenet nem küldhető el.'); }); $('chatInput').value = ''; $('chatInput').blur(); $('worldCanvas')?.focus({ preventScroll: true }); });
  $('closeScoreButton').addEventListener('click', () => $('scoreOverlay').classList.add('hidden'));
  const canvas = $('worldCanvas');
  canvas.addEventListener('pointerdown', () => { $('chatInput')?.blur(); canvas.focus({ preventScroll: true }); });
  canvas.addEventListener('pointermove', e => {
    const rect = canvas.getBoundingClientRect();
    mouseWorld = { x: ((e.clientX - rect.left) / rect.width) * CANVAS_W, y: ((e.clientY - rect.top) / rect.height) * CANVAS_H };
  });
  canvas.addEventListener('pointerleave', () => { mouseWorld = null; });
  // Focus the playfield whenever a race begins, so W works straight away even
  // if the previous screen had a focused button/input on this machine.
  canvas.focus({ preventScroll: true });
  canvas.addEventListener('click', e => {
    if (!roomState || roomState.phase !== 'build' || !selectedBuildType) return;
    if (roomState.currentBuilderId !== socket.id) return toast('Most nem te építkezel.');
    if (selectedBuildType === 'shield') return toast('A pajzsot a jobb oldali ikonra kattintva tudod megvenni.');
    const rect = canvas.getBoundingClientRect();
    const rawX = ((e.clientX - rect.left) / rect.width) * CANVAS_W;
    const rawY = ((e.clientY - rect.top) / rect.height) * CANVAS_H;
    const x = Math.max(28, Math.min(CANVAS_W - 28, rawX));
    // The cursor marks the center of the build; groundY is the sprite's lower anchor.
    const groundY = Math.max(50, Math.min(600, rawY + 20));
    if (x >= GOAL_BUILD_LIMIT) return toast('A zászló körül szabadon kell hagyni a célzónát!');
    const type = selectedBuildType;
    socket.emit('placeBuild', { type, x, groundY }, result => {
      if (!result?.ok) toast(result?.error || 'Nem sikerült építeni.');
      else { selectedBuildType = null; mouseWorld = null; toast('Elhelyezve! A következő játékos jön.'); }
    });
  });
  updateGameChrome(); updateScoreList(); updateChat(); updateBuildControls();
  if (rafId) cancelAnimationFrame(rafId);
  lastTick = performance.now(); rafId = requestAnimationFrame(gameLoop);
}
function renderEndScreen() {
  switchScreen('game'); currentRenderedPhase = 'ended';
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
  const instr = $('progressInstruction'); if (instr) instr.textContent = roomState.phase === 'build' ? 'Válassz egy építményt, majd kattints a pályára!' : 'Minden 250 megtett egység után +4 arany.';
  const inv = $('inventoryInfo'); if (inv && me) inv.innerHTML = `🛡️ Pajzsok: <b style="color:#ffd66c">${me.shields}</b><br>💀 Halálok: <b>${me.deaths}</b><br>🪙 Arany: <b style="color:#ffd66c">${me.gold}</b><br>🏆 Összpont: <b>${me.score}</b>`;
  const timer = $('timerValue'); if (timer) {
    let seconds = 0;
    if (roomState.phase === 'race' && roomState.roundDeadline) seconds = Math.max(0, Math.ceil((roomState.roundDeadline - Date.now()) / 1000));
    else if (roomState.phase === 'build' && roomState.buildTurnEndsAt) seconds = Math.max(0, Math.ceil((roomState.buildTurnEndsAt - Date.now()) / 1000));
    timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
    timer.style.color = seconds <= 8 ? '#ff7584' : '#ffd66c';
  }
}
function updateScoreList() {
  const el = $('scoreList'); if (!el || !roomState) return;
  const list = [...(livePlayers.length ? livePlayers : roomState.players)].sort((a,b)=>b.score-a.score || b.gold-a.gold);
  el.innerHTML = list.map((p,i)=>`<div class="score-row ${p.id===socket.id?'me':''}"><span class="score-rank">${i+1}</span><span class="score-animal">${ANIMALS[p.animal]?.emoji || '🐾'}</span><span class="score-name">${escapeHtml(p.name)}</span><span class="score-stats"><b>${p.score} p</b>🪙 ${p.gold}</span></div>`).join('');
  updateGameChrome();
}
function updateChat() {
  const el = $('chatMessages'); if (!el || !roomState) return;
  const messages = roomState.chat || [];
  el.innerHTML = messages.slice(-40).map(m=>`<div class="chat-line ${m.system?'system':''}"><span class="chat-name">${escapeHtml(m.name)}:</span> ${escapeHtml(m.text)}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}
function updateBuildControls() {
  const panel = $('buildPanel'); if (!panel || !roomState) return;
  if (roomState.phase !== 'build') { panel.classList.add('hidden'); panel.innerHTML=''; return; }
  panel.classList.remove('hidden');
  const me = getMe(); const isMe = roomState.currentBuilderId === socket.id;
  const builder = roomState.players.find(p => p.id === roomState.currentBuilderId);
  if (!isMe) selectedBuildType = null;
  const cards = ITEMS.map(item => `<button type="button" class="shop-item ${selectedBuildType===item.type?'selected':''}" data-item="${item.type}" ${!isMe || (me?.gold ?? 0) < item.price ? 'disabled' : ''}><span class="shop-icon">${item.icon}</span><strong>${item.name}</strong><small>🪙 ${item.price}</small></button>`).join('');
  panel.innerHTML = `<div class="build-top"><div><h3>🔨 Építkezési fázis</h3><p>${isMe ? 'Válassz ikont, majd kattints bárhová a pályán.' : `Most ${escapeHtml(builder?.name || 'egy játékos')} építkezik.`}</p></div><span class="build-turn-pill">${isMe?'TE JÖSSZ':'VÁRJ A SORODRA'}</span></div><div class="shop-grid">${cards}</div><div class="build-footer"><span class="build-help">Az előnézet pontosan mutatja a helyet. Levegőbe is építhetsz; a zászló körül a célzóna tiltott.</span>${isMe?'<button class="ghost-button" id="skipBuildBtn">Kihagyom →</button>':''}</div>`;
  panel.querySelectorAll('[data-item]').forEach(btn => btn.addEventListener('click', () => {
    const type = btn.dataset.item;
    if (type === 'shield') {
      socket.emit('placeBuild', { type: 'shield' }, result => { if (!result?.ok) toast(result?.error || 'Nem sikerült megvenni.'); else toast('Pajzs megvéve!'); });
    } else { selectedBuildType = type; updateBuildControls(); toast('Az akadály előnézete követi az egeret. Kattints oda, ahová építeni szeretnél.'); }
  }));
  if ($('skipBuildBtn')) $('skipBuildBtn').addEventListener('click', () => emitAck('skipBuild', {}, 'Kihagytad az építkezést.'));
}

const CANVAS_W = 1100, CANVAS_H = 620, GROUND_Y = 430, PLAYER_H = 54, PLAYER_HALF_W = 15;
// A clear landing/approach lane around the finish flag. Objects can be placed
// anywhere else, including in mid-air, but never where they could seal the goal.
const GOAL_SAFE_LEFT = 910;
const GOAL_BUILD_LIMIT = GOAL_SAFE_LEFT - 28; // keep the whole object outside the goal corridor
const PLATFORMS = [
  { x: 0,   width: 290, top: 430 },
  { x: 324, width: 128, top: 475 },
  { x: 475, width: 166, top: 395 },
  { x: 665, width: 142, top: 428 },
  { x: 830, width: 116, top: 470 },
  { x: 958, width: 142, top: 390 }
];
function getSolidSurfaces() {
  const surfaces = PLATFORMS.map((p, i) => ({ x: p.x, width: p.width, top: p.top, kind: 'platform', key: `platform-${i}` }));
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
  return PLATFORMS.find(p => x >= p.x + padding && x <= p.x + p.width - padding) || null;
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
  updateGameChrome();
  rafId = requestAnimationFrame(gameLoop);
}
function physicsStep(dt, now) {
  if (!roomState || roomState.phase !== 'race') return;
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
    motion.vy = -625;
    motion.grounded = false;
    motion.jumping = true;
    jumpQueuedUntil = 0;
    motion.coyoteUntil = 0;
  }

  const left = !!(keys.ArrowLeft || keys.KeyA), right = !!(keys.ArrowRight || keys.KeyD);
  motion.moving = left !== right;
  const previousX = motion.x;
  let nextX = motion.x;
  if (left !== right) {
    motion.face = right ? 1 : -1;
    nextX += (right ? 245 : -245) * dt;
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
    jumpQueuedUntil = 0;
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
  if (motion.x >= CANVAS_W - 90 && Math.abs((GROUND_Y + motion.y) - PLATFORMS[PLATFORMS.length - 1].top) <= 30) {
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
  ctx.clearRect(0, 0, w, h);
  drawScenery(ctx, length, now, 0);
  for (const o of roomState.obstacles || []) drawObstacle(ctx, o, now);
  drawGoal(ctx, length, now);
  if (isBuild) {
    ctx.save();
    ctx.fillStyle = '#ff53631a'; ctx.fillRect(GOAL_BUILD_LIMIT, 0, length - GOAL_BUILD_LIMIT, CANVAS_H);
    ctx.strokeStyle = '#ff6b7d'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.moveTo(GOAL_BUILD_LIMIT, 0); ctx.lineTo(GOAL_BUILD_LIMIT, CANVAS_H); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#552638dd'; roundRect(ctx, GOAL_BUILD_LIMIT + 10, 60, 154, 24, 7); ctx.fill();
    ctx.fillStyle = '#fff1f3'; ctx.font = 'bold 11px Nunito'; ctx.textAlign = 'center'; ctx.fillText('CÉLZÓNA – TILOS ÉPÍTENI', GOAL_BUILD_LIMIT + 87, 76);
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
  if (isBuild && selectedBuildType && mouseWorld && selectedBuildType !== 'shield') {
    const px = Math.max(28, Math.min(length - 28, mouseWorld.x));
    const ground = Math.max(50, Math.min(600, mouseWorld.y + 20));
    const inGoalZone = px >= GOAL_BUILD_LIMIT;
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.strokeStyle = inGoalZone ? '#ff6177' : '#ffe16a'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(px, Math.max(15, ground - 60)); ctx.lineTo(px, Math.min(CANVAS_H - 8, ground + 8)); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 0.68;
    drawObstacle(ctx, { type: selectedBuildType, x: px, groundY: ground }, now);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = inGoalZone ? '#ff6177' : '#5be89b'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(px, ground + 2, 28, 8, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = inGoalZone ? '#651d31' : '#123d30'; roundRect(ctx, Math.max(4, Math.min(w - 112, px - 54)), Math.max(52, ground - 72), 108, 23, 8); ctx.fill();
    ctx.fillStyle = inGoalZone ? '#fff0f2' : '#ddffe9'; ctx.font = 'bold 12px Nunito'; ctx.textAlign = 'center'; ctx.fillText(inGoalZone ? 'CÉLZÓNA – TILOS' : 'IDE ÉPÜL', Math.max(58, Math.min(w - 58, px)), Math.max(67, ground - 57));
    ctx.restore();
  }
  if (!isBuild) {
    const myP = players.find(p => p.id === socket.id);
    if (myP?.finished) { ctx.fillStyle='#10233ddb'; roundRect(ctx,w/2-145,65,290,46,14); ctx.fillStyle='#ffe078'; ctx.font='bold 17px Nunito'; ctx.textAlign='center'; ctx.fillText(`🏁 CÉLBA ÉRTÉL! Helyezés: ${myP.finishRank}.`,w/2,94); }
  } else {
    ctx.fillStyle = '#10213cdd'; roundRect(ctx, 285, 15, 530, 35, 12); ctx.fill(); ctx.fillStyle='#e9f5ff'; ctx.font='bold 13px Nunito'; ctx.textAlign='center'; ctx.fillText(selectedBuildType ? 'Mozgasd az egeret, majd kattints bárhová az építéshez.' : 'Építkezési fázis: válassz akadályt a jobb oldali panelen.', w/2, 37);
  }
}
function roundRect(ctx,x,y,w,h,r) { ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function drawScenery(ctx, length, now, cam) {
  const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  sky.addColorStop(0, '#58bdf8'); sky.addColorStop(0.55, '#bdeaff'); sky.addColorStop(1, '#f1fcff');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, length, CANVAS_H);
  // Distant hills and a few clouds give the single-screen course depth.
  for (let i = 0; i < 6; i++) {
    const x = i * 225 - 55;
    ctx.fillStyle = i % 2 ? '#8ccac5' : '#a1d8d1';
    ctx.beginPath(); ctx.moveTo(x - 70, 430); ctx.lineTo(x + 45, 225 + (i % 3) * 22); ctx.lineTo(x + 180, 430); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#7fbdad'; ctx.beginPath(); ctx.moveTo(x + 65, 430); ctx.lineTo(x + 170, 270 + (i % 2) * 18); ctx.lineTo(x + 300, 430); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#fff5b5'; ctx.beginPath(); ctx.arc(955, 75, 27, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 4; i++) {
    const x = 90 + i * 285 + Math.sin(now / 2500 + i) * 10; const y = 65 + i % 2 * 45;
    ctx.fillStyle = '#ffffffb8'; ctx.beginPath(); ctx.ellipse(x, y, 30, 12, 0, 0, Math.PI * 2); ctx.ellipse(x + 19, y - 9, 21, 16, 0, 0, Math.PI * 2); ctx.ellipse(x + 41, y, 27, 11, 0, 0, Math.PI * 2); ctx.fill();
  }
  // Water below the islands.
  const water = ctx.createLinearGradient(0, 492, 0, CANVAS_H); water.addColorStop(0, '#39bde8'); water.addColorStop(1, '#1474be');
  ctx.fillStyle = water; ctx.fillRect(0, 500, length, CANVAS_H - 500);
  ctx.strokeStyle = '#b8f5ff'; ctx.lineWidth = 3;
  for (let i = 0; i < 11; i++) {
    const x = (i * 113 + (now / 60) % 113) - 20; const y = 520 + (i % 3) * 24;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 15, y - 5, x + 30, y); ctx.stroke();
  }
  for (const p of PLATFORMS) drawPlatform(ctx, p, now);
  // Start marker.
  ctx.fillStyle = '#e9f5ff'; ctx.fillRect(17, PLATFORMS[0].top - 36, 4, 36);
  ctx.fillStyle = '#17334c'; roundRect(ctx, 13, PLATFORMS[0].top - 57, 58, 18, 5); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = '900 11px Nunito'; ctx.textAlign = 'center'; ctx.fillText('RAJT', 42, PLATFORMS[0].top - 44);
}
function drawPlatform(ctx, p, now) {
  const depth = 30;
  ctx.fillStyle = '#8a5734'; ctx.fillRect(p.x, p.top, p.width, depth);
  ctx.fillStyle = '#b87943';
  for (let x = p.x + 4; x < p.x + p.width; x += 37) {
    ctx.fillRect(x, p.top + 9, Math.min(27, p.x + p.width - x - 2), 7);
    ctx.fillRect(x + 11, p.top + 21, 18, 6);
  }
  ctx.fillStyle = '#50ad45'; ctx.fillRect(p.x, p.top - 8, p.width, 11);
  ctx.fillStyle = '#8ae05c'; ctx.fillRect(p.x, p.top - 8, p.width, 3);
  for (let x = p.x + 9; x < p.x + p.width - 3; x += 23) {
    ctx.strokeStyle = '#318a3e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, p.top - 5); ctx.lineTo(x - 3, p.top - 12 - Math.sin(x + now / 400) * 2); ctx.stroke();
  }
  // Simple timber supports beneath the floating platforms.
  if (p.top < 460 && p.x > 250 && p.x < 950) {
    ctx.fillStyle = '#795036'; ctx.fillRect(p.x + 12, p.top + depth, 15, Math.min(500 - p.top - depth, 55));
    ctx.fillRect(p.x + p.width - 28, p.top + depth, 15, Math.min(500 - p.top - depth, 55));
  }
}
function drawGoal(ctx, length, now) {
  const x = length - 76;
  const goalPlatform = PLATFORMS[PLATFORMS.length - 1];
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
function drawAnimal(ctx,p,now) {
  const type=ANIMALS[p.animal] ? p.animal : 'pig';
  const bob=p.moving?Math.sin(now/48)*2.2:Math.sin(now/400+p.joinOrder)*1.1;
  const base=GROUND_Y+(p.y||0);
  const x=p.x;
  ctx.save();
  // shadow
  ctx.fillStyle='#18465e42';ctx.beginPath();ctx.ellipse(x,base+3,p.moving?16:19,4,0,0,Math.PI*2);ctx.fill();
  ctx.translate(x,base+bob); if(p.face<0)ctx.scale(-1,1);
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
  ctx.save();ctx.font='bold 13px Nunito';const label=p.name||'Játékos';const tw=ctx.measureText(label).width;const tx=x-tw/2-7;const ty=base-61+bob-(p.labelOffset||0);
  ctx.fillStyle=p.id===socket.id?'#153c54':'#203752';roundRect(ctx,tx,ty,tw+14,20,7);ctx.fill();ctx.strokeStyle=p.id===socket.id?'#ffe17c':'#ffffff75';ctx.lineWidth=1.5;ctx.stroke();ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,x,ty+10);ctx.restore();
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
    if (!e.repeat) jumpQueuedUntil = performance.now() + JUMP_BUFFER_MS;
    return;
  }
  if (['ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
});
window.addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'Tab') $('scoreOverlay')?.classList.add('hidden');
});
window.addEventListener('blur', () => { keys = Object.create(null); jumpQueuedUntil = 0; $('scoreOverlay')?.classList.add('hidden'); });

// Keep the timer fresh even in the lobby-to-game transitions.
setInterval(() => { if (currentScreen === 'game' && roomState) updateGameChrome(); }, 250);
