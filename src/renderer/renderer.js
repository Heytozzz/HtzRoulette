// Renderer process: UI logic, no direct Node/Electron access (uses window.htz bridge)

const state = {
  participants: [],
  spinning: false,
  rotation: 0,
  eliminatedLog: [],
  winnersLog: [],
  autoTimer: null,
  colorPalette: 'red',
  joinAccepted: false,
  themeImages: { bg: [], roulette: [] },
  rouletteImageMode: 'colors',
  playerImageMap: new Map(),
  fullWheelImageUrl: null,
  imageCache: new Map(),
  profilePhotoMap: new Map(),
  twitchApiToken: null,
  twitchApiTokenClientId: null,
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
  wheelScaleSlider: document.getElementById('wheelScaleSlider'),
  themeSelect: document.getElementById('themeSelect'),
  rouletteImageModeSelect: document.getElementById('rouletteImageModeSelect'),
  twitchClientId: document.getElementById('twitchClientId'),
  twitchClientSecret: document.getElementById('twitchClientSecret'),
};

const ctx = els.wheelCanvas.getContext('2d');
const PALETTE_HUES = {
  red: 0,
  blue: 210,
  green: 120,
  purple: 275,
  gray: 0,
};

function getSliceColor(index, count) {
  if (state.colorPalette === 'rainbow') {
    const hue = (index * 360) / count;
    return `hsl(${hue}, 65%, 50%)`;
  }

  const hue = PALETTE_HUES[state.colorPalette] ?? PALETTE_HUES.red;
  const posInCircle = index / count; // 0..1 around the wheel
  // Triangle wave (0 -> 1 -> 0): 0 at the seam between first/last slice, 1 in
  // the middle. The seam always stays a dark, hue-tinted gray (never pure
  // black); the middle is the fully saturated, light base color. The more
  // slices there are, the more of them sample the low-saturation gray zone
  // near the seam, so long lists naturally read grayer at the edges.
  const triangle = posInCircle < 0.5 ? posInCircle * 2 : (1 - posInCircle) * 2;
  const lightness = 18 + triangle * 40; // 18% (dark) .. 58% (light)
  const saturation = state.colorPalette === 'gray' ? 0 : 12 + triangle * 68; // 12% (grayish) .. 80% (vivid)
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
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

// Twitch chat join: one entry per person, plus their sub bonus extras applied
// immediately for the tier Twitch reports in their subscriber badge.
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

// Loads (and caches) an image; returns it once ready, otherwise triggers a
// redraw when it finishes loading and returns null for now.
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
// Uses the app's own Client ID/Secret (entered by the user, stored only in
// this device's localStorage) to fetch real Twitch avatars. Only resolves
// for names that match an actual Twitch login exactly (case-insensitive) —
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

  // Nothing added yet: show a nice-looking placeholder wheel instead of a
  // flat empty circle.
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

  // Black division lines between slots
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
      // A person with several extra slots only ever counts as ONE winner
      uniqueRoundNames.forEach((name) => {
        if (!state.winnersLog.includes(name)) state.winnersLog.push(name);
      });
      removeIndices(indices);
      renderParticipants();
      renderLogs();
      els.winnerText.textContent = t('winnersLabel', { names: uniqueRoundNames.join(', ') });
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
  if (!state.joinAccepted) return;
  if (els.subsOnlyCheckbox.checked && !(payload.subTier > 0)) return;
  addParticipant(payload.username, payload.subTier);
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

async function loadThemeList() {
  const themes = await window.htz.listThemes();
  els.themeSelect.innerHTML = `<option value="">${t('themeNone')}</option>`;
  themes.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    els.themeSelect.appendChild(option);
  });
}

async function applyTheme(themeName) {
  state.playerImageMap.clear();
  state.fullWheelImageUrl = null;

  if (!themeName) {
    state.themeImages = { bg: [], roulette: [] };
    document.body.style.backgroundImage = '';
    drawWheel();
    return;
  }

  const images = await window.htz.getThemeImages(themeName);
  state.themeImages = images;

  if (images.bg && images.bg.length > 0) {
    document.body.style.backgroundImage = `url("${pickRandom(images.bg)}")`;
  } else {
    document.body.style.backgroundImage = '';
  }

  if (images.roulette && images.roulette.length > 0) {
    state.fullWheelImageUrl = pickRandom(images.roulette);
  }

  drawWheel();
}

els.themeSelect.addEventListener('change', () => {
  applyTheme(els.themeSelect.value);
});

els.rouletteImageModeSelect.addEventListener('change', () => {
  state.rouletteImageMode = els.rouletteImageModeSelect.value;
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
  loadTwitchCredentials();
  loadThemeList();
  renderParticipants();
  renderLogs();
  updateSettingsVisibility();
  drawWheel();
});
