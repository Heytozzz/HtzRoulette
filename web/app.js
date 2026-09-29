// Web app: runs entirely in the browser. Talks to Twitch chat directly over
// a WebSocket using Twitch's IRC protocol (no server/backend, no tmi.js
// dependency — its browser CDN bundle is unreliable). Themes/images are
// stored in this browser's IndexedDB (there's no filesystem to read from).

const state = {
  participants: [],
  spinning: false,
  animating: false,
  rotation: 0,
  eliminatedLog: [],
  winnersLog: [],
  autoTimer: null,
  colorPalette: 'red',
  wheelFontScale: 1,
  subNames: new Set(),
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

// Overlay mode: index.html?overlay=wheel|eliminated|participants&room=XXXX
const OVERLAY_PARAMS = new URLSearchParams(location.search);
const OVERLAY_TYPE = OVERLAY_PARAMS.get('overlay');
const IS_OVERLAY = ['wheel', 'eliminated', 'participants'].includes(OVERLAY_TYPE);
const OVERLAY_SOUND = OVERLAY_PARAMS.get('sound') === '1';

// Timers that keep running in background tabs/minimized windows. Browsers
// throttle/pause setTimeout and requestAnimationFrame there, but timers
// living inside a Web Worker are not throttled. Falls back to normal timers.
const bgTimers = (() => {
  let worker = null;
  const entries = new Map();
  let nextId = 1;
  try {
    const src = 'const t=new Map();onmessage=(e)=>{const{c,id,ms,rep}=e.data;'
      + 'if(c==="set"){t.set(id,(rep?setInterval:setTimeout)(()=>{if(!rep)t.delete(id);postMessage(id)},ms))}'
      + 'else{const h=t.get(id);if(h!==undefined){clearTimeout(h);clearInterval(h);t.delete(id)}}}';
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = (e) => {
      const en = entries.get(e.data);
      if (!en) return;
      if (!en.rep) entries.delete(e.data);
      en.fn();
    };
  } catch (err) {
    worker = null;
  }
  function set(fn, ms, rep) {
    const id = nextId++;
    if (worker) {
      entries.set(id, { fn, rep });
      worker.postMessage({ c: 'set', id, ms, rep });
    } else {
      const h = (rep ? setInterval : setTimeout)(() => { if (!rep) entries.delete(id); fn(); }, ms);
      entries.set(id, { h });
    }
    return id;
  }
  function clear(id) {
    const en = entries.get(id);
    if (!en) return;
    entries.delete(id);
    if (worker) worker.postMessage({ c: 'clear', id });
    else { clearTimeout(en.h); clearInterval(en.h); }
  }
  return { timeout: (fn, ms) => set(fn, ms, false), interval: (fn, ms) => set(fn, ms, true), clear };
})();

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
  wheelFontSizeSlider: document.getElementById('wheelFontSizeSlider'),
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
  overlayStatusText: document.getElementById('overlayStatusText'),
  cmdStatusText: document.getElementById('cmdStatusText'),
  cmdPrefixInput: document.getElementById('cmdPrefixInput'),
  modCmdEnabled: document.getElementById('modCmdEnabled'),
  modCmdAllowMods: document.getElementById('modCmdAllowMods'),
  modCmdWhitelist: document.getElementById('modCmdWhitelist'),
  savedListsContainer: document.getElementById('savedListsContainer'),
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

const WHEEL_BASE_SIZE = 520;

function applyWheelScale(scaleValue) {
  const size = Math.round(WHEEL_BASE_SIZE * (scaleValue / 100));
  els.wheelCanvas.width = size;
  els.wheelCanvas.height = size;
  drawWheel();
}

els.wheelScaleSlider.addEventListener('input', () => {
  applyWheelScale(els.wheelScaleSlider.value);
});

els.wheelFontSizeSlider.addEventListener('input', () => {
  state.wheelFontScale = els.wheelFontSizeSlider.value / 100;
  drawWheel();
});

// --- Participants list ---
function truncateName(name, max = 10) {
  return name.length > max ? `${name.slice(0, max)}...` : name;
}

function renderParticipants() {
  els.participantList.innerHTML = '';
  if (state.participants.length === 0) {
    if (!IS_OVERLAY) {
      const li = document.createElement('li');
      li.textContent = t('empty');
      els.participantList.appendChild(li);
    }
    saveState();
    return;
  }

  // Group by name for display only (×N badge). The wheel and shuffle still
  // use the full flat state.participants array, so every extra slot spins
  // and can be won/eliminated independently.
  const counts = new Map();
  state.participants.forEach((name) => counts.set(name, (counts.get(name) || 0) + 1));

  counts.forEach((count, name) => {
    const li = document.createElement('li');

    const nameWrap = document.createElement('span');
    nameWrap.className = 'name-wrap';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = truncateName(name);
    nameSpan.title = name;
    if (state.subNames.has(name)) nameSpan.classList.add('sub-name');
    nameWrap.appendChild(nameSpan);

    if (count > 1) {
      const badge = document.createElement('span');
      badge.className = 'count-badge';
      badge.textContent = `×${count}`;
      nameWrap.appendChild(badge);
    }
    li.appendChild(nameWrap);

    const actions = document.createElement('span');
    actions.className = 'actions';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '×';
    removeBtn.title = t('removeTitle');
    removeBtn.addEventListener('click', () => removeParticipantByName(name));
    actions.appendChild(removeBtn);

    const dupBtn = document.createElement('button');
    dupBtn.className = 'dup-btn';
    dupBtn.textContent = '+';
    dupBtn.title = t('duplicateTitle');
    dupBtn.addEventListener('click', () => duplicateParticipantByName(name));
    actions.appendChild(dupBtn);

    li.appendChild(actions);
    els.participantList.appendChild(li);
  });
  saveState();
}

function duplicateParticipantByName(name) {
  const lastIndex = state.participants.lastIndexOf(name);
  state.participants.splice(lastIndex + 1, 0, name);
  renderParticipants();
  drawWheel();
}

function removeParticipantByName(name) {
  const index = state.participants.indexOf(name);
  if (index === -1) return;
  state.participants.splice(index, 1);
  if (!state.participants.includes(name)) state.subNames.delete(name);
  renderParticipants();
  drawWheel();
}

// Twitch chat join: one entry per person, plus sub bonus extras applied at once
function addParticipant(username, subTier) {
  if (!username) return;
  if (hasParticipant(username)) return;
  if (subTier > 0) state.subNames.add(username);
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
  if (isSub) state.subNames.add(name);
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
  [...state.eliminatedLog].reverse().forEach((name) => {
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
  queueOverlaySync();
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

// Sub names on the wheel: white core, then an outline in the theme's neon
// color, then a glow of that same color around the outline.
function drawSubNeonText(text, x, y, fontSize) {
  const neon = getSubNeonColor();
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = Math.max(3, fontSize * 0.2);
  ctx.strokeStyle = neon;
  ctx.shadowColor = neon;
  ctx.shadowBlur = Math.max(10, fontSize * 0.6);
  ctx.strokeText(text, x, y); // outline + glow
  ctx.strokeText(text, x, y); // second pass makes the glow stronger
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x, y); // white core on top
  ctx.restore();
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
      const isSub = state.subNames.has(names[i]);
      const fontSize = Math.round(21 * state.wheelFontScale);
      ctx.font = `${fontSize}px Segoe UI`;
      if (isSub) {
        drawSubNeonText(names[i], radius - 10, 4, fontSize);
      } else {
        ctx.fillStyle = '#fff';
        ctx.fillText(names[i], radius - 10, 4);
      }
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
    const nameIsSub = state.subNames.has(name);
    const fontSize = Math.round(20 * state.wheelFontScale);
    ctx.font = `${fontSize}px Segoe UI`;
    if (nameIsSub) {
      drawSubNeonText(name, radius - 8, radius * 0.25, fontSize);
    } else {
      ctx.fillStyle = '#fff';
      ctx.fillText(name, radius - 8, radius * 0.25);
    }
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

// Time-based animation. requestAnimationFrame draws it smoothly while the
// tab is visible; a Web Worker watchdog keeps stepping it (and finishes it on
// time) when the browser stops delivering animation frames in the background.
function runSpinAnimation({ startRotation, targetRotation, duration, sliceAngle, onDone }) {
  const startTime = performance.now();
  let lastStep = 0;
  let finished = false;
  let watchdog = null;

  scheduleSpinSounds({ startRotation, targetRotation, duration, sliceAngle });
  state.animating = true;

  function step() {
    if (finished) return;
    const now = performance.now();
    lastStep = now;
    const progress = Math.min((now - startTime) / duration, 1);
    state.rotation = startRotation + (targetRotation - startRotation) * spinEasing(progress);
    drawWheel();

    if (progress >= 1) {
      finished = true;
      state.animating = false;
      bgTimers.clear(watchdog);
      onDone();
    }
  }

  function frame() {
    if (finished) return;
    step();
    requestAnimationFrame(frame);
  }

  watchdog = bgTimers.interval(() => {
    if (performance.now() - lastStep > 60) step();
  }, 30);
  requestAnimationFrame(frame);
}
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
  sendOverlay({ t: 'spin', startRotation, targetRotation, duration });
  runSpinAnimation({
    startRotation,
    targetRotation,
    duration,
    sliceAngle,
    onDone: () => onSpinComplete(getSelectionForRotation(state.rotation, pointerCount), settings),
  });
}

function removeIndices(indices) {
  const indexSet = new Set(indices);
  state.participants = state.participants.filter((_, i) => !indexSet.has(i));
}

function scheduleAutoSpin(waitMs) {
  bgTimers.clear(state.autoTimer);
  state.autoTimer = bgTimers.timeout(() => {
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
    drawWheel();
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
      drawWheel();
      els.winnerText.textContent = t('winnersLabel', { names: uniqueRoundNames.join(', ') });
      return;
    }

    const name = names[0];
    removeIndices(indices);
    if (!state.winnersLog.includes(name)) state.winnersLog.push(name);
    renderParticipants();
    renderLogs();
    drawWheel();
    els.modeStatus.textContent = `${state.winnersLog.length}/${settings.winnersCount}`;

    const remainingUniqueNames = new Set(state.participants).size;
    const done = state.winnersLog.length >= settings.winnersCount || remainingUniqueNames === 0;
    if (done) {
      els.winnerText.textContent = t('finalWinnerTie', { names: state.winnersLog.join(', ') });
      return;
    }

    if (settings.autoMode) {
      scheduleAutoSpin(settings.autoWaitMs);
    }
  }
}

function resetParticipants() {
  bgTimers.clear(state.autoTimer);
  state.participants = [];
  state.rotation = 0;
  state.eliminatedLog = [];
  state.winnersLog = [];
  state.subNames.clear();
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

// --- Chat commands: "<prefix> <command> [args]" (default prefix "!htz") ---
// User commands: join, leave. Mod commands (off by default): add, kick, spin,
// reset, open, close, mode, arrows, save, load. Each has a Spanish alias.
const DEFAULT_CMD_PREFIX = '!htz';
const SAVED_LISTS_KEY = 'htz_saved_lists';
const normCmd = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const CMD_ALIASES = {
  join: ['join', 'unirse', 'entrar'],
  leave: ['leave', 'salir'],
  add: ['add', 'anadir', 'agregar'],
  kick: ['kick', 'expulsar', 'sacar'],
  spin: ['spin', 'girar'],
  reset: ['reset', 'reiniciar'],
  open: ['open', 'abrir'],
  close: ['close', 'cerrar'],
  mode: ['mode', 'modo'],
  arrows: ['arrows', 'flechas'],
  save: ['save', 'guardar'],
  load: ['load', 'cargar'],
};
const CMD_LOOKUP = new Map();
Object.entries(CMD_ALIASES).forEach(([name, aliases]) => {
  aliases.forEach((alias) => CMD_LOOKUP.set(alias, name));
});

// normal / multiple = "Ganadores múltiples" / deathmatch = "Eliminatoria"
const MODE_ALIASES = {
  normal: ['normal'],
  winners: ['multiple', 'multiples', 'ganadores', 'winners'],
  elimination: ['deathmatch', 'eliminatoria', 'eliminacion', 'elimination'],
};
const CMDS_BLOCKED_WHILE_SPINNING = new Set(['add', 'kick', 'reset', 'mode', 'arrows', 'load']);
const TWITCH_NAME_RE = /^[A-Za-z0-9_]{1,25}$/;

function hasParticipant(name) {
  const lower = name.toLowerCase();
  return state.participants.some((n) => n.toLowerCase() === lower);
}

function removeAllByName(name) {
  const lower = name.toLowerCase();
  if (!hasParticipant(name)) return false;
  state.participants = state.participants.filter((n) => n.toLowerCase() !== lower);
  [...state.subNames].forEach((n) => { if (n.toLowerCase() === lower) state.subNames.delete(n); });
  renderParticipants();
  drawWheel();
  return true;
}

function setJoinAccepted(open) {
  state.joinAccepted = open;
  els.startJoinBtn.disabled = open;
  els.stopJoinBtn.disabled = !open;
  els.joinStatusText.textContent = t(open ? 'joinOpen' : 'joinStopped');
}

let cmdStatusTimer = null;
function setCmdStatus(message) {
  els.cmdStatusText.textContent = message;
  clearTimeout(cmdStatusTimer);
  cmdStatusTimer = setTimeout(() => { els.cmdStatusText.textContent = ''; }, 10000);
}

function setControl(el, value) {
  el.value = value;
  el.dispatchEvent(new Event('input'));
  el.dispatchEvent(new Event('change'));
}

// Saved lists (participants + which names are subs), kept in this browser
function loadSavedLists() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_LISTS_KEY)) || {};
  } catch (err) {
    return {};
  }
}

function storeSavedLists(lists) {
  try {
    localStorage.setItem(SAVED_LISTS_KEY, JSON.stringify(lists));
  } catch (err) {
    // Storage may be unavailable; ignore
  }
}

function findSavedListKey(lists, name) {
  const lower = name.toLowerCase();
  return Object.keys(lists).find((k) => k.toLowerCase() === lower);
}

function renderSavedLists() {
  if (!els.savedListsContainer) return;
  const lists = loadSavedLists();
  const names = Object.keys(lists);
  els.savedListsContainer.innerHTML = '';
  if (names.length === 0) {
    const p = document.createElement('p');
    p.className = 'modal-note';
    p.textContent = t('savedListsEmpty');
    els.savedListsContainer.appendChild(p);
    return;
  }
  names.forEach((name) => {
    const row = document.createElement('div');
    row.className = 'saved-list-row';
    const label = document.createElement('span');
    label.textContent = `${name} (${lists[name].participants.length})`;
    const del = document.createElement('button');
    del.textContent = t('deleteBtn');
    del.addEventListener('click', () => {
      const current = loadSavedLists();
      delete current[name];
      storeSavedLists(current);
      renderSavedLists();
    });
    row.append(label, del);
    els.savedListsContainer.appendChild(row);
  });
}

function getCmdWhitelist() {
  return new Set(
    els.modCmdWhitelist.value.split(/[\s,;]+/).map((n) => n.replace(/^@/, '').toLowerCase()).filter(Boolean),
  );
}

// Master switch must be on. Then: broadcaster always, mods if allowed, or whitelisted users.
function isModAuthorized({ tags, login, displayName }) {
  if (!els.modCmdEnabled.checked) return false;
  const badges = tags.badges || '';
  if (/(^|,)broadcaster\//.test(badges)) return true;
  const isMod = tags.mod === '1' || /(^|,)moderator\//.test(badges);
  if (els.modCmdAllowMods.checked && isMod) return true;
  const whitelist = getCmdWhitelist();
  return whitelist.has(login) || whitelist.has(displayName.toLowerCase());
}

function parseChatCommand(text) {
  const prefix = els.cmdPrefixInput.value.trim() || DEFAULT_CMD_PREFIX;
  const prefixTokens = prefix.split(/\s+/).map(normCmd);
  const tokens = text.split(/\s+/);
  if (tokens.length <= prefixTokens.length) return null;
  for (let i = 0; i < prefixTokens.length; i += 1) {
    if (normCmd(tokens[i]) !== prefixTokens[i]) return null;
  }
  const name = CMD_LOOKUP.get(normCmd(tokens[prefixTokens.length]));
  if (!name) return null;
  return { name, args: tokens.slice(prefixTokens.length + 1) };
}

function handleJoin(name, subTier) {
  if (!state.joinAccepted) return;
  if (els.subsOnlyCheckbox.checked && !(subTier > 0)) return;
  addParticipant(name, subTier);
}

function parseListName(args) {
  const rest = [...args];
  if (rest.length && ['list', 'lista'].includes(normCmd(rest[0]))) rest.shift();
  return rest.join(' ').trim().slice(0, 40);
}

// Returns a feedback message (shown in the header) or '' for none
function runModCommand({ name, args }) {
  if (state.animating && CMDS_BLOCKED_WHILE_SPINNING.has(name)) return t('cmdBusy');

  switch (name) {
    case 'add': {
      if (!args.length) return t('cmdMissingArg');
      const added = [];
      const existing = [];
      const invalid = [];
      args.forEach((raw) => {
        const user = raw.replace(/^@/, '');
        if (!TWITCH_NAME_RE.test(user)) invalid.push(raw);
        else if (hasParticipant(user)) existing.push(user);
        else { addParticipant(user, 0); added.push(user); }
      });
      const parts = [];
      if (added.length) parts.push(t('cmdAdded', { names: added.join(', ') }));
      if (existing.length) parts.push(t('cmdAlready', { names: existing.join(', ') }));
      if (invalid.length) parts.push(t('cmdInvalidName', { name: invalid.join(', ') }));
      return parts.join(' · ');
    }
    case 'kick': {
      if (!args.length) return t('cmdMissingArg');
      const kicked = [];
      const missing = [];
      args.forEach((raw) => {
        const user = raw.replace(/^@/, '');
        if (removeAllByName(user)) kicked.push(user);
        else missing.push(user);
      });
      const parts = [];
      if (kicked.length) parts.push(t('cmdKicked', { names: kicked.join(', ') }));
      if (missing.length) parts.push(t('cmdNotFound', { name: missing.join(', ') }));
      return parts.join(' · ');
    }
    case 'spin':
      if (state.spinning) return t('cmdCannotSpin');
      if (state.participants.length === 0) return t('cmdNoParticipants');
      spin();
      return t('cmdSpinning');
    case 'reset':
      resetParticipants();
      return t('cmdResetDone');
    case 'open':
      setJoinAccepted(true);
      return t('cmdOpened');
    case 'close':
      setJoinAccepted(false);
      return t('cmdClosed');
    case 'mode': {
      const key = args[0] ? normCmd(args[0]) : '';
      const target = Object.keys(MODE_ALIASES).find((m) => MODE_ALIASES[m].includes(key));
      if (!target) return t('cmdModeInvalid');
      setControl(els.modeSelect, target);
      return t('cmdModeSet', { mode: els.modeSelect.selectedOptions[0].textContent });
    }
    case 'arrows': {
      const mode = els.modeSelect.value;
      if (mode === 'normal') return t('cmdArrowsNotApplicable');
      const min = mode === 'winners' ? 2 : 1;
      const max = 8;
      const n = /^\d+$/.test(args[0] || '') ? Number(args[0]) : NaN;
      if (!(n >= min && n <= max)) return t('cmdArrowsInvalid', { min, max });
      if (mode === 'elimination') {
        setControl(els.eliminationSubMode, n >= 2 ? 'multiple' : 'simple');
        if (n >= 2) setControl(els.eliminationArrowCount, n);
      } else {
        setControl(els.winnersSubMode, 'simultaneous');
        setControl(els.winnersCountInput, n);
      }
      return t('cmdArrowsSet', { n });
    }
    case 'save': {
      const listName = parseListName(args);
      if (!listName) return t('cmdListNameMissing');
      if (state.participants.length === 0) return t('cmdListEmpty');
      const lists = loadSavedLists();
      const existingKey = findSavedListKey(lists, listName);
      if (existingKey) delete lists[existingKey];
      lists[listName] = {
        participants: [...state.participants],
        subNames: [...state.subNames],
        savedAt: Date.now(),
      };
      storeSavedLists(lists);
      renderSavedLists();
      return t('cmdListSaved', { name: listName, n: state.participants.length });
    }
    case 'load': {
      const listName = parseListName(args);
      if (!listName) return t('cmdListNameMissing');
      const lists = loadSavedLists();
      const key = findSavedListKey(lists, listName);
      if (!key) return t('cmdListNotFound', { name: listName });
      resetParticipants();
      state.participants = [...lists[key].participants];
      state.subNames = new Set(lists[key].subNames || []);
      renderParticipants();
      drawWheel();
      return t('cmdListLoaded', { name: key, n: state.participants.length });
    }
    default:
      return '';
  }
}

function handleChatMessage(parsed) {
  // Twitch appends an invisible character to repeated messages; strip it and zero-width chars
  const text = parsed.message.replace(/[\u{E0000}-\u{E007F}\u200B-\u200D\uFEFF]/gu, '').trim();
  if (!text) return;
  const login = parsed.prefix.split('!')[0].toLowerCase();
  const who = {
    tags: parsed.tags,
    login,
    displayName: parsed.tags['display-name'] || login,
    subTier: getSubTierFromTags(parsed.tags),
  };

  // Classic join command from the header (e.g. "!join")
  if (text.toLowerCase() === state.joinCommand) {
    handleJoin(who.displayName, who.subTier);
    return;
  }

  const cmd = parseChatCommand(text);
  if (!cmd) return;

  if (cmd.name === 'join') { handleJoin(who.displayName, who.subTier); return; }
  if (cmd.name === 'leave') {
    if (!state.animating) removeAllByName(who.displayName);
    return;
  }

  if (!isModAuthorized(who)) return;
  const message = runModCommand(cmd);
  if (message) setCmdStatus(`@${who.displayName}: ${message}`);
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

        if (parsed.command === 'PRIVMSG') handleChatMessage(parsed);
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

els.startJoinBtn.addEventListener('click', () => setJoinAccepted(true));
els.stopJoinBtn.addEventListener('click', () => setJoinAccepted(false));

els.wheelBox.addEventListener('click', (e) => {
  if (e.target.closest('.eliminated-panel')) return;
  spin();
});
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

// Settings modal tabs (the last opened tab is remembered until the page reloads)
function showSettingsTab(name) {
  document.querySelectorAll('#appearanceModal .tab-btn').forEach((btn) => {
    const active = btn.dataset.tab === name;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('#appearanceModal .settings-tab').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.tab !== name);
  });
}
document.querySelectorAll('#appearanceModal .tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => showSettingsTab(btn.dataset.tab));
});

els.gearBtn.addEventListener('click', () => {
  els.appearanceModal.classList.remove('hidden');
});

els.closeAppearanceModal.addEventListener('click', () => {
  els.appearanceModal.classList.add('hidden');
});

els.appearanceModal.addEventListener('click', (e) => {
  if (e.target === els.appearanceModal) els.appearanceModal.classList.add('hidden');
});

const THEME_ACCENT_COLORS = {
  red: ['#c1121f', '#e14a4a'],
  blue: ['#1261c1', '#4d9de8'],
  green: ['#2ea52e', '#55c955'],
  purple: ['#6a1cad', '#8b3fd1'],
  gray: ['#6b6b6b', '#8a8a8a'],
  rainbow: ['#6441a5', '#7d5bbe'],
};

// Sub names on the wheel always glow gold, whatever the theme palette is
const SUB_NEON_COLOR = '#ffd700';

function getSubNeonColor() {
  return SUB_NEON_COLOR;
}

function applyThemeAccent(palette) {
  const [accent, hover] = THEME_ACCENT_COLORS[palette] || THEME_ACCENT_COLORS.red;
  document.documentElement.style.setProperty('--theme-accent', accent);
  document.documentElement.style.setProperty('--theme-accent-hover', hover);
}

els.colorPaletteSelect.addEventListener('change', () => {
  state.colorPalette = els.colorPaletteSelect.value;
  applyThemeAccent(state.colorPalette);
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
  const stillPresent = new Set(lines);
  [...state.subNames].forEach((name) => {
    if (!stillPresent.has(name)) state.subNames.delete(name);
  });
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

// Unlock/create the AudioContext on the first user gesture so it is already
// running (not suspended) when a spin starts from a background tab.
function unlockAudio() {
  try { getAudioCtx(); } catch (err) { /* audio unavailable */ }
}
['pointerdown', 'keydown', 'touchstart'].forEach((ev) => {
  window.addEventListener(ev, unlockAudio, { passive: true });
});
document.addEventListener('visibilitychange', () => {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
});

function scheduleTick(ctx, when) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 900;
  gain.gain.setValueAtTime(0.12, when);
  gain.gain.exponentialRampToValueAtTime(0.001, when + 0.04);
  osc.connect(gain).connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.05);
}

function scheduleLanding(ctx, when) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(420, when);
  osc.frequency.exponentialRampToValueAtTime(140, when + 0.35);
  gain.gain.setValueAtTime(0.35, when);
  gain.gain.exponentialRampToValueAtTime(0.001, when + 0.45);
  osc.connect(gain).connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.45);
}

// The spin is fully deterministic (same easing/duration as the animation), so
// every tick and the landing sound are computed up front and scheduled on the
// audio clock. The audio thread plays them on time regardless of whether the
// tab is in the background or the main thread is throttled.
function scheduleSpinSounds({ startRotation, targetRotation, duration, sliceAngle }) {
  if (IS_OVERLAY && !OVERLAY_SOUND) return;
  let ctx;
  try {
    ctx = getAudioCtx();
  } catch (err) {
    return;
  }
  const startPerf = performance.now();

  const tickTimesMs = [];
  const MIN_TICK_GAP_MS = 20;
  let lastIndex = null;
  let lastTickMs = -Infinity;
  for (let ms = 0; ms <= duration; ms += 2) {
    const rot = startRotation + (targetRotation - startRotation) * spinEasing(ms / duration);
    const idx = Math.floor(normalizeAngle(-rot) / sliceAngle);
    if (lastIndex !== null && idx !== lastIndex && ms - lastTickMs >= MIN_TICK_GAP_MS) {
      tickTimesMs.push(ms);
      lastTickMs = ms;
    }
    lastIndex = idx;
  }

  const schedule = () => {
    try {
      const elapsedMs = performance.now() - startPerf;
      const spinStartOnAudioClock = ctx.currentTime - elapsedMs / 1000;
      tickTimesMs.forEach((ms) => {
        if (ms >= elapsedMs) scheduleTick(ctx, spinStartOnAudioClock + ms / 1000);
      });
      if (duration >= elapsedMs) scheduleLanding(ctx, spinStartOnAudioClock + duration / 1000);
    } catch (err) {
      // Audio may be unavailable/blocked; fail silently
    }
  };

  if (ctx.state === 'running') schedule();
  else ctx.resume().then(schedule).catch(() => {});
}

// --- Persist settings + participants across page reloads ---
const SAVED_STATE_KEY = 'htz_saved_state';

function saveState() {
  if (IS_OVERLAY) return;
  queueOverlaySync();
  try {
    const data = {
      participants: state.participants,
      subNames: [...state.subNames],
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
      wheelFontSize: els.wheelFontSizeSlider.value,
      theme: els.themeSelect.value,
      rouletteImageMode: state.rouletteImageMode,
      joinCommand: els.joinCommandInput.value,
      subsOnly: els.subsOnlyCheckbox.checked,
      cmdPrefix: els.cmdPrefixInput.value,
      modCmdEnabled: els.modCmdEnabled.checked,
      modCmdAllowMods: els.modCmdAllowMods.checked,
      modCmdWhitelist: els.modCmdWhitelist.value,
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
  state.subNames = new Set(Array.isArray(data.subNames) ? data.subNames : []);
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
    applyThemeAccent(data.colorPalette);
  }
  if (data.wheelScale != null) {
    els.wheelScaleSlider.value = data.wheelScale;
    applyWheelScale(data.wheelScale);
  }
  if (data.wheelFontSize != null) {
    els.wheelFontSizeSlider.value = data.wheelFontSize;
    state.wheelFontScale = data.wheelFontSize / 100;
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
  if (data.cmdPrefix != null) els.cmdPrefixInput.value = data.cmdPrefix;
  els.modCmdEnabled.checked = !!data.modCmdEnabled;
  if (data.modCmdAllowMods != null) els.modCmdAllowMods.checked = !!data.modCmdAllowMods;
  if (data.modCmdWhitelist != null) els.modCmdWhitelist.value = data.modCmdWhitelist;

  if (data.theme) {
    els.themeSelect.value = data.theme;
    await applyTheme(data.theme);
  }
}

[
  els.spinDurationInput, els.modeSelect, els.eliminationSubMode, els.eliminationArrowCount,
  els.eliminationFinalWinnersCount, els.winnersSubMode, els.winnersCountInput, els.autoModeCheckbox,
  els.autoWaitInput, els.subBonusCheckbox, els.subExtraTier1, els.subExtraTier2, els.subExtraTier3,
  els.colorPaletteSelect, els.wheelScaleSlider, els.wheelFontSizeSlider, els.rouletteImageModeSelect, els.joinCommandInput,
  els.subsOnlyCheckbox, els.cmdPrefixInput, els.modCmdEnabled, els.modCmdAllowMods, els.modCmdWhitelist,
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

// --- OBS overlays ---
// The control page (host) pushes its state to overlay pages over WebRTC
// (PeerJS public signaling, no own server) and BroadcastChannel (same browser).
// Overlays run the same wheel code and replay each spin locally.
const OVERLAY_SETTING_KEYS = [
  'modeSelect', 'eliminationSubMode', 'eliminationArrowCount',
  'eliminationFinalWinnersCount', 'winnersSubMode', 'winnersCountInput',
];
const overlaySid = Math.random().toString(36).slice(2);
const overlayConns = new Set();
const overlayDataUrls = new Map();
let overlaySeq = 0;
let overlayLastSeq = 0;
let overlayRemoteSid = null;
let overlayChannel = null;
let overlayQueued = false;
let overlayImagesSig = '';
let overlaySpinning = false;
let overlayPending = null;
let overlayScale = null;

function getOverlayRoom() {
  if (IS_OVERLAY) return OVERLAY_PARAMS.get('room') || '';
  let room = localStorage.getItem('htz_overlay_room');
  if (!room) {
    room = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => (b % 36).toString(36)).join('');
    localStorage.setItem('htz_overlay_room', room);
  }
  return room;
}

function sendOverlay(msg) {
  if (IS_OVERLAY) return;
  msg.sid = overlaySid;
  msg.seq = ++overlaySeq;
  overlayConns.forEach((c) => { if (c.open) c.send(msg); });
  if (overlayChannel) overlayChannel.postMessage(msg);
}

function toDataUrl(blobUrl) {
  if (!blobUrl || !blobUrl.startsWith('blob:')) return blobUrl;
  if (overlayDataUrls.has(blobUrl)) return overlayDataUrls.get(blobUrl);
  overlayDataUrls.set(blobUrl, null);
  fetch(blobUrl)
    .then((r) => r.blob())
    .then((b) => new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(b);
    }))
    .then((d) => {
      overlayDataUrls.set(blobUrl, d);
      queueOverlaySync();
    })
    .catch(() => {});
  return null;
}

function overlaySnapshot() {
  const settings = {};
  OVERLAY_SETTING_KEYS.forEach((k) => { settings[k] = els[k].value; });
  return {
    t: 'state',
    participants: state.participants,
    subNames: [...state.subNames],
    eliminatedLog: state.eliminatedLog,
    winnersLog: state.winnersLog,
    rotation: state.rotation,
    colorPalette: state.colorPalette,
    wheelFontScale: state.wheelFontScale,
    wheelScale: els.wheelScaleSlider.value,
    rouletteImageMode: state.rouletteImageMode,
    settings,
    winnerText: els.winnerText.textContent,
    modeStatus: els.modeStatus.textContent,
  };
}

function overlayImagesMessage() {
  const pool = state.themeImages.roulette;
  const idx = {};
  state.playerImageMap.forEach((url, name) => {
    const i = pool.indexOf(url);
    if (i >= 0) idx[name] = i;
  });
  return {
    t: 'images',
    list: pool.map(toDataUrl),
    idx,
    full: state.fullWheelImageUrl ? pool.indexOf(state.fullWheelImageUrl) : -1,
    profiles: [...state.profilePhotoMap],
  };
}

function queueOverlaySync() {
  if (IS_OVERLAY || overlayQueued) return;
  overlayQueued = true;
  // Microtask: runs right after the current logic, and isn't throttled in background tabs
  queueMicrotask(() => {
    overlayQueued = false;
    sendOverlay(overlaySnapshot());
    const img = overlayImagesMessage();
    const sig = JSON.stringify({ l: img.list.map((x) => (x ? x.length : 0)), i: img.idx, f: img.full, p: img.profiles });
    if (sig !== overlayImagesSig) {
      overlayImagesSig = sig;
      sendOverlay(img);
    }
  });
}

function updateOverlayStatus(err) {
  if (!els.overlayStatusText) return;
  els.overlayStatusText.textContent = err
    ? `Overlays: error (${err})`
    : t('overlayStatus', { n: overlayConns.size });
}

function fillOverlayLinks(room) {
  const base = `${location.origin}${location.pathname}`;
  [['overlayLinkWheel', 'wheel'], ['overlayLinkEliminated', 'eliminated'], ['overlayLinkParticipants', 'participants']]
    .forEach(([id, type]) => {
      document.getElementById(id).value = `${base}?overlay=${type}&room=${room}`;
    });
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const input = document.getElementById(btn.dataset.copy);
      input.select();
      try { await navigator.clipboard.writeText(input.value); } catch (err) { document.execCommand('copy'); }
    });
  });
}

function startOverlayHost() {
  const room = getOverlayRoom();
  fillOverlayLinks(room);

  try {
    overlayChannel = new BroadcastChannel(`htz-${room}`);
    overlayChannel.onmessage = (e) => {
      if (e.data && e.data.t === 'hello') { overlayImagesSig = ''; queueOverlaySync(); }
    };
  } catch (err) {
    overlayChannel = null;
  }

  const mo = new MutationObserver(() => queueOverlaySync());
  [els.winnerText, els.modeStatus].forEach((el) => mo.observe(el, { childList: true, characterData: true, subtree: true }));

  if (!window.Peer) { updateOverlayStatus('PeerJS no cargó'); return; }
  const open = () => {
    const peer = new Peer(`htzroulette-${room}`);
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        overlayConns.add(conn);
        updateOverlayStatus();
        overlayImagesSig = '';
        queueOverlaySync();
      });
      const drop = () => { overlayConns.delete(conn); updateOverlayStatus(); };
      conn.on('close', drop);
      conn.on('error', drop);
    });
    peer.on('open', () => updateOverlayStatus());
    peer.on('disconnected', () => peer.reconnect());
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // Old registration still lingering or another tab is open: retry shortly
        peer.destroy();
        updateOverlayStatus('ID en uso, reintentando');
        setTimeout(open, 4000);
      } else {
        updateOverlayStatus(err.type);
      }
    });
  };
  open();
}

function initOverlayMode() {
  document.body.classList.add('overlay-mode', `overlay-${OVERLAY_TYPE}`);
  document.title = `HtzRoulette overlay: ${OVERLAY_TYPE}`;
  const zoom = Number(OVERLAY_PARAMS.get('scale'));
  if (zoom > 0) document.body.style.zoom = zoom;

  const root = document.createElement('div');
  root.id = 'overlayRoot';

  // Lists get their own dedicated panel (title + list), sized to fit the list.
  if (OVERLAY_TYPE === 'wheel') {
    [els.wheelCanvas, els.winnerText, els.modeStatus].forEach((el) => root.appendChild(el));
  } else {
    const isParticipants = OVERLAY_TYPE === 'participants';
    const panel = document.createElement('div');
    panel.className = 'ov-panel';
    const title = document.createElement('div');
    title.className = 'ov-title';
    title.textContent = t(isParticipants ? 'participantsTitle' : 'eliminatedLog');
    const list = isParticipants ? els.participantList : els.eliminatedLogList;
    list.classList.add('ov-list');
    panel.append(title, list);
    root.appendChild(panel);
  }

  Array.from(document.body.children).forEach((c) => { if (c.tagName !== 'SCRIPT') c.style.display = 'none'; });
  document.body.appendChild(root);
}

function applyOverlayState(m, keepRotation) {
  state.participants = m.participants;
  state.subNames = new Set(m.subNames);
  state.eliminatedLog = m.eliminatedLog;
  state.winnersLog = m.winnersLog;
  if (!keepRotation) state.rotation = m.rotation;
  state.colorPalette = m.colorPalette;
  state.wheelFontScale = m.wheelFontScale;
  state.rouletteImageMode = m.rouletteImageMode;
  Object.entries(m.settings).forEach(([k, v]) => { els[k].value = v; });
  els.winnerText.textContent = m.winnerText;
  els.modeStatus.textContent = m.modeStatus;
  applyThemeAccent(m.colorPalette);
  if (m.wheelScale !== overlayScale) {
    overlayScale = m.wheelScale;
    applyWheelScale(m.wheelScale);
  }
  renderParticipants();
  renderLogs();
  drawWheel();
}

function applyOverlayImages(m) {
  state.playerImageMap = new Map(Object.entries(m.idx).map(([n, i]) => [n, m.list[i]]));
  state.fullWheelImageUrl = m.full >= 0 ? m.list[m.full] : null;
  state.profilePhotoMap = new Map(m.profiles);
  drawWheel();
}

function handleOverlayMessage(m) {
  if (!m || !m.t || m.t === 'hello') return;
  if (m.sid !== overlayRemoteSid) { overlayRemoteSid = m.sid; overlayLastSeq = 0; }
  if (m.seq <= overlayLastSeq) return; // same message arriving via both transports
  overlayLastSeq = m.seq;

  if (m.t === 'images') { applyOverlayImages(m); return; }

  if (m.t === 'spin') {
    if (overlaySpinning) return;
    overlaySpinning = true;
    els.winnerText.textContent = '';
    runSpinAnimation({
      startRotation: m.startRotation,
      targetRotation: m.targetRotation,
      duration: m.duration,
      sliceAngle: (Math.PI * 2) / Math.max(1, state.participants.length),
      onDone: () => {
        overlaySpinning = false;
        if (overlayPending) {
          const p = overlayPending;
          overlayPending = null;
          applyOverlayState(p, true);
        }
      },
    });
    return;
  }

  // State updates that arrive mid-spin wait until the wheel stops
  if (overlaySpinning) overlayPending = m;
  else applyOverlayState(m, false);
}

function startOverlayClient() {
  const room = getOverlayRoom();
  if (!room) return;
  try {
    const ch = new BroadcastChannel(`htz-${room}`);
    ch.onmessage = (e) => handleOverlayMessage(e.data);
    ch.postMessage({ t: 'hello' });
  } catch (err) { /* BroadcastChannel unavailable */ }

  if (!window.Peer) return;
  const peer = new Peer();
  let retry = null;
  const scheduleConnect = () => { clearTimeout(retry); retry = setTimeout(connect, 2000); };
  function connect() {
    if (peer.destroyed || peer.disconnected) { scheduleConnect(); return; }
    const conn = peer.connect(`htzroulette-${room}`, { reliable: true });
    conn.on('data', handleOverlayMessage);
    conn.on('close', scheduleConnect);
    conn.on('error', scheduleConnect);
  }
  peer.on('open', connect);
  peer.on('disconnected', () => peer.reconnect());
  peer.on('error', (err) => { if (err.type === 'peer-unavailable') scheduleConnect(); });
}

// --- Init ---
loadStrings().then(async () => {
  els.colorPaletteSelect.value = state.colorPalette;
  applyThemeAccent(state.colorPalette);
  if (IS_OVERLAY) {
    initOverlayMode();
  } else {
    loadTwitchCredentials();
    await refreshThemeSelect();
    await applySavedState();
    renderSavedLists();
  }
  renderParticipants();
  renderLogs();
  updateSettingsVisibility();
  drawWheel();
  if (IS_OVERLAY) startOverlayClient();
  else startOverlayHost();
});
