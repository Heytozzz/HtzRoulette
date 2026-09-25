// Renderer process: UI logic, no direct Node/Electron access (uses window.htz bridge)

const state = {
  participants: [],
  spinning: false,
  rotation: 0,
  eliminatedLog: [],
  winnersLog: [],
  autoTimer: null,
};

const els = {
  channelInput: document.getElementById('channelInput'),
  connectBtn: document.getElementById('connectBtn'),
  disconnectBtn: document.getElementById('disconnectBtn'),
  statusText: document.getElementById('statusText'),
  joinCommandInput: document.getElementById('joinCommandInput'),
  participantList: document.getElementById('participantList'),
  wheelCanvas: document.getElementById('wheelCanvas'),
  spinBtn: document.getElementById('spinBtn'),
  resetBtn: document.getElementById('resetBtn'),
  winnerText: document.getElementById('winnerText'),
  modeStatus: document.getElementById('modeStatus'),

  spinDurationInput: document.getElementById('spinDurationInput'),
  modeSelect: document.getElementById('modeSelect'),
  eliminationOptions: document.getElementById('eliminationOptions'),
  eliminationSubMode: document.getElementById('eliminationSubMode'),
  eliminationArrowRow: document.getElementById('eliminationArrowRow'),
  eliminationArrowCount: document.getElementById('eliminationArrowCount'),
  winnersOptions: document.getElementById('winnersOptions'),
  winnersSubMode: document.getElementById('winnersSubMode'),
  winnersCountInput: document.getElementById('winnersCountInput'),
  autoModeRow: document.getElementById('autoModeRow'),
  autoModeCheckbox: document.getElementById('autoModeCheckbox'),
  autoWaitInput: document.getElementById('autoWaitInput'),
  eliminatedLogList: document.getElementById('eliminatedLogList'),
  winnersLogList: document.getElementById('winnersLogList'),

  manualNameInput: document.getElementById('manualNameInput'),
  manualSubCheckbox: document.getElementById('manualSubCheckbox'),
  manualSubTier: document.getElementById('manualSubTier'),
  manualAddBtn: document.getElementById('manualAddBtn'),
  shuffleBtn: document.getElementById('shuffleBtn'),

  subBonusCheckbox: document.getElementById('subBonusCheckbox'),
  subBonusRow: document.getElementById('subBonusRow'),
  subExtraTier1: document.getElementById('subExtraTier1'),
  subExtraTier2: document.getElementById('subExtraTier2'),
  subExtraTier3: document.getElementById('subExtraTier3'),
};

const ctx = els.wheelCanvas.getContext('2d');
const colors = ['#6441a5', '#9147ff', '#e91916', '#00b7ff', '#00c853', '#ffb300', '#ff4081', '#3f51b5'];

// --- i18n (basic, Spanish only for now, structure ready for more languages) ---
let strings = {};
async function loadStrings() {
  const response = await fetch('../i18n/es.json');
  strings = await response.json();
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (strings[key]) el.textContent = strings[key];
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (strings[key]) el.setAttribute('placeholder', strings[key]);
  });
}

function t(key, vars = {}) {
  let text = strings[key] || key;
  Object.keys(vars).forEach((k) => {
    text = text.replace(`{${k}}`, vars[k]);
  });
  return text;
}

// --- Settings helpers ---
function getSettings() {
  return {
    spinDurationMs: Math.max(1, Number(els.spinDurationInput.value) || 4) * 1000,
    mode: els.modeSelect.value, // normal | elimination | winners
    eliminationSubMode: els.eliminationSubMode.value, // simple | multiple
    eliminationArrowCount: Math.max(2, Number(els.eliminationArrowCount.value) || 2),
    winnersSubMode: els.winnersSubMode.value, // sequential | simultaneous
    winnersCount: Math.max(2, Number(els.winnersCountInput.value) || 2),
    autoMode: els.autoModeCheckbox.checked,
    autoWaitMs: Math.max(0, Number(els.autoWaitInput.value) || 0) * 1000,
    subBonusEnabled: els.subBonusCheckbox.checked,
    subExtra: {
      1: Math.max(0, Number(els.subExtraTier1.value) || 0),
      2: Math.max(0, Number(els.subExtraTier2.value) || 0),
      3: Math.max(0, Number(els.subExtraTier3.value) || 0),
    },
  };
}

function pointerCountForCurrentSettings() {
  const s = getSettings();
  if (s.mode === 'elimination' && s.eliminationSubMode === 'multiple') {
    return Math.min(s.eliminationArrowCount, Math.max(1, state.participants.length));
  }
  if (s.mode === 'winners' && s.winnersSubMode === 'simultaneous') {
    return Math.min(s.winnersCount, Math.max(1, state.participants.length));
  }
  return 1;
}

function updateSettingsVisibility() {
  const mode = els.modeSelect.value;
  els.eliminationOptions.classList.toggle('hidden', mode !== 'elimination');
  els.winnersOptions.classList.toggle('hidden', mode !== 'winners');

  const isMultipleElimination = mode === 'elimination' && els.eliminationSubMode.value === 'multiple';
  els.eliminationArrowRow.classList.toggle('hidden', !isMultipleElimination);

  // Automatic mode only makes sense for repeated spins: elimination, or sequential winners
  const canAuto = mode === 'elimination' || (mode === 'winners' && els.winnersSubMode.value === 'sequential');
  els.autoModeRow.classList.toggle('hidden', !canAuto);
  els.subBonusRow.classList.toggle('hidden', !els.subBonusCheckbox.checked);

  drawWheel();
}

[els.modeSelect, els.eliminationSubMode, els.winnersSubMode, els.subBonusCheckbox].forEach((el) => {
  el.addEventListener('change', updateSettingsVisibility);
});

els.manualSubCheckbox.addEventListener('change', () => {
  els.manualSubTier.classList.toggle('hidden', !els.manualSubCheckbox.checked);
});

// --- Participants list ---
function renderParticipants() {
  els.participantList.innerHTML = '';
  if (state.participants.length === 0) {
    const li = document.createElement('li');
    li.textContent = t('empty');
    els.participantList.appendChild(li);
    return;
  }
  state.participants.forEach((name, index) => {
    const li = document.createElement('li');

    const nameSpan = document.createElement('span');
    nameSpan.textContent = name;
    li.appendChild(nameSpan);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '×';
    removeBtn.title = t('removeTitle');
    removeBtn.addEventListener('click', () => removeParticipantAt(index));
    li.appendChild(removeBtn);

    els.participantList.appendChild(li);
  });
}

function removeParticipantAt(index) {
  state.participants.splice(index, 1);
  renderParticipants();
  drawWheel();
}

// Twitch chat join: one entry per !join, de-duplicated to prevent chat spam
function addParticipant(name) {
  if (!name) return;
  if (state.participants.includes(name)) return;
  state.participants.push(name);
  renderParticipants();
  drawWheel();
}

// Manual add: allows duplicates on purpose, so sub-bonus extra entries work
function addManualParticipant(name, isSub, tier) {
  if (!name) return;
  const settings = getSettings();
  let copies = 1;
  if (settings.subBonusEnabled && isSub) {
    copies += settings.subExtra[tier] || 0;
  }
  for (let i = 0; i < copies; i += 1) {
    state.participants.push(name);
  }
  renderParticipants();
  drawWheel();
}

function shuffleParticipants() {
  for (let i = state.participants.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.participants[i], state.participants[j]] = [state.participants[j], state.participants[i]];
  }
  renderParticipants();
  drawWheel();
}

function renderLogs() {
  els.eliminatedLogList.innerHTML = '';
  state.eliminatedLog.forEach((name) => {
    const li = document.createElement('li');
    li.textContent = name;
    els.eliminatedLogList.appendChild(li);
  });

  els.winnersLogList.innerHTML = '';
  state.winnersLog.forEach((name) => {
    const li = document.createElement('li');
    li.textContent = name;
    els.winnersLogList.appendChild(li);
  });
}

// --- Wheel drawing ---
function drawWheel() {
  const { width, height } = els.wheelCanvas;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(cx, cy) - 10;

  ctx.clearRect(0, 0, width, height);

  const count = state.participants.length;
  if (count === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#2a2b31';
    ctx.fill();
    return;
  }

  const sliceAngle = (Math.PI * 2) / count;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(state.rotation);

  state.participants.forEach((name, i) => {
    const start = i * sliceAngle;
    const end = start + sliceAngle;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();

    ctx.save();
    ctx.rotate(start + sliceAngle / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.font = '14px Segoe UI';
    ctx.fillText(name, radius - 10, 4);
    ctx.restore();
  });

  ctx.restore();

  // Pointer(s): drawn pointing INWARD at the rim, evenly spaced around the wheel
  const pointerCount = pointerCountForCurrentSettings();
  const pointerAngles = getPointerAngles(pointerCount);
  pointerAngles.forEach((angle) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    // Tip touches the rim (pointing toward the center), base sits outside the wheel
    ctx.beginPath();
    ctx.moveTo(radius - 2, 0);
    ctx.lineTo(radius + 16, -10);
    ctx.lineTo(radius + 16, 10);
    ctx.closePath();
    ctx.fillStyle = '#ffcc00';
    ctx.fill();
    ctx.restore();
  });
}

// Pointer 0 is fixed at angle 0 (screen right); extra pointers are spaced evenly around the circle
function getPointerAngles(n) {
  const angles = [];
  for (let p = 0; p < n; p += 1) {
    angles.push((p * Math.PI * 2) / n);
  }
  return angles;
}

function normalizeAngle(angle) {
  const twoPi = Math.PI * 2;
  return ((angle % twoPi) + twoPi) % twoPi;
}

// Given the wheel's final rotation and the pointer angles, work out which
// participant sits under each pointer (slices are laid out starting at angle 0
// in wheel-space, then rotated by `rotation`).
function getResultsForRotation(rotation, pointerCount) {
  const count = state.participants.length;
  if (count === 0) return [];
  const sliceAngle = (Math.PI * 2) / count;
  const pointerAngles = getPointerAngles(pointerCount);

  const indices = pointerAngles.map((angle) => {
    const wheelSpaceAngle = normalizeAngle(angle - rotation);
    return Math.floor(wheelSpaceAngle / sliceAngle) % count;
  });

  // De-duplicate in case two pointers land on the same slice
  const uniqueIndices = [...new Set(indices)];
  return uniqueIndices.map((i) => state.participants[i]).sort((a, b) => a.localeCompare(b));
}

// --- Spin logic ---
function spin() {
  if (state.spinning || state.participants.length === 0) return;
  state.spinning = true;
  els.spinBtn.disabled = true;
  els.winnerText.textContent = '';

  const settings = getSettings();
  const pointerCount = pointerCountForCurrentSettings();
  const count = state.participants.length;
  const sliceAngle = (Math.PI * 2) / count;

  // Anchor slice for pointer 0; other pointers fall out naturally from the rotation
  const anchorIndex = Math.floor(Math.random() * count);
  const targetSliceCenter = anchorIndex * sliceAngle + sliceAngle / 2;
  const extraSpins = 5 + Math.floor(Math.random() * 3);
  const targetRotation = extraSpins * Math.PI * 2 - targetSliceCenter;

  const startRotation = state.rotation;
  const duration = settings.spinDurationMs;
  const startTime = performance.now();

  function easeOutCubic(x) {
    return 1 - Math.pow(1 - x, 3);
  }

  function animate(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeOutCubic(progress);
    state.rotation = startRotation + (targetRotation - startRotation) * eased;
    drawWheel();

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      onSpinComplete(getResultsForRotation(state.rotation, pointerCount), settings);
    }
  }

  requestAnimationFrame(animate);
}

function removeParticipants(names) {
  state.participants = state.participants.filter((p) => !names.includes(p));
}

function scheduleAutoSpin(waitMs) {
  clearTimeout(state.autoTimer);
  state.autoTimer = setTimeout(() => {
    spin();
  }, waitMs);
}

function onSpinComplete(results, settings) {
  state.spinning = false;

  if (settings.mode === 'normal') {
    els.winnerText.textContent = t('winner', { name: results[0] });
    els.spinBtn.disabled = false;
    return;
  }

  if (settings.mode === 'elimination') {
    state.eliminatedLog.push(...results);
    removeParticipants(results);
    renderParticipants();
    renderLogs();
    els.modeStatus.textContent = t('roundEliminated', { names: results.join(', ') });

    if (state.participants.length <= 1) {
      const finalWinner = state.participants[0];
      state.spinning = true; // lock further spins, round is over
      els.spinBtn.disabled = true;
      els.winnerText.textContent = finalWinner
        ? t('finalWinner', { name: finalWinner })
        : '';
      return;
    }

    if (settings.autoMode) {
      els.spinBtn.disabled = true;
      scheduleAutoSpin(settings.autoWaitMs);
    } else {
      els.spinBtn.disabled = false;
    }
    return;
  }

  if (settings.mode === 'winners') {
    if (settings.winnersSubMode === 'simultaneous') {
      state.winnersLog.push(...results);
      removeParticipants(results);
      renderParticipants();
      renderLogs();
      els.winnerText.textContent = t('winnersLabel', { names: results.join(', ') });
      els.spinBtn.disabled = false;
      return;
    }

    // sequential
    state.winnersLog.push(...results);
    removeParticipants(results);
    renderParticipants();
    renderLogs();
    els.modeStatus.textContent = `${state.winnersLog.length}/${settings.winnersCount}`;

    const done = state.winnersLog.length >= settings.winnersCount || state.participants.length === 0;
    if (done) {
      els.winnerText.textContent = t('finalWinnerTie', { names: state.winnersLog.join(', ') });
      els.spinBtn.disabled = true;
      return;
    }

    if (settings.autoMode) {
      els.spinBtn.disabled = true;
      scheduleAutoSpin(settings.autoWaitMs);
    } else {
      els.spinBtn.disabled = false;
    }
  }
}

function resetParticipants() {
  clearTimeout(state.autoTimer);
  state.participants = [];
  state.rotation = 0;
  state.eliminatedLog = [];
  state.winnersLog = [];
  state.spinning = false;
  els.spinBtn.disabled = false;
  els.winnerText.textContent = '';
  els.modeStatus.textContent = '';
  renderParticipants();
  renderLogs();
  drawWheel();
}

// --- Twitch connection ---
els.connectBtn.addEventListener('click', async () => {
  const channel = els.channelInput.value.trim();
  if (!channel) return;
  els.connectBtn.disabled = true;
  const result = await window.htz.connect(channel);
  if (!result.ok) {
    els.statusText.textContent = 'Error: ' + result.error;
    els.connectBtn.disabled = false;
  }
});

els.disconnectBtn.addEventListener('click', async () => {
  await window.htz.disconnect();
  els.statusText.textContent = t('statusDisconnected');
  els.connectBtn.disabled = false;
  els.disconnectBtn.disabled = true;
});

els.joinCommandInput.addEventListener('change', () => {
  window.htz.setJoinCommand(els.joinCommandInput.value);
});

window.htz.onStatus((status) => {
  if (status.connected) {
    els.statusText.textContent = t('statusConnected', { channel: status.channel });
    els.disconnectBtn.disabled = false;
  } else {
    els.statusText.textContent = t('statusDisconnected');
    els.connectBtn.disabled = false;
    els.disconnectBtn.disabled = true;
  }
});

window.htz.onParticipant((username) => {
  addParticipant(username);
});

els.spinBtn.addEventListener('click', spin);
els.resetBtn.addEventListener('click', resetParticipants);

els.manualAddBtn.addEventListener('click', () => {
  const name = els.manualNameInput.value.trim();
  if (!name) return;
  const isSub = els.manualSubCheckbox.checked;
  const tier = Number(els.manualSubTier.value);
  addManualParticipant(name, isSub, tier);
  els.manualNameInput.value = '';
});

els.manualNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') els.manualAddBtn.click();
});

els.shuffleBtn.addEventListener('click', shuffleParticipants);

// --- Init ---
loadStrings().then(() => {
  renderParticipants();
  renderLogs();
  updateSettingsVisibility();
  drawWheel();
});
