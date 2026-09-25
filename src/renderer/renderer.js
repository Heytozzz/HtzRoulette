// Renderer process: UI logic, no direct Node/Electron access (uses window.htz bridge)

const state = {
  participants: [],
  spinning: false,
  rotation: 0,
  eliminatedLog: [],
  winnersLog: [],
  autoTimer: null,
  colorPalette: 'red',
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
  exportBtn: document.getElementById('exportBtn'),
  importBtn: document.getElementById('importBtn'),
  importExportArea: document.getElementById('importExportArea'),

  eliminationFinalWinnersCount: document.getElementById('eliminationFinalWinnersCount'),

  subBonusCheckbox: document.getElementById('subBonusCheckbox'),
  subBonusRow: document.getElementById('subBonusRow'),
  subExtraTier1: document.getElementById('subExtraTier1'),
  subExtraTier2: document.getElementById('subExtraTier2'),
  subExtraTier3: document.getElementById('subExtraTier3'),

  gearBtn: document.getElementById('gearBtn'),
  appearanceModal: document.getElementById('appearanceModal'),
  closeAppearanceModal: document.getElementById('closeAppearanceModal'),
  colorPaletteSelect: document.getElementById('colorPaletteSelect'),
};

const ctx = els.wheelCanvas.getContext('2d');
const COLOR_PALETTES = {
  red: ['#050505', '#2b2b2b', '#4d0000', '#8b0000', '#c1121f', '#e85d5d', '#ffb3b3'],
  blue: ['#050505', '#2b2b2b', '#00204d', '#003f8b', '#1261c1', '#4d9de8', '#b3d4ff'],
  green: ['#050505', '#2b2b2b', '#0a3d0a', '#146b14', '#2ea52e', '#6fd66f', '#c8f7c8'],
  purple: ['#050505', '#2b2b2b', '#2d004d', '#4b0082', '#6a1cad', '#9b5de5', '#dcb8ff'],
  gray: ['#050505', '#2b2b2b', '#4d4d4d', '#7a7a7a', '#a8a8a8', '#cfcfcf', '#f0f0f0'],
};

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}

function lerpHexColor(hexA, hexB, frac) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const r = Math.round(a.r + (b.r - a.r) * frac);
  const g = Math.round(a.g + (b.g - a.g) * frac);
  const bl = Math.round(a.b + (b.b - a.b) * frac);
  return `rgb(${r}, ${g}, ${bl})`;
}

function getSliceColor(index, count) {
  if (state.colorPalette === 'rainbow') {
    const hue = (index * 360) / count;
    return `hsl(${hue}, 65%, 50%)`;
  }

  const stops = COLOR_PALETTES[state.colorPalette] || COLOR_PALETTES.red;
  const posInCircle = index / count; // 0..1 around the wheel
  // Triangle wave (0 -> 1 -> 0) so the gradient loops smoothly: dark at the
  // seam between the first and last slice, brightest in the middle.
  const triangle = posInCircle < 0.5 ? posInCircle * 2 : (1 - posInCircle) * 2;
  const scaled = triangle * (stops.length - 1);
  const lower = Math.floor(scaled);
  const upper = Math.min(stops.length - 1, lower + 1);
  const frac = scaled - lower;
  return lerpHexColor(stops[lower], stops[upper], frac);
}

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
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (strings[key]) el.setAttribute('title', strings[key]);
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
    eliminationFinalWinnersCount: Math.max(1, Number(els.eliminationFinalWinnersCount.value) || 1),
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
    const maxRemovable = Math.max(1, state.participants.length - s.eliminationFinalWinnersCount);
    return Math.min(s.eliminationArrowCount, maxRemovable, Math.max(1, state.participants.length));
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

// Twitch chat join: one entry per person, plus their sub bonus extras (Tier 1)
// applied immediately if the bonus is enabled and Twitch reports them as a subscriber.
function addParticipant(username, isSub) {
  if (!username) return;
  if (state.participants.includes(username)) return;
  const settings = getSettings();
  let copies = 1;
  if (settings.subBonusEnabled && isSub) {
    copies += settings.subExtra[1] || 0;
  }
  for (let i = 0; i < copies; i += 1) {
    state.participants.push(username);
  }
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
    ctx.fillStyle = getSliceColor(i, count);
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
// slot (by index) sits under each pointer (slices are laid out starting at
// angle 0 in wheel-space, then rotated by `rotation`). Returns unique slot
// indices plus their names, so a name with several extra slots only ever
// loses/wins the exact slot that was picked.
function getSelectionForRotation(rotation, pointerCount) {
  const count = state.participants.length;
  if (count === 0) return { indices: [], names: [] };
  const sliceAngle = (Math.PI * 2) / count;
  const pointerAngles = getPointerAngles(pointerCount);

  const rawIndices = pointerAngles.map((angle) => {
    const wheelSpaceAngle = normalizeAngle(angle - rotation);
    return Math.floor(wheelSpaceAngle / sliceAngle) % count;
  });

  const indices = [...new Set(rawIndices)];
  const names = indices.map((i) => state.participants[i]);
  return { indices, names };
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
  const extraSpins = 8 + Math.floor(Math.random() * 4);

  const startRotation = state.rotation;
  // Same amount of "force" every spin: always add extraSpins full turns on top
  // of the current rotation, then just enough extra to land pointer 0 on the
  // chosen slice (never subtract from where the wheel already is).
  const desiredMod = normalizeAngle(-targetSliceCenter);
  const currentMod = normalizeAngle(startRotation);
  const alignmentDelta = normalizeAngle(desiredMod - currentMod);
  const targetRotation = startRotation + alignmentDelta + extraSpins * Math.PI * 2;

  const duration = settings.spinDurationMs;
  const startTime = performance.now();

  function spinEasing(x) {
    // Fast ramp-up in the first 10% of the animation, then a long ease-out slowdown
    const rampFraction = 0.1;
    const rampDistance = 0.18;
    if (x < rampFraction) {
      return (x / rampFraction) * rampDistance;
    }
    const remaining = (x - rampFraction) / (1 - rampFraction);
    const easeOutQuart = 1 - Math.pow(1 - remaining, 4);
    return rampDistance + (1 - rampDistance) * easeOutQuart;
  }

  function animate(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = spinEasing(progress);
    state.rotation = startRotation + (targetRotation - startRotation) * eased;
    drawWheel();

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      onSpinComplete(getSelectionForRotation(state.rotation, pointerCount), settings);
    }
  }

  requestAnimationFrame(animate);
}

function removeIndices(indices) {
  const indexSet = new Set(indices);
  state.participants = state.participants.filter((_, i) => !indexSet.has(i));
}

function scheduleAutoSpin(waitMs) {
  clearTimeout(state.autoTimer);
  state.autoTimer = setTimeout(() => {
    spin();
  }, waitMs);
}

function onSpinComplete(selection, settings) {
  state.spinning = false;
  const { indices, names } = selection;
  const uniqueRoundNames = [...new Set(names)];

  if (settings.mode === 'normal') {
    els.winnerText.textContent = t('winner', { name: names[0] });
    els.spinBtn.disabled = false;
    return;
  }

  if (settings.mode === 'elimination') {
    state.eliminatedLog.push(...uniqueRoundNames);
    removeIndices(indices);
    renderParticipants();
    renderLogs();
    els.modeStatus.textContent = t('roundEliminated', { names: uniqueRoundNames.join(', ') });

    // A person with several extra slots still counts as ONE remaining winner
    const remainingUniqueNames = [...new Set(state.participants)];
    if (remainingUniqueNames.length <= settings.eliminationFinalWinnersCount) {
      state.spinning = true; // lock further spins, round is over
      els.spinBtn.disabled = true;
      if (remainingUniqueNames.length === 1) {
        els.winnerText.textContent = t('finalWinner', { name: remainingUniqueNames[0] });
      } else if (remainingUniqueNames.length > 1) {
        els.winnerText.textContent = t('finalWinnerTie', { names: remainingUniqueNames.join(', ') });
      } else {
        els.winnerText.textContent = '';
      }
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
      // A person with several extra slots only ever counts as ONE winner
      uniqueRoundNames.forEach((name) => {
        if (!state.winnersLog.includes(name)) state.winnersLog.push(name);
      });
      removeIndices(indices);
      renderParticipants();
      renderLogs();
      els.winnerText.textContent = t('winnersLabel', { names: uniqueRoundNames.join(', ') });
      els.spinBtn.disabled = false;
      return;
    }

    // sequential: one slot per spin; if that person already won, their slot is
    // simply retired without counting as a second win
    const name = names[0];
    removeIndices(indices);
    if (!state.winnersLog.includes(name)) state.winnersLog.push(name);
    renderParticipants();
    renderLogs();
    els.modeStatus.textContent = `${state.winnersLog.length}/${settings.winnersCount}`;

    const remainingUniqueNames = new Set(state.participants).size;
    const done = state.winnersLog.length >= settings.winnersCount || remainingUniqueNames === 0;
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

window.htz.onParticipant((payload) => {
  addParticipant(payload.username, payload.isSub);
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

els.gearBtn.addEventListener('click', () => {
  els.appearanceModal.classList.remove('hidden');
});

els.closeAppearanceModal.addEventListener('click', () => {
  els.appearanceModal.classList.add('hidden');
});

els.appearanceModal.addEventListener('click', (e) => {
  if (e.target === els.appearanceModal) els.appearanceModal.classList.add('hidden');
});

els.colorPaletteSelect.addEventListener('change', () => {
  state.colorPalette = els.colorPaletteSelect.value;
  drawWheel();
});

els.exportBtn.addEventListener('click', async () => {
  const text = state.participants.join('\n');
  els.importExportArea.value = text;
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    // Clipboard permissions may be unavailable; the textarea still holds the list for manual copy
  }
});

els.importBtn.addEventListener('click', () => {
  const lines = els.importExportArea.value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  state.participants = lines;
  renderParticipants();
  drawWheel();
});

// --- Init ---
loadStrings().then(() => {
  els.colorPaletteSelect.value = state.colorPalette;
  renderParticipants();
  renderLogs();
  updateSettingsVisibility();
  drawWheel();
});
