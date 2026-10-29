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
let motion = { x: 45, y: 0, vy: 0, face: 1, moving: false, jumping: false, lastSpringAt: 0, pauseUntil: 0 };
let mouseWorldX = null;
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
      if (next.phase === 'race') {
        const me = next.players.find(p => p.id === socket.id);
        motion = { x: me?.x ?? 45, y: me?.y ?? 0, vy: 0, face: 1, moving: false, jumping: false, lastSpringAt: 0, pauseUntil: 0 };
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
socket.on('playersMoved', players => {
  if (!roomState) return;
  livePlayers = players.map(p => ({ ...p }));
  roomState.players = roomState.players.map(old => ({ ...old, ...(players.find(p => p.id === old.id) || {}) }));
  const me = players.find(p => p.id === socket.id);
  if (me && currentScreen === 'game' && roomState.phase === 'race') {
    if (Math.abs(me.x - motion.x) > 75) { motion.x = me.x; motion.vy = 0; motion.pauseUntil = 0; }
    if (Math.abs((me.y || 0) - motion.y) > 70) { motion.y = me.y || 0; motion.vy = motion.y < 0 ? -170 : 0; }
    if (me.finished) { motion.x = me.x; motion.moving = false; }
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
        <div style="grid-column:1/-1"><label class="form-label" for="setLength">Pályahossz</label><select class="form-input" id="setLength" ${!isHost ? 'disabled' : ''}><option value="1800" ${s.mapLength===1800?'selected':''}>Rövid — 1800</option><option value="2200" ${s.mapLength===2200?'selected':''}>Normál — 2200</option><option value="2800" ${s.mapLength===2800?'selected':''}>Hosszú — 2800</option><option value="3400" ${s.mapLength===3400?'selected':''}>Maraton — 3400</option></select></div>
      </div>
      ${isHost ? '<button class="secondary-button full" id="saveSettingsBtn">Beállítások mentése</button>' : ''}
      <div class="setting-note">A köridő lejártakor a célba nem érők nem kapnak helyezési pontot. Az aranyat a megtett útért is gyűjtitek. Az építmények a további körökben is a pályán maradnak.</div>
    </aside></div>
    <div class="lobby-bottom"><span>🕹️ Mozgás: A/D vagy ←/→ · Ugrás: Space / W / ↑</span><span>Elsőként célba érő: több pont · Kör végén: építkezés</span></div>`;

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
        roundSeconds: Number($('setTime').value), rounds: Number($('setRounds').value), mapLength: Number($('setLength').value)
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
    <div class="game-layout"><section class="game-main-col"><div class="world-frame"><canvas id="worldCanvas" width="1100" height="460" aria-label="A közös akadálypálya"></canvas><div class="canvas-overlay"><div class="canvas-pill" id="canvasModeLabel">🏃 VERSENY</div><div class="canvas-pill right">🏁 <strong>Érd el a zászlót!</strong></div></div></div>
      <div class="game-instructions" id="gameInstructions"><span><b>IRÁNYÍTÁS</b> <span class="keycap">A</span><span class="keycap">D</span> / <span class="keycap">←</span><span class="keycap">→</span> futás · <span class="keycap">SPACE</span> ugrás</span><span id="progressInstruction">Aranyat kapsz a megtett útért is.</span></div>
      <section class="panel build-panel hidden" id="buildPanel"></section>
    </section><aside class="side-column"><section class="panel side-card"><h3>🏆 Állás <small>összpont</small></h3><div class="score-list" id="scoreList"></div></section><section class="panel side-card chat-card"><h3>💬 Játékchat</h3><div class="chat-messages" id="chatMessages"></div><form class="chat-entry" id="chatForm"><input id="chatInput" maxlength="260" placeholder="Üzenet a csapatnak…" autocomplete="off"><button type="submit" aria-label="Küldés">➤</button></form></section><section class="panel side-card"><h3>🧰 A táskád</h3><div id="inventoryInfo" class="muted" style="font-size:11px;line-height:1.7"></div></section></aside></div>`;
  $('exitGameBtn').addEventListener('click', () => { socket.emit('leaveRoom'); roomState = null; livePlayers = []; currentRenderedPhase = null; switchScreen('home'); });
  $('chatForm').addEventListener('submit', e => { e.preventDefault(); const text = $('chatInput').value.trim(); if (!text) return; socket.emit('chat', { text }, result => { if (!result?.ok) toast(result?.error || 'Az üzenet nem küldhető el.'); }); $('chatInput').value = ''; });
  const canvas = $('worldCanvas');
  canvas.addEventListener('pointermove', e => {
    if (roomState?.phase !== 'build' || !selectedBuildType) { mouseWorldX = null; return; }
    const rect = canvas.getBoundingClientRect(); mouseWorldX = ((e.clientX - rect.left) / rect.width) * roomState.settings.mapLength;
  });
  canvas.addEventListener('pointerleave', () => { mouseWorldX = null; });
  canvas.addEventListener('click', e => {
    if (!roomState || roomState.phase !== 'build' || !selectedBuildType) return;
    if (roomState.currentBuilderId !== socket.id) return toast('Most nem te építkezel.');
    const rect = canvas.getBoundingClientRect(); const x = ((e.clientX - rect.left) / rect.width) * roomState.settings.mapLength;
    const type = selectedBuildType;
    socket.emit('placeBuild', { type, x }, result => {
      if (!result?.ok) toast(result?.error || 'Nem sikerült építeni.');
      else { selectedBuildType = null; toast('Elhelyezve! A következő játékos jön.'); }
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
  screenGame.innerHTML = `<section class="panel end-layout"><div class="eyebrow">🏁 VERSENY VÉGE</div><h1>${winner ? `${ANIMALS[winner.animal]?.emoji || '🏆'} ${escapeHtml(winner.name)} nyert!` : 'Véget ért a verseny!'}</h1><p>A győztes az összes kör alatt szerzett pontok alapján dőlt el. Készen álltok a visszavágóra?</p><div class="results-list">${sorted.map((p,i)=>`<div class="result-row ${i===0?'winner':''}"><div class="result-place">${i+1}.</div><div class="result-animal">${ANIMALS[p.animal]?.emoji || '🐾'}</div><div class="result-details"><strong>${escapeHtml(p.name)} ${p.id===socket.id?'(Te)':''}</strong><small>🪙 ${p.gold} arany</small></div><div class="result-score">${p.score} pont</div></div>`).join('')}</div><div class="lobby-actions"><button class="ghost-button" id="endLeaveBtn">← Főmenü</button>${roomState.hostId===socket.id?'<button class="primary-button" id="restartGameBtn">🔄 Új verseny</button>':'<button class="primary-button" disabled>Várakozás a szobagazdára…</button>'}</div><p class="setting-note">A következő verseny új pályát és új pontszámokat indít, a szobabeállítások megmaradnak.</p></section>`;
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
  const cards = ITEMS.map(item => `<button type="button" class="shop-item ${selectedBuildType===item.type?'selected':''}" data-item="${item.type}" ${!isMe || (me?.gold ?? 0) < item.price ? 'disabled' : ''}><span class="shop-icon">${item.icon}</span><strong>${item.name}</strong><small>🪙 ${item.price}</small><span class="item-desc">${item.desc}</span></button>`).join('');
  panel.innerHTML = `<div class="build-top"><div><h3>🔨 Építkezési fázis</h3><p>${isMe ? 'Te következel! Válassz egy építményt, majd kattints a pályán a helyére.' : `Most ${escapeHtml(builder?.name || 'egy játékos')} építkezik. Várj a sorodra!`}</p></div><span class="status-chip">⏳ <b>${isMe?'A te köröd':`Várakozás`}</b></span></div><div class="shop-grid">${cards}</div><div class="build-footer"><span class="build-help">📍 Csapdát a pálya középső részére helyezhetsz. A pajzs nem kerül a pályára, csak védelmet ad.</span>${isMe?'<button class="ghost-button" id="skipBuildBtn">Kihagyom →</button>':''}</div>`;
  panel.querySelectorAll('[data-item]').forEach(btn => btn.addEventListener('click', () => {
    const type = btn.dataset.item;
    if (type === 'shield') {
      socket.emit('placeBuild', { type: 'shield' }, result => { if (!result?.ok) toast(result?.error || 'Nem sikerült megvenni.'); else toast('Pajzs megvéve!'); });
    } else { selectedBuildType = type; updateBuildControls(); toast('Kattints a pályára, ahová az akadályt raknád.'); }
  }));
  if ($('skipBuildBtn')) $('skipBuildBtn').addEventListener('click', () => emitAck('skipBuild', {}, 'Kihagytad az építkezést.'));
}

const CANVAS_W = 1100, CANVAS_H = 460, GROUND_Y = 392, PLAYER_H = 44;
function gameLoop(now) {
  if (currentScreen !== 'game' || !roomState || !['race','build'].includes(roomState.phase)) { rafId = null; return; }
  const dt = Math.min(0.04, Math.max(0.001, (now - lastTick) / 1000)); lastTick = now;
  physicsStep(dt, now);
  drawWorld(now);
  updateGameChrome();
  rafId = requestAnimationFrame(gameLoop);
}
function physicsStep(dt, now) {
  if (!roomState || roomState.phase !== 'race') return;
  const me = getMe(); if (!me || me.finished) { motion.moving = false; return; }
  if (now < motion.pauseUntil) return;
  const left = !!(keys.ArrowLeft || keys.KeyA), right = !!(keys.ArrowRight || keys.KeyD);
  motion.moving = left !== right;
  if (left !== right) {
    motion.face = right ? 1 : -1;
    motion.x += (right ? 250 : -250) * dt;
  }
  motion.x = Math.max(28, Math.min(roomState.settings.mapLength - 48, motion.x));
  const jumpPressed = !!(keys.Space || keys.ArrowUp || keys.KeyW);
  if (jumpPressed && motion.y >= 0) { motion.vy = -560; motion.y = -1; keys.Space = false; keys.ArrowUp = false; keys.KeyW = false; }
  motion.vy += 1280 * dt;
  motion.y += motion.vy * dt;
  if (motion.y >= 0) { motion.y = 0; motion.vy = 0; }
  motion.jumping = motion.y < -1;

  for (const o of (roomState.obstacles || [])) {
    const dx = motion.x - o.x;
    if (o.type === 'crate' && Math.abs(dx) < 39 && motion.y > -34) {
      if (right) motion.x = o.x - 40;
      else if (left) motion.x = o.x + 40;
    }
    if (Math.abs(dx) < (o.type === 'barrel' ? 32 : 27) && motion.y > -22) {
      if (o.type === 'spring') {
        if (now - (lastHitAt[o.id] || 0) > 1100) {
          lastHitAt[o.id] = now; motion.vy = -750; motion.y = -2; motion.x = Math.min(roomState.settings.mapLength - 75, motion.x + 20);
          socket.emit('hitHazard', { id: o.id });
        }
      } else if (['saw','spikes','barrel'].includes(o.type) && now - (lastHitAt[o.id] || 0) > 1100) {
        lastHitAt[o.id] = now; motion.pauseUntil = now + 230;
        socket.emit('hitHazard', { id: o.id });
      }
    }
  }
  if (now - lastSendAt > 65) {
    lastSendAt = now;
    socket.emit('playerPosition', { x: motion.x, y: motion.y, face: motion.face, moving: motion.moving, jumping: motion.jumping });
  }
}
function drawWorld(now) {
  const canvas = $('worldCanvas'); if (!canvas || !roomState) return;
  const ctx = canvas.getContext('2d'); const w = canvas.width, h = canvas.height;
  const length = roomState.settings.mapLength; const isBuild = roomState.phase === 'build';
  const me = getMe(); const myLive = getLivePlayer(socket.id) || me;
  let cameraX = 0;
  if (!isBuild) cameraX = Math.max(0, Math.min(length - w, (myLive?.x ?? motion.x) - w * .34));
  ctx.clearRect(0,0,w,h);
  ctx.save();
  if (isBuild) ctx.scale(w / length, 1); else ctx.translate(-cameraX,0);
  drawScenery(ctx, length, now, isBuild ? 1 : cameraX);
  for (const o of roomState.obstacles || []) drawObstacle(ctx, o, now);
  drawGoal(ctx, length, now);
  const players = (livePlayers.length ? livePlayers : roomState.players);
  for (const p of players) {
    const drawP = p.id === socket.id ? { ...p, x: motion.x, y: motion.y, moving: motion.moving, jumping: motion.jumping, face: motion.face } : p;
    drawAnimal(ctx, drawP, now);
  }
  if (isBuild && selectedBuildType && mouseWorldX !== null) {
    ctx.save(); ctx.strokeStyle = '#ffe16a'; ctx.lineWidth = 4; ctx.setLineDash([8,7]); ctx.beginPath(); ctx.moveTo(mouseWorldX,55); ctx.lineTo(mouseWorldX,GROUND_Y+5); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle='#152740'; ctx.fillRect(mouseWorldX-24,49,48,24); ctx.fillStyle='#ffe16a'; ctx.font='bold 13px Nunito'; ctx.textAlign='center'; ctx.fillText('IDE',mouseWorldX,66); ctx.restore();
  }
  ctx.restore();
  if (isBuild) {
    ctx.fillStyle = '#10213bcc'; ctx.fillRect(10,h-34,w-20,23); ctx.fillStyle='#d8e9fb'; ctx.font='bold 12px Nunito'; ctx.textAlign='left'; ctx.fillText('PÁLYATÉRKÉP  •  Kattints a kiválasztott akadály helyére',21,h-18);
  } else {
    const myP = players.find(p=>p.id===socket.id);
    if (myP?.finished) { ctx.fillStyle='#10233ddb'; roundRect(ctx,w/2-145,65,290,46,14); ctx.fillStyle='#ffe078'; ctx.font='bold 17px Nunito'; ctx.textAlign='center'; ctx.fillText(`🏁 CÉLBA ÉRTÉL! Helyezés: ${myP.finishRank}.`,w/2,94); }
  }
}
function roundRect(ctx,x,y,w,h,r) { ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function drawScenery(ctx, length, now, cam) {
  const sky=ctx.createLinearGradient(0,0,0,CANVAS_H); sky.addColorStop(0,'#69ccff'); sky.addColorStop(.58,'#c5f2ff'); sky.addColorStop(1,'#e7fbff'); ctx.fillStyle=sky; ctx.fillRect(0,0,length,CANVAS_H);
  ctx.fillStyle='#fff5ae'; ctx.beginPath(); ctx.arc((cam*.13+210)%(length+150),72,29,0,Math.PI*2); ctx.fill();
  // distant rounded hills
  for(let x=-100;x<length+250;x+=300){
    const offset=x+Math.sin(x*.01)*16;
    ctx.fillStyle='#98d8d7'; ctx.beginPath(); ctx.moveTo(offset,GROUND_Y); ctx.lineTo(offset+90,225+Math.sin(x)*12); ctx.lineTo(offset+185,GROUND_Y); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#77c4b7'; ctx.beginPath(); ctx.moveTo(offset+120,GROUND_Y); ctx.lineTo(offset+220,260+Math.cos(x)*11); ctx.lineTo(offset+310,GROUND_Y); ctx.closePath(); ctx.fill();
  }
  for(let x=60;x<length;x+=245){
    const cloudX=x+Math.sin(now/3000+x)*18; const cloudY=55+(Math.sin(x)*.5+0.5)*55;
    ctx.fillStyle='#ffffffaa'; ctx.beginPath(); ctx.ellipse(cloudX,cloudY,31,12,0,0,Math.PI*2); ctx.ellipse(cloudX+20,cloudY-8,23,16,0,0,Math.PI*2); ctx.ellipse(cloudX+40,cloudY,27,11,0,0,Math.PI*2); ctx.fill();
  }
  // grass ground and earth
  ctx.fillStyle='#875535'; ctx.fillRect(0,GROUND_Y,length,CANVAS_H-GROUND_Y);
  ctx.fillStyle='#b97842'; for(let x=0;x<length;x+=42){ctx.fillRect(x,GROUND_Y+14,25,8);ctx.fillRect(x+14,GROUND_Y+42,19,8);}
  ctx.fillStyle='#5ab84e'; ctx.fillRect(0,GROUND_Y,length,13);
  ctx.fillStyle='#83db5c'; ctx.fillRect(0,GROUND_Y,length,4);
  for(let x=9;x<length;x+=27){ctx.strokeStyle='#3b963c';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,GROUND_Y+4);ctx.lineTo(x-3,GROUND_Y-2);ctx.stroke();}
  // little flowers and stones
  for(let x=90;x<length-100;x+=143){ctx.fillStyle='#e7faff';ctx.beginPath();ctx.arc(x,GROUND_Y-3,3,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ffcf55';ctx.beginPath();ctx.arc(x,GROUND_Y-3,1.5,0,Math.PI*2);ctx.fill();}
  ctx.fillStyle='#2b7b45'; ctx.fillRect(0,GROUND_Y+67,length,4);
  // start area
  ctx.fillStyle='#ffffff90'; ctx.fillRect(15,GROUND_Y-30,4,30); ctx.fillStyle='#ffffff'; ctx.font='900 12px Nunito'; ctx.textAlign='left'; ctx.fillText('RAJT',21,GROUND_Y-42);
}
function drawGoal(ctx, length, now) {
  const x=length-76;
  ctx.fillStyle='#385876'; ctx.fillRect(x,GROUND_Y-90,5,90);
  ctx.fillStyle='#fff8d4';ctx.fillRect(x+4,GROUND_Y-88,52,28);
  const cell=7; for(let row=0;row<4;row++)for(let col=0;col<8;col++){ctx.fillStyle=(row+col)%2===0?'#18263e':'#fff';ctx.fillRect(x+4+col*cell,GROUND_Y-88+row*7,cell,7);}
  ctx.fillStyle='#ffbf3f';ctx.beginPath();ctx.moveTo(x+4,GROUND_Y-60);ctx.lineTo(x+31,GROUND_Y-48+Math.sin(now/220)*3);ctx.lineTo(x+4,GROUND_Y-38);ctx.closePath();ctx.fill();
  ctx.fillStyle='#172d4d';ctx.font='900 13px Nunito';ctx.textAlign='center';ctx.fillText('CÉL',x+18,GROUND_Y-100);
}
function drawObstacle(ctx,o,now) {
  const x=o.x;
  if(o.type==='crate'){
    ctx.fillStyle='#945b2f';ctx.fillRect(x-21,GROUND_Y-37,42,37);ctx.fillStyle='#c78a4a';ctx.fillRect(x-18,GROUND_Y-34,36,31);ctx.strokeStyle='#7b4827';ctx.lineWidth=4;ctx.strokeRect(x-17,GROUND_Y-33,34,29);ctx.beginPath();ctx.moveTo(x-16,GROUND_Y-32);ctx.lineTo(x+16,GROUND_Y-4);ctx.moveTo(x+16,GROUND_Y-32);ctx.lineTo(x-16,GROUND_Y-4);ctx.stroke();ctx.fillStyle='#f3ca7d';ctx.fillRect(x-4,GROUND_Y-21,8,4);
  } else if(o.type==='saw'){
    const y=GROUND_Y-24;ctx.save();ctx.translate(x,y);ctx.rotate(now/180);ctx.fillStyle='#586a7c';ctx.strokeStyle='#e6f1ff';ctx.lineWidth=3;ctx.beginPath();for(let i=0;i<24;i++){const a=i*Math.PI*2/24;const r=i%2===0?23:17;const px=Math.cos(a)*r,py=Math.sin(a)*r;if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);}ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle='#d6e4f3';ctx.beginPath();ctx.arc(0,0,7,0,Math.PI*2);ctx.fill();ctx.fillStyle='#425269';ctx.beginPath();ctx.arc(0,0,3,0,Math.PI*2);ctx.fill();ctx.restore();ctx.fillStyle='#384c66';ctx.fillRect(x-18,GROUND_Y-3,36,5);
  } else if(o.type==='spikes'){
    ctx.fillStyle='#b9c9d9';ctx.strokeStyle='#617b97';ctx.lineWidth=2;ctx.beginPath();for(let i=0;i<3;i++){const sx=x-24+i*16;ctx.moveTo(sx,GROUND_Y);ctx.lineTo(sx+8,GROUND_Y-26);ctx.lineTo(sx+16,GROUND_Y);}ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle='#647b93';ctx.fillRect(x-25,GROUND_Y-2,50,5);
  } else if(o.type==='spring'){
    ctx.fillStyle='#2cb56c';ctx.fillRect(x-24,GROUND_Y-8,48,8);ctx.strokeStyle='#f2f6ff';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(x,GROUND_Y-8);for(let i=0;i<4;i++)ctx.lineTo(x+(i%2===0?13:-13),GROUND_Y-11-i*7);ctx.stroke();ctx.fillStyle='#ff5d69';ctx.fillRect(x-22,GROUND_Y-38,44,8);ctx.fillStyle='#ff9ba1';ctx.fillRect(x-18,GROUND_Y-36,36,3);
  } else if(o.type==='barrel'){
    ctx.save();ctx.translate(x,GROUND_Y-18);ctx.rotate(now/320);ctx.fillStyle='#ad682f';ctx.strokeStyle='#633c27';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(0,0,20,18,0,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.strokeStyle='#e2b16c';ctx.lineWidth=4;ctx.beginPath();ctx.ellipse(0,0,13,18,0,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(-19,0);ctx.lineTo(19,0);ctx.stroke();ctx.restore();
  }
  ctx.fillStyle='#14263d88';ctx.beginPath();ctx.ellipse(x,GROUND_Y+2,o.type==='saw'?23:19,4,0,0,Math.PI*2);ctx.fill();
}
function drawAnimal(ctx,p,now) {
  const type=ANIMALS[p.animal] ? p.animal : 'pig';
  const bob=p.moving?Math.sin(now/48)*2.2:Math.sin(now/400+p.joinOrder)*1.1;
  const base=GROUND_Y+(p.y||0);
  const x=p.x;
  ctx.save();
  // shadow
  ctx.fillStyle='#18465e42';ctx.beginPath();ctx.ellipse(x,GROUND_Y+3,p.moving?16:19,4,0,0,Math.PI*2);ctx.fill();
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
  ctx.save();ctx.font='bold 13px Nunito';const label=p.name||'Játékos';const tw=ctx.measureText(label).width;const tx=x-tw/2-7;const ty=base-61+bob;
  ctx.fillStyle=p.id===socket.id?'#153c54':'#203752';roundRect(ctx,tx,ty,tw+14,20,7);ctx.fill();ctx.strokeStyle=p.id===socket.id?'#ffe17c':'#ffffff75';ctx.lineWidth=1.5;ctx.stroke();ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,x,ty+10);ctx.restore();
}

window.addEventListener('keydown', e => {
  if (currentScreen !== 'game' || roomState?.phase !== 'race') return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (['ArrowLeft','ArrowRight','ArrowUp','Space'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => { keys = Object.create(null); });

// Keep the timer fresh even in the lobby-to-game transitions.
setInterval(() => { if (currentScreen === 'game' && roomState) updateGameChrome(); }, 250);
