// Web app: runs entirely in the browser. Talks to Twitch chat directly over
// a WebSocket using Twitch's IRC protocol (no server/backend, no tmi.js
// dependency — its browser CDN bundle is unreliable). Themes/images are
// stored in this browser's IndexedDB (there's no filesystem to read from).

const state = {
  participants: [],
  spinning: false,
  rotation: 0,
  eliminatedLog: [],
  winnersLog: [],
  autoTimer: null,
  colorPalette: 'red',
  joinAccepted: false,
  joinCommand: '!join',
  themeImages: { bg: [], roulette: [] },
  rouletteImageMode: 'colors',
  playerImageMap: new Map(),
  fullWheelImageUrl: null,
  imageCache: new Map(),
  profilePhotoMap: new Map(),
  twitchApiToken: null,
  twitchApiTokenClientId: null,
  twitchSocket: null,
};

const PLACEHOLDER_SLICE_COUNT = 8;

const els = {
  channelInput: document.getElementById('channelInput'),
  connectBtn: document.getElementById('connectBtn'),
  disconnectBtn: document.getElementById('disconnectBtn'),
  statusText: document.getElementById('statusText'),
  joinCommandInput: document.getElementById('joinCommandInput'),
  startJoinBtn: document.getElementById('startJoinBtn'),
  stopJoinBtn: document.getElementById('stopJoinBtn'),
  joinStatusText: document.getElementById('joinStatusText'),
  participantList: document.getElementById('participantList'),
  wheelCanvas: document.getElementById('wheelCanvas'),
  wheelBox: document.getElementById('wheelBox'),
  resetBtn: document.getElementById('resetBtn'),
  winnerText: document.getElementById('winnerText'),
  modeStatus: document.getElementById('modeStatus'),
  subsOnlyCheckbox: document.getElementById('subsOnlyCheckbox'),

  spinDurationInput: document.getElementById('spinDurationInput'),
  modeSelect: document.getElementById('modeSelect'),
  eliminationOptions: document.getElementById('eliminationOptions'),
  eliminationSubMode: document.getElementById('eliminationSubMode'),
  eliminationArrowRow: document.getElementById('eliminationArrowRow'),
  eliminationArrowCount: document.getElementById('eliminationArrowCount'),
  eliminationFinalWinnersCount: document.getElementById('eliminationFinalWinnersCount'),
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

  subBonusCheckbox: document.getElementById('subBonusCheckbox'),
  subBonusRow: document.getElementById('subBonusRow'),
  subExtraTier1: document.getElementById('subExtraTier1'),
  subExtraTier2: document.getElementById('subExtraTier2'),
  subExtraTier3: document.getElementById('subExtraTier3'),

  gearBtn: document.getElementById('gearBtn'),
  appearanceModal: document.getElementById('appearanceModal'),
  closeAppearanceModal: document.getElementById('closeAppearanceModal'),
  colorPaletteSelect: document.getElementById('colorPaletteSelect'),
  wheelScaleSlider: document.getElementById('wheelScaleSlider'),
  themeSelect: document.getElementById('themeSelect'),
  deleteThemeBtn: document.getElementById('deleteThemeBtn'),
  rouletteImageModeSelect: document.getElementById('rouletteImageModeSelect'),
  twitchClientId: document.getElementById('twitchClientId'),
  twitchClientSecret: document.getElementById('twitchClientSecret'),
  newThemeName: document.getElementById('newThemeName'),
  newThemeBgFiles: document.getElementById('newThemeBgFiles'),
  newThemeRouletteFiles: document.getElementById('newThemeRouletteFiles'),
  saveThemeBtn: document.getElementById('saveThemeBtn'),
  debugModeCheckbox: document.getElementById('debugModeCheckbox'),
};

const ctx = els.wheelCanvas.getContext('2d');
const PALETTE_HUES = { red: 0, blue: 210, green: 120, purple: 275, gray: 0 };

function getSliceColor(index, count) {
  if (state.colorPalette === 'rainbow') {
    const hue = (index * 360) / count;
    return `hsl(${hue}, 65%, 50%)`;
  }
  const hue = PALETTE_HUES[state.colorPalette] ?? PALETTE_HUES.red;
  const posInCircle = index / count;
  const triangle = posInCircle < 0.5 ? posInCircle * 2 : (1 - posInCircle) * 2;
  const lightness = 18 + triangle * 40;
  const saturation = state.colorPalette === 'gray' ? 0 : 12 + triangle * 68;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

// --- i18n ---
let strings = {};
async function loadStrings() {
  const response = await fetch('i18n/es.json', { cache: 'no-store' });
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
    mode: els.modeSelect.value,
    eliminationSubMode: els.eliminationSubMode.value,
    eliminationArrowCount: Math.max(2, Number(els.eliminationArrowCount.value) || 2),
    eliminationFinalWinnersCount: Math.max(1, Number(els.eliminationFinalWinnersCount.value) || 1),
    winnersSubMode: els.winnersSubMode.value,
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

[els.eliminationArrowCount, els.eliminationFinalWinnersCount, els.winnersCountInput].forEach((el) => {
  el.addEventListener('input', () => drawWheel());
});

els.wheelScaleSlider.addEventListener('input', () => {
  document.documentElement.style.setProperty('--wheel-scale', els.wheelScaleSlider.value / 100);
});

// --- Participants list ---
function renderParticipants() {
  els.participantList.innerHTML = '';
  if (state.participants.length === 0) {
    const li = document.createElement('li');
    li.textContent = t('empty');
    els.participantList.appendChild(li);
    saveState();
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

    const dupBtn = document.createElement('button');
    dupBtn.className = 'dup-btn';
    dupBtn.textContent = '+';
    dupBtn.title = t('duplicateTitle');
    dupBtn.addEventListener('click', () => duplicateParticipantAt(index));
    li.appendChild(dupBtn);

    els.participantList.appendChild(li);
  });
  saveState();
}

function duplicateParticipantAt(index) {
  const name = state.participants[index];
  state.participants.splice(index + 1, 0, name);
  renderParticipants();
  drawWheel();
}

function removeParticipantAt(index) {
  state.participants.splice(index, 1);
  renderParticipants();
  drawWheel();
}

// Twitch chat join: one entry per person, plus sub bonus extras applied at once
function addParticipant(username, subTier) {
  if (!username) return;
  if (state.participants.includes(username)) return;
  const settings = getSettings();
  let copies = 1;
  if (settings.subBonusEnabled && subTier > 0) {
    copies += settings.subExtra[subTier] || 0;
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

function getLoadedImage(url) {
  if (!url) return null;
  const cached = state.imageCache.get(url);
  if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
  const img = new Image();
  img.onload = () => drawWheel();
  img.src = url;
  state.imageCache.set(url, img);
  return null;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getPlayerImage(name) {
  if (state.playerImageMap.has(name)) return state.playerImageMap.get(name);
  const images = state.themeImages.roulette;
  const url = images && images.length > 0 ? pickRandom(images) : null;
  state.playerImageMap.set(name, url);
  return url;
}

// --- Twitch profile photos (Helix API) ---
// Uses the user's own Client ID/Secret (entered by them, stored only in this
// browser's localStorage) to fetch real Twitch avatars. Only resolves for
// names that match an actual Twitch login exactly (case-insensitive) —
// localized display names that differ from the login won't match.
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const TWITCH_USERS_URL = 'https://api.twitch.tv/helix/users';

async function getTwitchAppToken(clientId, clientSecret) {
  if (state.twitchApiToken && state.twitchApiTokenClientId === clientId) {
    return state.twitchApiToken;
  }
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });
  const res = await fetch(`${TWITCH_TOKEN_URL}?${params.toString()}`, { method: 'POST' });
  if (!res.ok) throw new Error('twitch-token-request-failed');
  const data = await res.json();
  state.twitchApiToken = data.access_token;
  state.twitchApiTokenClientId = clientId;
  return state.twitchApiToken;
}

let profilePhotoFetchInFlight = false;

async function fetchProfilePhotos(names) {
  if (profilePhotoFetchInFlight) return;
  const clientId = els.twitchClientId.value.trim();
  const clientSecret = els.twitchClientSecret.value.trim();
  if (!clientId || !clientSecret) return;

  const logins = [...new Set(names.map((n) => n.toLowerCase()))].filter(
    (n) => !state.profilePhotoMap.has(n)
  );
  if (logins.length === 0) return;

  profilePhotoFetchInFlight = true;
  try {
    const token = await getTwitchAppToken(clientId, clientSecret);
    for (let i = 0; i < logins.length; i += 100) {
      const chunk = logins.slice(i, i + 100);
      const params = chunk.map((login) => `login=${encodeURIComponent(login)}`).join('&');
      const res = await fetch(`${TWITCH_USERS_URL}?${params}`, {
        headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('twitch-users-request-failed');
      const data = await res.json();
      (data.data || []).forEach((u) => {
        state.profilePhotoMap.set(u.login, u.profile_image_url);
      });
      chunk.forEach((login) => {
        if (!state.profilePhotoMap.has(login)) state.profilePhotoMap.set(login, null);
      });
    }
    drawWheel();
  } catch (err) {
    console.error('Twitch profile photo fetch failed:', err);
  } finally {
    profilePhotoFetchInFlight = false;
  }
}

function getProfilePhotoImage(name) {
  const key = name.toLowerCase();
  if (!state.profilePhotoMap.has(key)) {
    fetchProfilePhotos([...new Set(state.participants)]);
    return null;
  }
  return state.profilePhotoMap.get(key);
}

function loadTwitchCredentials() {
  els.twitchClientId.value = localStorage.getItem('htz_twitch_client_id') || '';
  els.twitchClientSecret.value = localStorage.getItem('htz_twitch_client_secret') || '';
}

els.twitchClientId.addEventListener('change', () => {
  localStorage.setItem('htz_twitch_client_id', els.twitchClientId.value.trim());
  state.twitchApiToken = null;
});

els.twitchClientSecret.addEventListener('change', () => {
  localStorage.setItem('htz_twitch_client_secret', els.twitchClientSecret.value.trim());
  state.twitchApiToken = null;
});

// --- Wheel drawing ---
function drawWheel() {
  const { width, height } = els.wheelCanvas;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(cx, cy) - 10;

  ctx.clearRect(0, 0, width, height);
  const count = state.participants.length;

  if (count === 0) {
    drawColorSlices(cx, cy, radius, PLACEHOLDER_SLICE_COUNT, []);
    drawPointers(cx, cy, radius);
    return;
  }

  const mode = state.rouletteImageMode;
  if (mode === 'full-wheel' && state.fullWheelImageUrl) {
    drawFullWheelImage(cx, cy, radius, count);
  } else if (mode === 'per-player') {
    drawAvatarSlices(cx, cy, radius, count, getPlayerImage);
  } else if (mode === 'profile-photos') {
    drawAvatarSlices(cx, cy, radius, count, getProfilePhotoImage);
  } else {
    drawColorSlices(cx, cy, radius, count, state.participants);
  }

  drawPointers(cx, cy, radius);
}

function drawColorSlices(cx, cy, radius, count, names) {
  const sliceAngle = (Math.PI * 2) / count;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(state.rotation);

  for (let i = 0; i < count; i += 1) {
    const start = i * sliceAngle;
    const end = start + sliceAngle;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = getSliceColor(i, count);
    ctx.fill();

    if (names[i]) {
      ctx.save();
      ctx.rotate(start + sliceAngle / 2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fff';
      ctx.font = '14px Segoe UI';
      ctx.fillText(names[i], radius - 10, 4);
      ctx.restore();
    }
  }
  ctx.restore();
}

function drawAvatarSlices(cx, cy, radius, count, getImageForName) {
  const sliceAngle = (Math.PI * 2) / count;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(state.rotation);

  for (let i = 0; i < count; i += 1) {
    const start = i * sliceAngle;
    const end = start + sliceAngle;
    const name = state.participants[i];

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = '#20212a';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000000';
    ctx.stroke();

    const imageUrl = getImageForName(name);
    const img = getLoadedImage(imageUrl);

    ctx.save();
    ctx.rotate(start + sliceAngle / 2);

    if (img) {
      const avatarRadius = Math.min(radius * 0.28, (sliceAngle * radius) / 2.2);
      const avatarCx = radius * 0.62;
      ctx.save();
      ctx.beginPath();
      ctx.arc(avatarCx, 0, avatarRadius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, avatarCx - avatarRadius, -avatarRadius, avatarRadius * 2, avatarRadius * 2);
      ctx.restore();
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.font = '13px Segoe UI';
    ctx.fillText(name, radius - 8, radius * 0.25);
    ctx.restore();
  }
  ctx.restore();
}

function drawFullWheelImage(cx, cy, radius, count) {
  const img = getLoadedImage(state.fullWheelImageUrl);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(state.rotation);

  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.closePath();

  if (img) {
    ctx.save();
    ctx.clip();
    ctx.drawImage(img, -radius, -radius, radius * 2, radius * 2);
    ctx.restore();
  } else {
    ctx.fillStyle = '#20212a';
    ctx.fill();
  }

  const sliceAngle = (Math.PI * 2) / count;
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  for (let i = 0; i < count; i += 1) {
    const angle = i * sliceAngle;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(radius * Math.cos(angle), radius * Math.sin(angle));
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawPointers(cx, cy, radius) {
  const pointerCount = pointerCountForCurrentSettings();
  const pointerAngles = getPointerAngles(pointerCount);
  pointerAngles.forEach((angle) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
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
  els.winnerText.textContent = '';

  const settings = getSettings();
  const pointerCount = pointerCountForCurrentSettings();
  const count = state.participants.length;
  const sliceAngle = (Math.PI * 2) / count;

  const anchorIndex = Math.floor(Math.random() * count);
  const targetSliceCenter = anchorIndex * sliceAngle + sliceAngle / 2;
  const extraSpins = 8 + Math.floor(Math.random() * 4);

  const startRotation = state.rotation;
  const desiredMod = normalizeAngle(-targetSliceCenter);
  const currentMod = normalizeAngle(startRotation);
  const alignmentDelta = normalizeAngle(desiredMod - currentMod);
  const targetRotation = startRotation + alignmentDelta + extraSpins * Math.PI * 2;

  const duration = settings.spinDurationMs;
  const startTime = performance.now();
  let lastBoundaryIndex = null;

  function spinEasing(x) {
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

    const boundaryIndex = Math.floor(normalizeAngle(-state.rotation) / sliceAngle);
    if (lastBoundaryIndex !== null && boundaryIndex !== lastBoundaryIndex) {
      playTickSound();
    }
    lastBoundaryIndex = boundaryIndex;

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      playLandingSound();
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
    return;
  }

  if (settings.mode === 'elimination') {
    state.eliminatedLog.push(...uniqueRoundNames);
    removeIndices(indices);
    renderParticipants();
    renderLogs();
    els.modeStatus.textContent = t('roundEliminated', { names: uniqueRoundNames.join(', ') });

    const remainingUniqueNames = [...new Set(state.participants)];
    if (remainingUniqueNames.length <= settings.eliminationFinalWinnersCount) {
      state.spinning = true;
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
      scheduleAutoSpin(settings.autoWaitMs);
    } else {
    }
    return;
  }

  if (settings.mode === 'winners') {
    if (settings.winnersSubMode === 'simultaneous') {
      uniqueRoundNames.forEach((name) => {
        if (!state.winnersLog.includes(name)) state.winnersLog.push(name);
      });
      removeIndices(indices);
      renderParticipants();
      renderLogs();
      els.winnerText.textContent = t('winnersLabel', { names: uniqueRoundNames.join(', ') });
      return;
    }

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
      return;
    }

    if (settings.autoMode) {
      scheduleAutoSpin(settings.autoWaitMs);
    } else {
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
  els.winnerText.textContent = '';
  els.modeStatus.textContent = '';
  renderParticipants();
  renderLogs();
  drawWheel();
}

// --- Twitch connection ---
// tmi.js has no reliable browser CDN bundle (its official CDN has been down
// for a long time and the npm package doesn't ship one), so the web version
// speaks Twitch's chat IRC protocol directly over WebSocket instead. This is
// a small, well-documented protocol for anonymous read-only access.

// Unescape IRCv3 tag values: \s -> space, \: -> ;, \\ -> \, \r -> CR, \n -> LF
function unescapeIrcTagValue(value) {
  if (!value) return value;
  return value.replace(/\\(.)/g, (match, ch) => {
    if (ch === 's') return ' ';
    if (ch === ':') return ';';
    if (ch === 'r') return '\r';
    if (ch === 'n') return '\n';
    return ch; // \\ -> \
  });
}

function parseIrcLine(line) {
  let rest = line;
  const tags = {};

  if (rest.startsWith('@')) {
    const spaceIdx = rest.indexOf(' ');
    const tagStr = rest.slice(1, spaceIdx);
    rest = rest.slice(spaceIdx + 1);
    tagStr.split(';').forEach((pair) => {
      const eqIdx = pair.indexOf('=');
      const key = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
      const value = eqIdx === -1 ? '' : unescapeIrcTagValue(pair.slice(eqIdx + 1));
      tags[key] = value;
    });
  }

  let prefix = '';
  if (rest.startsWith(':')) {
    const spaceIdx = rest.indexOf(' ');
    prefix = rest.slice(1, spaceIdx);
    rest = rest.slice(spaceIdx + 1);
  }

  const trailingIdx = rest.indexOf(' :');
  const paramsPart = trailingIdx === -1 ? rest : rest.slice(0, trailingIdx);
  const trailing = trailingIdx === -1 ? '' : rest.slice(trailingIdx + 2);
  const paramTokens = paramsPart.trim().split(' ').filter(Boolean);
  const command = paramTokens[0] || '';
  const channel = paramTokens[1] || '';

  return { tags, prefix, command, channel, message: trailing };
}

// Badge version convention: 4+ digit versions are prefixed with the tier
// ("3018" = Tier 3, 18-month badge); shorter values ("0".."120") are plain
// Tier 1 month milestones.
function getSubTierFromTags(tags) {
  const badgesStr = tags.badges || '';
  if (!badgesStr) return 0;
  const badgeMap = {};
  badgesStr.split(',').forEach((entry) => {
    const [name, version] = entry.split('/');
    badgeMap[name] = version;
  });
  const badgeVersion = badgeMap.subscriber;
  if (!badgeVersion) return 0;
  if (badgeVersion.length >= 4) {
    if (badgeVersion.startsWith('3')) return 3;
    if (badgeVersion.startsWith('2')) return 2;
  }
  return 1;
}

function connectTwitch(channel) {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    const nick = 'justinfan' + Math.floor(10000 + Math.random() * 90000);
    let settled = false;

    ws.onopen = () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send('PASS SCHMOOPIIE');
      ws.send(`NICK ${nick}`);
      ws.send(`JOIN #${channel}`);
    };

    ws.onmessage = (event) => {
      const lines = event.data.split('\r\n').filter(Boolean);
      lines.forEach((line) => {
        if (line.startsWith('PING')) {
          ws.send('PONG :tmi.twitch.tv');
          return;
        }

        const parsed = parseIrcLine(line);

        if (parsed.command === '001' || parsed.command === 'JOIN') {
          if (!settled) {
            settled = true;
            resolve({ ok: true, ws });
          }
        }

        if (parsed.command === 'NOTICE' && !settled) {
          settled = true;
          resolve({ ok: false, error: parsed.message || 'connection refused' });
        }

        if (parsed.command === 'PRIVMSG') {
          if (!state.joinAccepted) return;
          if (parsed.message.trim().toLowerCase() === state.joinCommand) {
            const subTier = getSubTierFromTags(parsed.tags);
            if (els.subsOnlyCheckbox.checked && !(subTier > 0)) return;
            const username = parsed.tags['display-name'] || (parsed.prefix.split('!')[0]);
            addParticipant(username, subTier);
          }
        }
      });
    };

    ws.onerror = () => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, error: 'websocket-error' });
      }
    };

    ws.onclose = () => {
      state.twitchSocket = null;
      els.statusText.textContent = t('statusDisconnected');
      els.connectBtn.disabled = false;
      els.disconnectBtn.disabled = true;
      if (!settled) {
        settled = true;
        resolve({ ok: false, error: 'closed-before-join' });
      }
    };

    // Twitch should confirm the JOIN almost immediately; give up after 8s
    setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, error: 'timeout' });
      }
    }, 8000);
  });
}

els.connectBtn.addEventListener('click', async () => {
  const channel = els.channelInput.value.trim().replace(/^#/, '').toLowerCase();
  if (!channel) return;
  els.connectBtn.disabled = true;
  els.statusText.textContent = '…';

  const result = await connectTwitch(channel);
  if (result.ok) {
    state.twitchSocket = result.ws;
    els.statusText.textContent = t('statusConnected', { channel });
    els.disconnectBtn.disabled = false;
  } else {
    els.statusText.textContent = 'Error: ' + result.error;
    els.connectBtn.disabled = false;
  }
});

els.disconnectBtn.addEventListener('click', () => {
  if (state.twitchSocket) {
    state.twitchSocket.close();
    state.twitchSocket = null;
  }
  els.statusText.textContent = t('statusDisconnected');
  els.connectBtn.disabled = false;
  els.disconnectBtn.disabled = true;
});

els.joinCommandInput.addEventListener('change', () => {
  state.joinCommand = els.joinCommandInput.value.trim().toLowerCase() || '!join';
});

els.startJoinBtn.addEventListener('click', () => {
  state.joinAccepted = true;
  els.startJoinBtn.disabled = true;
  els.stopJoinBtn.disabled = false;
  els.joinStatusText.textContent = t('joinOpen');
});

els.stopJoinBtn.addEventListener('click', () => {
  state.joinAccepted = false;
  els.startJoinBtn.disabled = false;
  els.stopJoinBtn.disabled = true;
  els.joinStatusText.textContent = t('joinStopped');
});

els.wheelBox.addEventListener('click', spin);
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
    // Clipboard permissions may be unavailable; the textarea still holds the list
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

// --- Theme storage (IndexedDB: images live in this browser, not a server) ---
const THEMES_DB_NAME = 'htzroulette-themes';
const THEMES_STORE = 'themes';

function openThemesDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(THEMES_DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(THEMES_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveThemeToDB(name, data) {
  const db = await openThemesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(THEMES_STORE, 'readwrite');
    tx.objectStore(THEMES_STORE).put(data, name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadThemeNamesFromDB() {
  const db = await openThemesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(THEMES_STORE, 'readonly');
    const req = tx.objectStore(THEMES_STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadThemeFromDB(name) {
  const db = await openThemesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(THEMES_STORE, 'readonly');
    const req = tx.objectStore(THEMES_STORE).get(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteThemeFromDB(name) {
  const db = await openThemesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(THEMES_STORE, 'readwrite');
    tx.objectStore(THEMES_STORE).delete(name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function refreshThemeSelect() {
  const names = await loadThemeNamesFromDB();
  els.themeSelect.innerHTML = `<option value="">${t('themeNone')}</option>`;
  names.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    els.themeSelect.appendChild(option);
  });
}

async function applyTheme(themeName) {
  state.playerImageMap.clear();
  state.fullWheelImageUrl = null;
  els.deleteThemeBtn.classList.toggle('hidden', !themeName);

  if (!themeName) {
    state.themeImages = { bg: [], roulette: [] };
    document.body.style.backgroundImage = '';
    drawWheel();
    return;
  }

  const data = await loadThemeFromDB(themeName);
  if (!data) return;

  const bgUrls = data.bg.map((blob) => URL.createObjectURL(blob));
  const rouletteUrls = data.roulette.map((blob) => URL.createObjectURL(blob));
  state.themeImages = { bg: bgUrls, roulette: rouletteUrls };

  document.body.style.backgroundImage = bgUrls.length > 0 ? `url("${pickRandom(bgUrls)}")` : '';
  if (rouletteUrls.length > 0) state.fullWheelImageUrl = pickRandom(rouletteUrls);

  drawWheel();
}

els.themeSelect.addEventListener('change', () => {
  applyTheme(els.themeSelect.value);
});

els.rouletteImageModeSelect.addEventListener('change', () => {
  state.rouletteImageMode = els.rouletteImageModeSelect.value;
  drawWheel();
});

els.saveThemeBtn.addEventListener('click', async () => {
  const name = els.newThemeName.value.trim();
  if (!name) return;
  const bgFiles = Array.from(els.newThemeBgFiles.files || []);
  const rouletteFiles = Array.from(els.newThemeRouletteFiles.files || []);
  await saveThemeToDB(name, { bg: bgFiles, roulette: rouletteFiles });
  els.newThemeName.value = '';
  els.newThemeBgFiles.value = '';
  els.newThemeRouletteFiles.value = '';
  await refreshThemeSelect();
  els.themeSelect.value = name;
  applyTheme(name);
});

els.deleteThemeBtn.addEventListener('click', async () => {
  const name = els.themeSelect.value;
  if (!name) return;
  await deleteThemeFromDB(name);
  await refreshThemeSelect();
  applyTheme('');
});

// --- Sound effects (procedurally generated, no audio files needed) ---
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTickSound() {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 900;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  } catch (err) {
    // Audio may be unavailable/blocked; fail silently
  }
}

function playLandingSound() {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.35);
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
  } catch (err) {
    // Audio may be unavailable/blocked; fail silently
  }
}

// --- Persist settings + participants across page reloads ---
const SAVED_STATE_KEY = 'htz_saved_state';

function saveState() {
  try {
    const data = {
      participants: state.participants,
      eliminatedLog: state.eliminatedLog,
      winnersLog: state.winnersLog,
      spinDuration: els.spinDurationInput.value,
      mode: els.modeSelect.value,
      eliminationSubMode: els.eliminationSubMode.value,
      eliminationArrowCount: els.eliminationArrowCount.value,
      eliminationFinalWinnersCount: els.eliminationFinalWinnersCount.value,
      winnersSubMode: els.winnersSubMode.value,
      winnersCount: els.winnersCountInput.value,
      autoMode: els.autoModeCheckbox.checked,
      autoWait: els.autoWaitInput.value,
      subBonusEnabled: els.subBonusCheckbox.checked,
      subExtraTier1: els.subExtraTier1.value,
      subExtraTier2: els.subExtraTier2.value,
      subExtraTier3: els.subExtraTier3.value,
      colorPalette: state.colorPalette,
      wheelScale: els.wheelScaleSlider.value,
      theme: els.themeSelect.value,
      rouletteImageMode: state.rouletteImageMode,
      joinCommand: els.joinCommandInput.value,
      subsOnly: els.subsOnlyCheckbox.checked,
    };
    localStorage.setItem(SAVED_STATE_KEY, JSON.stringify(data));
  } catch (err) {
    // Storage may be unavailable (private browsing, quota); ignore
  }
}

function loadSavedState() {
  try {
    const raw = localStorage.getItem(SAVED_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

async function applySavedState() {
  const data = loadSavedState();
  if (!data) return;

  state.participants = Array.isArray(data.participants) ? data.participants : [];
  state.eliminatedLog = Array.isArray(data.eliminatedLog) ? data.eliminatedLog : [];
  state.winnersLog = Array.isArray(data.winnersLog) ? data.winnersLog : [];

  if (data.spinDuration != null) els.spinDurationInput.value = data.spinDuration;
  if (data.mode != null) els.modeSelect.value = data.mode;
  if (data.eliminationSubMode != null) els.eliminationSubMode.value = data.eliminationSubMode;
  if (data.eliminationArrowCount != null) els.eliminationArrowCount.value = data.eliminationArrowCount;
  if (data.eliminationFinalWinnersCount != null) {
    els.eliminationFinalWinnersCount.value = data.eliminationFinalWinnersCount;
  }
  if (data.winnersSubMode != null) els.winnersSubMode.value = data.winnersSubMode;
  if (data.winnersCount != null) els.winnersCountInput.value = data.winnersCount;
  els.autoModeCheckbox.checked = !!data.autoMode;
  if (data.autoWait != null) els.autoWaitInput.value = data.autoWait;
  els.subBonusCheckbox.checked = !!data.subBonusEnabled;
  if (data.subExtraTier1 != null) els.subExtraTier1.value = data.subExtraTier1;
  if (data.subExtraTier2 != null) els.subExtraTier2.value = data.subExtraTier2;
  if (data.subExtraTier3 != null) els.subExtraTier3.value = data.subExtraTier3;

  if (data.colorPalette) {
    state.colorPalette = data.colorPalette;
    els.colorPaletteSelect.value = data.colorPalette;
  }
  if (data.wheelScale != null) {
    els.wheelScaleSlider.value = data.wheelScale;
    document.documentElement.style.setProperty('--wheel-scale', data.wheelScale / 100);
  }
  if (data.rouletteImageMode) {
    state.rouletteImageMode = data.rouletteImageMode;
    els.rouletteImageModeSelect.value = data.rouletteImageMode;
  }
  if (data.joinCommand) {
    els.joinCommandInput.value = data.joinCommand;
    state.joinCommand = data.joinCommand.trim().toLowerCase() || '!join';
  }
  els.subsOnlyCheckbox.checked = !!data.subsOnly;

  if (data.theme) {
    els.themeSelect.value = data.theme;
    await applyTheme(data.theme);
  }
}

[
  els.spinDurationInput, els.modeSelect, els.eliminationSubMode, els.eliminationArrowCount,
  els.eliminationFinalWinnersCount, els.winnersSubMode, els.winnersCountInput, els.autoModeCheckbox,
  els.autoWaitInput, els.subBonusCheckbox, els.subExtraTier1, els.subExtraTier2, els.subExtraTier3,
  els.colorPaletteSelect, els.wheelScaleSlider, els.rouletteImageModeSelect, els.joinCommandInput,
  els.subsOnlyCheckbox,
].forEach((el) => el.addEventListener('change', saveState));

// --- Debug mode: temporary drag-to-reorder for layout tuning (flex `order`,
// so gaps/margins/padding stay exactly as configured; nothing is persisted) ---
const DEBUG_CONTAINER_SELECTORS = ['main', '.left-column', '.participants', '.wheel-section', '.settings'];
let debugDragSource = null;

function onDebugDragStart(e) {
  debugDragSource = e.currentTarget;
  e.dataTransfer.effectAllowed = 'move';
}
function onDebugDragOver(e) {
  e.preventDefault();
}
function onDebugDrop(e) {
  e.preventDefault();
  const target = e.currentTarget;
  if (!debugDragSource || debugDragSource === target) return;
  const tmp = debugDragSource.style.order;
  debugDragSource.style.order = target.style.order;
  target.style.order = tmp;
}

function setDebugMode(enabled) {
  document.body.classList.toggle('debug-mode', enabled);
  DEBUG_CONTAINER_SELECTORS.forEach((sel) => {
    const container = document.querySelector(sel);
    if (!container) return;
    Array.from(container.children).forEach((child, i) => {
      if (enabled) {
        if (!child.style.order) child.style.order = String(i);
        child.draggable = true;
        child.addEventListener('dragstart', onDebugDragStart);
        child.addEventListener('dragover', onDebugDragOver);
        child.addEventListener('drop', onDebugDrop);
      } else {
        child.draggable = false;
        child.removeEventListener('dragstart', onDebugDragStart);
        child.removeEventListener('dragover', onDebugDragOver);
        child.removeEventListener('drop', onDebugDrop);
      }
    });
  });
}

els.debugModeCheckbox.addEventListener('change', () => {
  setDebugMode(els.debugModeCheckbox.checked);
});

// --- Init ---
loadStrings().then(async () => {
  els.colorPaletteSelect.value = state.colorPalette;
  loadTwitchCredentials();
  await refreshThemeSelect();
  await applySavedState();
  renderParticipants();
  renderLogs();
  updateSettingsVisibility();
  drawWheel();
});
