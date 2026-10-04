// Web app: runs entirely in the browser. Talks to Twitch chat directly over
// a WebSocket using Twitch's IRC protocol (no server/backend, no tmi.js
// dependency — its browser CDN bundle is unreliable). Themes/images are
// stored in this browser's IndexedDB (there's no filesystem to read from).

// Sub text customization (crown/icon, animated effects, font styles)
const SUB_EFFECT_KEYS = ['bounce', 'wave', 'blink', 'glitch', 'rainbow', 'gradient'];
const SUB_STYLE_KEYS = ['bold', 'italic', 'underline', 'strike', 'uppercase'];
const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1);

const state = {
  participants: [],
  spinning: false,
  animating: false,
  rotation: 0,
  eliminatedLog: [],
  winnersLog: [],
  autoTimer: null,
  colorPalette: 'red',
  // Sub text colors on the wheel; null = default (fill: white, stroke/glow: theme color)
  subColors: { fill: null, stroke: null, glow: null },
  subCrown: 'none', // 'none' | 'crown' (gold ♕) | 'icon' (channel sub badge image)
  subBadgeUrl: null,
  subEffects: { bounce: false, wave: false, blink: false, glitch: false, rainbow: false, gradient: false },
  subStyles: { bold: false, italic: false, underline: false, strike: false, uppercase: false },
  userShadow: { enabled: false, color: '#000000' },
  soundPack: 'original', // key of SOUND_PACKS
  recentOrder: [], // unique participant names in the order they joined (oldest first)
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
  resetLayoutBtn: document.getElementById('resetLayoutBtn'),
  timerBtn: document.getElementById('timerBtn'),
  timerWidget: document.getElementById('timerWidget'),
  timerHeader: document.getElementById('timerHeader'),
  timerCloseBtn: document.getElementById('timerCloseBtn'),
  timerIdle: document.getElementById('timerIdle'),
  timerPicker: document.getElementById('timerPicker'),
  timerRun: document.getElementById('timerRun'),
  timerCustomBtn: document.getElementById('timerCustomBtn'),
  timerPickerStart: document.getElementById('timerPickerStart'),
  timerPickerCancel: document.getElementById('timerPickerCancel'),
  timerDisplay: document.getElementById('timerDisplay'),
  timerProgressBar: document.getElementById('timerProgressBar'),
  timerStatus: document.getElementById('timerStatus'),
  timerPauseBtn: document.getElementById('timerPauseBtn'),
  timerRepeatBtn: document.getElementById('timerRepeatBtn'),
  timerCancelBtn: document.getElementById('timerCancelBtn'),
  timerShowCheckbox: document.getElementById('timerShowCheckbox'),
  timerAlarmCheckbox: document.getElementById('timerAlarmCheckbox'),
  timerAlarmTestBtn: document.getElementById('timerAlarmTestBtn'),
  timerActShuffle: document.getElementById('timerActShuffle'),
  timerActCloseJoin: document.getElementById('timerActCloseJoin'),
  timerActOpenJoin: document.getElementById('timerActOpenJoin'),
  timerActSpin: document.getElementById('timerActSpin'),
  overlayStatusText: document.getElementById('overlayStatusText'),
  cmdStatusText: document.getElementById('cmdStatusText'),
  cmdPrefixInput: document.getElementById('cmdPrefixInput'),
  modCmdEnabled: document.getElementById('modCmdEnabled'),
  modCmdAllowMods: document.getElementById('modCmdAllowMods'),
  modCmdWhitelist: document.getElementById('modCmdWhitelist'),
  savedListsContainer: document.getElementById('savedListsContainer'),
  subFillColor: document.getElementById('subFillColor'),
  subFillReset: document.getElementById('subFillReset'),
  subFillHint: document.getElementById('subFillHint'),
  subStrokeColor: document.getElementById('subStrokeColor'),
  subStrokeReset: document.getElementById('subStrokeReset'),
  subStrokeHint: document.getElementById('subStrokeHint'),
  subGlowColor: document.getElementById('subGlowColor'),
  subGlowReset: document.getElementById('subGlowReset'),
  subGlowHint: document.getElementById('subGlowHint'),
  subCrownSelect: document.getElementById('subCrownSelect'),
  subBadgeFile: document.getElementById('subBadgeFile'),
  subBadgeTwitchBtn: document.getElementById('subBadgeTwitchBtn'),
  subBadgeClearBtn: document.getElementById('subBadgeClearBtn'),
  subBadgePreview: document.getElementById('subBadgePreview'),
  subBadgeStatus: document.getElementById('subBadgeStatus'),
  userShadowCheckbox: document.getElementById('userShadowCheckbox'),
  userShadowColor: document.getElementById('userShadowColor'),
  soundPackSelect: document.getElementById('soundPackSelect'),
  soundPreviewTick: document.getElementById('soundPreviewTick'),
  soundPreviewSelect: document.getElementById('soundPreviewSelect'),
  soundPreviewFinal: document.getElementById('soundPreviewFinal'),
};
SUB_EFFECT_KEYS.forEach((k) => {
  els[`subFx${capitalize(k)}`] = document.getElementById(`subFx${capitalize(k)}`);
});
SUB_STYLE_KEYS.forEach((k) => {
  els[`subStyle${capitalize(k)}`] = document.getElementById(`subStyle${capitalize(k)}`);
});

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
  refreshLayoutMetrics();
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

function createSubBadgeElement() {
  if (state.subCrown === 'none') return null;
  if (state.subCrown === 'icon' && state.subBadgeUrl) {
    const img = document.createElement('img');
    img.className = 'sub-badge-img';
    img.src = state.subBadgeUrl;
    img.alt = '';
    return img;
  }
  const crown = document.createElement('span');
  crown.className = 'sub-crown';
  crown.textContent = '\u2655';
  return crown;
}

// Keeps recentOrder in step with state.participants: names that left are dropped
// and names that are new are appended (newest last). The list shows it reversed,
// so the most recent participant is always on top, whatever order the wheel has
// (e.g. after shuffling).
function syncRecentOrder() {
  const present = new Set(state.participants);
  const seen = new Set();
  const order = [];
  state.recentOrder.forEach((name) => {
    if (present.has(name) && !seen.has(name)) {
      seen.add(name);
      order.push(name);
    }
  });
  state.participants.forEach((name) => {
    if (!seen.has(name)) {
      seen.add(name);
      order.push(name);
    }
  });
  state.recentOrder = order;
}

function renderParticipants() {
  syncRecentOrder();
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

  [...state.recentOrder].reverse().forEach((name) => {
    const count = counts.get(name);
    const li = document.createElement('li');

    const nameWrap = document.createElement('span');
    nameWrap.className = 'name-wrap';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = truncateName(name);
    nameSpan.title = name;
    if (state.subNames.has(name)) {
      nameSpan.classList.add('sub-name');
      const subBadge = createSubBadgeElement();
      if (subBadge) nameWrap.appendChild(subBadge);
    }
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

    const isSub = state.subNames.has(name);
    const subBtn = document.createElement('button');
    subBtn.className = `sub-btn${isSub ? ' active' : ''}`;
    subBtn.textContent = '\u2655';
    subBtn.title = t(isSub ? 'removeSubTitle' : 'makeSubTitle');
    subBtn.addEventListener('click', () => toggleSubByName(name));
    actions.appendChild(subBtn);

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

// Marks/unmarks a participant as sub (applies to all of their slots on the wheel)
function toggleSubByName(name) {
  if (state.subNames.has(name)) state.subNames.delete(name);
  else state.subNames.add(name);
  renderParticipants();
  drawWheel();
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
  requestParticipantsRender();
}

// Joins can arrive in bursts (hundreds of chatters typing !join at once) and each
// full list + wheel rebuild gets slower as the crowd grows. The first join renders
// right away; the ones that follow within PARTICIPANTS_FLUSH_MS are batched into a
// single render, so a burst costs a handful of rebuilds instead of one per join.
const PARTICIPANTS_FLUSH_MS = 80;
let participantsFlushTimer = null;
let participantsFlushDirty = false;

function requestParticipantsRender() {
  if (participantsFlushTimer !== null) {
    participantsFlushDirty = true;
    return;
  }
  renderParticipants();
  drawWheel();
  participantsFlushTimer = bgTimers.timeout(() => {
    participantsFlushTimer = null;
    if (participantsFlushDirty) {
      participantsFlushDirty = false;
      requestParticipantsRender();
    }
  }, PARTICIPANTS_FLUSH_MS);
}

// Renders any batched joins right now
function flushParticipantsRender() {
  if (participantsFlushTimer !== null) {
    bgTimers.clear(participantsFlushTimer);
    participantsFlushTimer = null;
  }
  if (participantsFlushDirty) {
    participantsFlushDirty = false;
    renderParticipants();
    drawWheel();
  }
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
  subStyleKeyCached = null; // colors/styles may have changed since the last frame
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
  updateEffectsLoop();
}

// Normal users' wheel text: white, with an optional drop shadow.
// (Canvas shadow offsets are in screen space, so the "light" stays fixed while the wheel spins.)
function drawUserText(text, x, y, fontSize) {
  ctx.fillStyle = '#fff';
  if (!state.userShadow.enabled) {
    ctx.fillText(text, x, y);
    return;
  }
  const offset = Math.max(1.5, fontSize * 0.1);
  if (state.participants.length > 80) {
    // Crowded wheel: a blurred shadow per name is too slow, so draw a plain dark copy
    // shifted in screen space (the offset is rotated into the text's own frame).
    const m = ctx.getTransform();
    const det = m.a * m.d - m.b * m.c || 1;
    const lx = (m.d * offset - m.c * offset) / det;
    const ly = (-m.b * offset + m.a * offset) / det;
    ctx.fillStyle = state.userShadow.color;
    ctx.fillText(text, x + lx, y + ly);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x, y);
    return;
  }
  ctx.save();
  ctx.shadowColor = state.userShadow.color;
  ctx.shadowBlur = Math.max(3, fontSize * 0.25);
  ctx.shadowOffsetX = offset;
  ctx.shadowOffsetY = offset;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// The glow of sub names would otherwise spill past the edge of the wheel
function clipToWheelDisc(radius) {
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.clip();
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixRgb(a, b, amount) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * amount));
}

// Animated-gradient color built from the theme's own color: p in 0..1 goes
// from a light tint of the theme color to white. It never goes darker than the
// tint, so the fill always contrasts with the theme-colored outline and glow.
function themeGradientColor(p) {
  const base = hexToRgb(getSubNeonColor());
  const rgb = mixRgb(base, [255, 255, 255], 0.3 + 0.7 * p);
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function pseudoRandom(n) {
  const v = Math.sin(n * 127.1) * 43758.5453;
  return v - Math.floor(v);
}

function subFontString(fontSize) {
  const st = state.subStyles;
  return `${st.italic ? 'italic ' : ''}${st.bold ? 'bold ' : ''}${fontSize}px Segoe UI`;
}

const NO_EFFECTS = { bounce: false, wave: false, blink: false, glitch: false, rainbow: false, gradient: false };

// Measures a sub's name and badge (gold crown or channel sub icon) with context g
function layoutSubText(g, name, fontSize) {
  const text = state.subStyles.uppercase ? name.toUpperCase() : name;
  g.font = subFontString(fontSize);
  let badge = null;
  if (state.subCrown === 'crown') {
    badge = { kind: 'crown' };
  } else if (state.subCrown === 'icon') {
    const img = getLoadedImage(state.subBadgeUrl);
    if (img) badge = { kind: 'image', img };
    else if (!state.subBadgeUrl) badge = { kind: 'crown' }; // no icon configured: fall back to the crown
  }
  const crownFont = `${Math.round(fontSize * 1.15)}px Segoe UI`;
  let badgeSize = 0;
  if (badge && badge.kind === 'image') {
    badgeSize = fontSize * 1.15;
  } else if (badge) {
    g.font = crownFont;
    badgeSize = g.measureText('\u2655').width;
    g.font = subFontString(fontSize);
  }
  const badgeW = badge ? badgeSize + fontSize * 0.25 : 0;
  return { text, badge, badgeSize, badgeW, crownFont, textW: g.measureText(text).width };
}

// Draws a sub's name on context g: optional badge, then the name with an outline +
// glow + fill (each with its own color), font styles and animated effects.
// `slot` is the wheel position, used so the effects are not all in sync.
// opts.staticOnly ignores the animated effects (used to build cached sprites);
// opts.lite uses a cheaper glow (one pass, smaller blur) for crowded wheels.
function renderSubText(g, name, x, y, fontSize, slot, opts = {}) {
  const fx = opts.staticOnly ? NO_EFFECTS : state.subEffects;
  const st = state.subStyles;
  const time = performance.now() / 1000;
  const phase = slot * 0.9;

  g.save();
  g.textAlign = 'left';
  g.lineJoin = 'round';
  g.miterLimit = 2;

  const { text, badge, badgeSize, badgeW, crownFont, textW } = layoutSubText(g, name, fontSize);
  const startX = x - badgeW - textW;
  const textX = startX + badgeW;

  const chars = [...text];
  const perChar = fx.wave || fx.rainbow || fx.gradient;
  const charX = perChar ? chars.map((_, i) => g.measureText(chars.slice(0, i).join('')).width) : null;
  const waveY = (i) => (fx.wave ? Math.sin(time * 4 + i * 0.7 + phase) * fontSize * 0.2 : 0);
  const rainbow = (i) => `hsl(${Math.floor((time * 140 + i * 35 + phase * 40) % 360)}, 100%, 60%)`;
  // Gradient: a band of light flowing through the letters, in the theme's color
  const gradient = (i) => themeGradientColor(0.5 + 0.5 * Math.sin(time * 2.4 - i * 0.55 + phase));
  const fillColor = (i) => {
    if (fx.rainbow) return rainbow(i); // rainbow wins if both are on
    if (fx.gradient) return gradient(i);
    return getSubFillColor();
  };

  const baseY = y + (fx.bounce ? -Math.abs(Math.sin(time * 5 + phase)) * fontSize * 0.4 : 0);
  g.globalAlpha = fx.blink && Math.sin(time * 6 + phase) <= -0.2 ? 0.15 : 1;

  const strokeText = (ox, oy) => {
    if (!perChar) g.strokeText(text, textX + ox, baseY + oy);
    else chars.forEach((ch, i) => g.strokeText(ch, textX + ox + charX[i], baseY + oy + waveY(i)));
  };
  const fillText = (ox, oy, colorAt) => {
    if (!perChar) {
      g.fillStyle = colorAt(0);
      g.fillText(text, textX + ox, baseY + oy);
    } else {
      chars.forEach((ch, i) => {
        g.fillStyle = colorAt(i);
        g.fillText(ch, textX + ox + charX[i], baseY + oy + waveY(i));
      });
    }
  };

  // Glitch: short bursts with cyan/magenta ghost copies and a small jitter
  const glitching = fx.glitch && (time * 1000 + slot * 350) % 1700 < 220;
  let mx = 0;
  let my = 0;
  let ghostDx = 0;
  if (glitching) {
    const seed = Math.floor(time * 30) + slot * 17;
    const gx = (pseudoRandom(seed) - 0.5) * fontSize * 0.5;
    const gy = (pseudoRandom(seed + 1) - 0.5) * fontSize * 0.15;
    ghostDx = fontSize * 0.12 + Math.abs(gx) * 0.6;
    mx = gx * 0.3;
    my = gy;
  }

  // Outline + glow (blurred shadows are the expensive part of this whole function)
  g.lineWidth = Math.max(3, fontSize * 0.2);
  g.strokeStyle = getSubStrokeColor();
  g.shadowColor = getSubGlowColor();
  g.shadowBlur = opts.lite ? Math.max(6, fontSize * 0.35) : Math.max(10, fontSize * 0.6);
  strokeText(mx, my);
  if (!opts.lite) strokeText(mx, my); // second pass makes the glow stronger

  g.shadowBlur = 0;
  g.shadowColor = 'transparent';

  // Glitch ghosts: cyan/magenta copies shifted sideways, between outline and fill
  if (glitching) {
    fillText(mx - ghostDx, my, () => '#00ffff');
    fillText(mx + ghostDx, my - 1, () => '#ff00ff');
  }

  // Fill
  fillText(mx, my, fillColor);

  // Underline / strikethrough
  if (st.underline || st.strike) {
    g.fillStyle = fillColor(0);
    g.shadowColor = getSubGlowColor();
    g.shadowBlur = fontSize * 0.3;
    const thick = Math.max(1.5, fontSize * 0.08);
    if (st.underline) g.fillRect(textX + mx, baseY + my + fontSize * 0.16, textW, thick);
    if (st.strike) g.fillRect(textX + mx, baseY + my - fontSize * 0.3, textW, thick);
    g.shadowBlur = 0;
    g.shadowColor = 'transparent';
  }

  // Badge
  if (badge) {
    const bx = startX + mx;
    const by = baseY + my + waveY(0);
    if (badge.kind === 'crown') {
      g.font = crownFont;
      g.lineWidth = Math.max(2, fontSize * 0.14);
      g.strokeStyle = getSubStrokeColor();
      g.shadowColor = '#ffd700';
      g.shadowBlur = fontSize * 0.35;
      g.strokeText('\u2655', bx, by);
      g.shadowBlur = 0;
      g.shadowColor = 'transparent';
      g.fillStyle = '#ffd700';
      g.fillText('\u2655', bx, by);
    } else {
      g.shadowColor = getSubGlowColor();
      g.shadowBlur = fontSize * 0.3;
      g.drawImage(badge.img, bx, by - fontSize * 0.3 - badgeSize / 2, badgeSize, badgeSize);
    }
  }
  g.restore();
}

// Performance with big crowds: re-rendering every sub's blurred glow on every
// frame is what makes a crowded wheel lag. When there are many participants and
// no per-letter animation, each name is rendered once into a small sprite and then
// just blitted every frame. (1x on purpose: drawing a 2x sprite scaled down was
// measured to be about 5x slower than blitting a 1x one.)
const SUB_SPRITE_SCALE = 1;
const SUB_SPRITE_MIN_PARTICIPANTS = 60;
// Sprites are only used while every sub fits in the cache: with more subs than
// this they would be evicted and rebuilt on every frame, which is slower than drawing directly.
const SUB_SPRITE_MAX = 1500;
const subSprites = new Map();
let subMeasureCtx = null;
let subStyleKeyCached = null; // same for every sub in a frame, so it is built once per drawWheel

function computeSubStyleKey() {
  const st = state.subStyles;
  return [
    st.bold, st.italic, st.underline, st.strike, st.uppercase,
    getSubFillColor(), getSubStrokeColor(), getSubGlowColor(),
    state.subCrown, state.subCrown === 'icon' ? state.subBadgeUrl : '',
  ].join('|');
}

function getSubSprite(name, fontSize) {
  // An icon that is still loading must not be cached as "no badge"
  if (state.subCrown === 'icon' && state.subBadgeUrl && !getLoadedImage(state.subBadgeUrl)) return null;
  if (subStyleKeyCached === null) subStyleKeyCached = computeSubStyleKey();
  const key = `${name}|${fontSize}|${subStyleKeyCached}`;
  let sprite = subSprites.get(key);
  if (sprite) return sprite;

  if (!subMeasureCtx) subMeasureCtx = document.createElement('canvas').getContext('2d');
  const layout = layoutSubText(subMeasureCtx, name, fontSize);
  const pad = Math.ceil(Math.max(10, fontSize * 0.6) * 1.7 + Math.max(3, fontSize * 0.2));
  const ascent = Math.ceil(fontSize * 1.05);
  const width = Math.ceil(layout.badgeW + layout.textW + pad * 2);
  const height = ascent + Math.ceil(fontSize * 0.4) + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * SUB_SPRITE_SCALE;
  canvas.height = height * SUB_SPRITE_SCALE;
  const g = canvas.getContext('2d');
  g.scale(SUB_SPRITE_SCALE, SUB_SPRITE_SCALE);
  const anchorX = width - pad; // where the right end of the name goes
  const anchorY = pad + ascent; // baseline
  renderSubText(g, name, anchorX, anchorY, fontSize, 0, { staticOnly: true });
  sprite = { canvas, width, height, anchorX, anchorY };
  if (subSprites.size >= SUB_SPRITE_MAX) subSprites.clear();
  subSprites.set(key, sprite);
  return sprite;
}

function drawSubText(name, x, y, fontSize, slot) {
  const fx = state.subEffects;
  const perLetterEffect = fx.wave || fx.rainbow || fx.gradient || fx.glitch;
  const crowded = state.participants.length >= SUB_SPRITE_MIN_PARTICIPANTS;
  if (crowded && !perLetterEffect && state.subNames.size <= SUB_SPRITE_MAX) {
    const sprite = getSubSprite(name, fontSize);
    if (sprite) {
      // Jump and blink don't change the shape, so they are just a shift/alpha on the sprite
      const time = performance.now() / 1000;
      const phase = slot * 0.9;
      const dy = fx.bounce ? -Math.abs(Math.sin(time * 5 + phase)) * fontSize * 0.4 : 0;
      const dim = fx.blink && Math.sin(time * 6 + phase) <= -0.2;
      if (dim) {
        ctx.save();
        ctx.globalAlpha = 0.15;
      }
      ctx.drawImage(sprite.canvas, x - sprite.anchorX, y + dy - sprite.anchorY, sprite.width, sprite.height);
      if (dim) ctx.restore();
      return;
    }
  }
  renderSubText(ctx, name, x, y, fontSize, slot, { lite: crowded });
}

// Redraw the wheel continuously while a sub effect is on (the spin loop already
// redraws every frame while spinning). Throttled to save CPU.
let effectsRaf = null;
let lastEffectDraw = 0;
let effectsInterval = 33;

function subEffectsActive() {
  return SUB_EFFECT_KEYS.some((k) => state.subEffects[k])
    && state.participants.some((n) => state.subNames.has(n));
}

function effectsTick(now) {
  effectsRaf = null;
  if (!subEffectsActive()) return;
  if (!state.animating && now - lastEffectDraw >= effectsInterval) {
    lastEffectDraw = now;
    const started = performance.now();
    drawWheel();
    // Never spend more than about a third of the time drawing: a heavy wheel just animates at a lower frame rate
    effectsInterval = Math.max(state.participants.length > 40 ? 50 : 33, (performance.now() - started) * 3);
  }
  if (effectsRaf === null) effectsRaf = requestAnimationFrame(effectsTick);
}

function updateEffectsLoop() {
  if (effectsRaf === null && subEffectsActive()) effectsRaf = requestAnimationFrame(effectsTick);
}

function drawColorSlices(cx, cy, radius, count, names) {
  const sliceAngle = (Math.PI * 2) / count;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(state.rotation);

  for (let i = 0; i < count; i += 1) {
    const start = i * sliceAngle;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, start + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = getSliceColor(i, count);
    ctx.fill();
  }

  // Names in a second pass: a sub's glow is no longer painted over by the next
  // slice, and a single clip to the wheel's disc serves every name.
  ctx.save();
  clipToWheelDisc(radius);
  const fontSize = Math.round(21 * state.wheelFontScale);
  ctx.font = `${fontSize}px Segoe UI`;
  ctx.textAlign = 'right';
  for (let i = 0; i < count; i += 1) {
    if (!names[i]) continue;
    ctx.save();
    ctx.rotate(i * sliceAngle + sliceAngle / 2);
    if (state.subNames.has(names[i])) drawSubText(names[i], radius - 10, 4, fontSize, i);
    else drawUserText(names[i], radius - 10, 4, fontSize);
    ctx.restore();
  }
  ctx.restore();
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
      clipToWheelDisc(radius);
      drawSubText(name, radius - 8, radius * 0.25, fontSize, i);
    } else {
      drawUserText(name, radius - 8, radius * 0.25, fontSize);
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
function runSpinAnimation({ startRotation, targetRotation, duration, sliceAngle, endKind, onDone }) {
  const startTime = performance.now();
  let lastStep = 0;
  let finished = false;
  let watchdog = null;

  scheduleSpinSounds({ startRotation, targetRotation, duration, sliceAngle, endKind });
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
// What the end of this spin means, so the right sound can be scheduled up front:
// 'final' = a final winner is chosen, 'select' = someone is picked but the game goes on.
// (Mirrors the decisions in onSpinComplete.)
function predictSpinEndKind(selection, settings) {
  const { indices, names } = selection;
  if (settings.mode === 'normal') return 'final';
  const gone = new Set(indices);
  const remaining = new Set(state.participants.filter((_, i) => !gone.has(i)));
  if (settings.mode === 'elimination') {
    return remaining.size <= settings.eliminationFinalWinnersCount ? 'final' : 'select';
  }
  if (settings.winnersSubMode === 'simultaneous') return 'final';
  const won = state.winnersLog.length + (state.winnersLog.includes(names[0]) ? 0 : 1);
  return won >= settings.winnersCount || remaining.size === 0 ? 'final' : 'select';
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
  const endKind = predictSpinEndKind(getSelectionForRotation(targetRotation, pointerCount), settings);
  sendOverlay({ t: 'spin', startRotation, targetRotation, duration, endKind });
  runSpinAnimation({
    startRotation,
    targetRotation,
    duration,
    sliceAngle,
    endKind,
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

const SUB_NEON_COLORS = {
  red: '#ff3b3b',
  blue: '#3bb0ff',
  green: '#39ff6a',
  purple: '#c23bff',
  gray: '#e8e8e8',
  rainbow: '#ffd700',
};
const SUB_FILL_DEFAULT = '#ffffff';
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function getSubNeonColor() {
  return SUB_NEON_COLORS[state.colorPalette] || SUB_NEON_COLORS.red;
}
function getSubFillColor() {
  return state.subColors.fill || SUB_FILL_DEFAULT;
}
function getSubStrokeColor() {
  return state.subColors.stroke || getSubNeonColor();
}
function getSubGlowColor() {
  return state.subColors.glow || getSubNeonColor();
}

// Color pickers show the effective color; outline/glow are marked while they follow the theme
const SUB_COLOR_FIELDS = [
  { key: 'fill', input: 'subFillColor', reset: 'subFillReset', hint: 'subFillHint' },
  { key: 'stroke', input: 'subStrokeColor', reset: 'subStrokeReset', hint: 'subStrokeHint' },
  { key: 'glow', input: 'subGlowColor', reset: 'subGlowReset', hint: 'subGlowHint' },
];

function refreshSubColorInputs() {
  const effective = { fill: getSubFillColor(), stroke: getSubStrokeColor(), glow: getSubGlowColor() };
  SUB_COLOR_FIELDS.forEach(({ key, input, hint }) => {
    els[input].value = effective[key];
    els[hint].textContent = key !== 'fill' && !state.subColors[key] ? t('followsTheme') : '';
  });
}

SUB_COLOR_FIELDS.forEach(({ key, input, reset }) => {
  els[input].addEventListener('input', () => {
    state.subColors[key] = els[input].value;
    refreshSubColorInputs();
    drawWheel();
    saveState();
  });
  els[reset].addEventListener('click', () => {
    state.subColors[key] = null;
    refreshSubColorInputs();
    drawWheel();
    saveState();
  });
});

// --- Sub text look: crown/icon, effects, styles + normal-user shadow (Texto tab) ---
const TWITCH_BADGES_URL = 'https://api.twitch.tv/helix/chat/badges';

function getSubTextSettings() {
  return {
    crown: state.subCrown,
    badgeUrl: state.subBadgeUrl,
    effects: { ...state.subEffects },
    styles: { ...state.subStyles },
    userShadow: { ...state.userShadow },
  };
}

function applySubStyleClasses() {
  SUB_STYLE_KEYS.forEach((k) => document.body.classList.toggle(`sub-${k}`, !!state.subStyles[k]));
}

function updateBadgePreview() {
  const has = !!state.subBadgeUrl;
  els.subBadgePreview.style.display = has ? 'inline-block' : 'none';
  els.subBadgeClearBtn.style.display = has ? '' : 'none';
  if (has && els.subBadgePreview.getAttribute('src') !== state.subBadgeUrl) {
    els.subBadgePreview.src = state.subBadgeUrl;
  }
}

function syncSubTextUi() {
  els.subCrownSelect.value = state.subCrown;
  SUB_EFFECT_KEYS.forEach((k) => { els[`subFx${capitalize(k)}`].checked = !!state.subEffects[k]; });
  SUB_STYLE_KEYS.forEach((k) => { els[`subStyle${capitalize(k)}`].checked = !!state.subStyles[k]; });
  els.userShadowCheckbox.checked = state.userShadow.enabled;
  els.userShadowColor.value = state.userShadow.color;
  updateBadgePreview();
}

function applySubTextSettings(o) {
  if (!o) return;
  state.subCrown = ['none', 'crown', 'icon'].includes(o.crown) ? o.crown : 'none';
  state.subBadgeUrl = typeof o.badgeUrl === 'string' && /^(data:image\/|https:\/\/)/.test(o.badgeUrl) ? o.badgeUrl : null;
  SUB_EFFECT_KEYS.forEach((k) => { state.subEffects[k] = !!(o.effects && o.effects[k]); });
  SUB_STYLE_KEYS.forEach((k) => { state.subStyles[k] = !!(o.styles && o.styles[k]); });
  const shadow = o.userShadow || {};
  state.userShadow = {
    enabled: !!shadow.enabled,
    color: typeof shadow.color === 'string' && HEX_COLOR_RE.test(shadow.color) ? shadow.color : '#000000',
  };
  syncSubTextUi();
  applySubStyleClasses();
}

function onSubTextChanged() {
  applySubStyleClasses();
  renderParticipants(); // rebuilds the list (crown/styles) and saves
  drawWheel();
}

function setBadgeStatus(key, params) {
  els.subBadgeStatus.textContent = key ? t(key, params) : '';
}

function setSubBadgeUrl(url) {
  state.subBadgeUrl = url;
  if (url) state.subCrown = 'icon'; // an icon was configured: use it
  syncSubTextUi();
  onSubTextChanged();
}

function fileToBadgeDataUrl(file, size = 72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        canvas.getContext('2d').drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

els.subCrownSelect.addEventListener('change', () => {
  state.subCrown = els.subCrownSelect.value;
  onSubTextChanged();
});

SUB_EFFECT_KEYS.forEach((k) => {
  els[`subFx${capitalize(k)}`].addEventListener('change', () => {
    state.subEffects[k] = els[`subFx${capitalize(k)}`].checked;
    onSubTextChanged();
  });
});

SUB_STYLE_KEYS.forEach((k) => {
  els[`subStyle${capitalize(k)}`].addEventListener('change', () => {
    state.subStyles[k] = els[`subStyle${capitalize(k)}`].checked;
    onSubTextChanged();
  });
});

els.userShadowCheckbox.addEventListener('change', () => {
  state.userShadow.enabled = els.userShadowCheckbox.checked;
  onSubTextChanged();
});
els.userShadowColor.addEventListener('input', () => {
  state.userShadow.color = els.userShadowColor.value;
  onSubTextChanged();
});

els.subBadgeFile.addEventListener('change', async () => {
  const file = els.subBadgeFile.files[0];
  if (!file) return;
  try {
    setSubBadgeUrl(await fileToBadgeDataUrl(file));
    setBadgeStatus('badgeLoaded');
  } catch (err) {
    setBadgeStatus('badgeError');
  }
  els.subBadgeFile.value = '';
});

els.subBadgeClearBtn.addEventListener('click', () => {
  setSubBadgeUrl(null);
  setBadgeStatus('');
});

// Channel sub badge from Twitch (Helix chat/badges), using the channel typed in
// the header and the Client ID/Secret from the Temas tab.
els.subBadgeTwitchBtn.addEventListener('click', async () => {
  const channel = els.channelInput.value.trim().replace(/^#/, '').toLowerCase();
  const clientId = els.twitchClientId.value.trim();
  const clientSecret = els.twitchClientSecret.value.trim();
  if (!channel) { setBadgeStatus('badgeNoChannel'); return; }
  if (!clientId || !clientSecret) { setBadgeStatus('badgeNoCreds'); return; }
  setBadgeStatus('badgeLoading');
  try {
    const token = await getTwitchAppToken(clientId, clientSecret);
    const headers = { 'Client-Id': clientId, Authorization: `Bearer ${token}` };
    const userRes = await fetch(`${TWITCH_USERS_URL}?login=${encodeURIComponent(channel)}`, { headers });
    if (!userRes.ok) throw new Error('twitch-users-request-failed');
    const user = ((await userRes.json()).data || [])[0];
    if (!user) { setBadgeStatus('badgeChannelNotFound'); return; }
    const badgeRes = await fetch(`${TWITCH_BADGES_URL}?broadcaster_id=${encodeURIComponent(user.id)}`, { headers });
    if (!badgeRes.ok) throw new Error('twitch-badges-request-failed');
    const set = ((await badgeRes.json()).data || []).find((b) => b.set_id === 'subscriber');
    const version = set && ((set.versions || []).find((v) => v.id === '0') || (set.versions || [])[0]);
    const url = version && (version.image_url_2x || version.image_url_1x);
    if (!url) { setBadgeStatus('badgeNoneFound'); return; }
    setSubBadgeUrl(url);
    setBadgeStatus('badgeLoaded');
  } catch (err) {
    console.error('Twitch sub badge fetch failed:', err);
    setBadgeStatus('badgeError');
  }
});

function applyThemeAccent(palette) {
  const [accent, hover] = THEME_ACCENT_COLORS[palette] || THEME_ACCENT_COLORS.red;
  document.documentElement.style.setProperty('--theme-accent', accent);
  document.documentElement.style.setProperty('--theme-accent-hover', hover);
  refreshSubColorInputs();
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

// --- Sound effects (sound packs) ---
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

// Sound packs. 'original' is synthesized (a tick while spinning, one sound when it
// lands). 'minecraft' uses samples: click = each wheel tick, orb = someone is
// selected but the game goes on, levelup = a final winner is chosen.
const SOUND_PACKS = {
  original: null,
  minecraft: {
    click: { url: 'sounds/minecraft/click.ogg', gain: 0.5 },
    orb: { url: 'sounds/minecraft/orb.ogg', gain: 0.6 },
    levelup: { url: 'sounds/minecraft/levelup.ogg', gain: 0.6 },
  },
};
// Which sample plays for each kind of sound
const SOUND_SAMPLE_FOR = { tick: 'click', select: 'orb', final: 'levelup' };
const soundBuffers = {}; // pack -> { sampleName: AudioBuffer }
const soundLoads = {}; // pack -> Promise

// Decoding with an OfflineAudioContext needs no user gesture, and the
// resulting buffers can be played by any AudioContext.
function decodeSample(arrayBuffer) {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const decoder = new Offline(1, 1, 44100);
  return new Promise((resolve, reject) => {
    const maybePromise = decoder.decodeAudioData(arrayBuffer, resolve, reject);
    if (maybePromise && typeof maybePromise.catch === 'function') maybePromise.catch(() => {});
  });
}

function loadSoundPack(pack) {
  const samples = SOUND_PACKS[pack];
  if (!samples) return Promise.resolve();
  if (soundLoads[pack]) return soundLoads[pack];
  soundBuffers[pack] = {};
  soundLoads[pack] = Promise.all(Object.entries(samples).map(async ([name, { url }]) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      soundBuffers[pack][name] = await decodeSample(await res.arrayBuffer());
    } catch (err) {
      // Falls back to the original synthesized sound for this one
      console.warn(`Sound "${name}" of pack "${pack}" could not be loaded`, err);
    }
  }));
  return soundLoads[pack];
}

function getPackSample(name) {
  const samples = SOUND_PACKS[state.soundPack];
  const buffer = samples && soundBuffers[state.soundPack] && soundBuffers[state.soundPack][name];
  return buffer ? { buffer, gain: samples[name].gain } : null;
}

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

// kind: 'tick' | 'select' | 'final'. Uses the current pack's sample, or the
// original synthesized sound when the pack has none for it (or it isn't loaded).
function scheduleSound(ctx, kind, when, gainScale = 1) {
  const sample = getPackSample(SOUND_SAMPLE_FOR[kind]);
  if (sample) {
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = sample.buffer;
    gain.gain.value = sample.gain * gainScale;
    src.connect(gain).connect(ctx.destination);
    src.start(when);
    return;
  }
  if (kind === 'tick') scheduleTick(ctx, when);
  else scheduleLanding(ctx, when);
}

// The spin is fully deterministic (same easing/duration as the animation), so
// every tick and the end sound are computed up front and scheduled on the
// audio clock. The audio thread plays them on time regardless of whether the
// tab is in the background or the main thread is throttled.
function scheduleSpinSounds({ startRotation, targetRotation, duration, sliceAngle, endKind }) {
  if (IS_OVERLAY && !OVERLAY_SOUND) return;
  let ctx;
  try {
    ctx = getAudioCtx();
  } catch (err) {
    return;
  }
  loadSoundPack(state.soundPack); // no-op when already loaded
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
      tickTimesMs.forEach((ms, i) => {
        if (ms < elapsedMs) return;
        // Sampled clicks pile up when the wheel is fast, so quiet them down when ticks are dense
        const gapMs = i === 0 ? Infinity : ms - tickTimesMs[i - 1];
        const density = Math.min(1, Math.max(0.35, gapMs / 80));
        scheduleSound(ctx, 'tick', spinStartOnAudioClock + ms / 1000, density);
      });
      if (duration >= elapsedMs) {
        scheduleSound(ctx, endKind === 'final' ? 'final' : 'select', spinStartOnAudioClock + duration / 1000);
      }
    } catch (err) {
      // Audio may be unavailable/blocked; fail silently
    }
  };

  if (ctx.state === 'running') schedule();
  else ctx.resume().then(schedule).catch(() => {});
}

// Plays one sound of the current pack (used by the preview buttons)
function previewSound(kind) {
  try {
    const ctx = getAudioCtx();
    scheduleSound(ctx, kind, ctx.currentTime + 0.02);
  } catch (err) {
    // Audio unavailable
  }
}

els.soundPackSelect.addEventListener('change', () => {
  state.soundPack = SOUND_PACKS[els.soundPackSelect.value] !== undefined ? els.soundPackSelect.value : 'original';
  loadSoundPack(state.soundPack);
  saveState();
});
els.soundPreviewTick.addEventListener('click', () => previewSound('tick'));
els.soundPreviewSelect.addEventListener('click', () => previewSound('select'));
els.soundPreviewFinal.addEventListener('click', () => previewSound('final'));

// --- Persist settings + participants across page reloads ---
const SAVED_STATE_KEY = 'htz_saved_state';

function saveState() {
  if (IS_OVERLAY) return;
  queueOverlaySync();
  try {
    const data = {
      participants: state.participants,
      recentOrder: state.recentOrder,
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
      subColors: state.subColors,
      subText: getSubTextSettings(),
      soundPack: state.soundPack,
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
  state.recentOrder = Array.isArray(data.recentOrder) ? data.recentOrder.filter((n) => typeof n === 'string') : [];
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
  if (data.subColors) {
    ['fill', 'stroke', 'glow'].forEach((k) => {
      const v = data.subColors[k];
      state.subColors[k] = typeof v === 'string' && HEX_COLOR_RE.test(v) ? v : null;
    });
    refreshSubColorInputs();
  }
  if (data.subText) applySubTextSettings(data.subText);
  if (typeof data.soundPack === 'string' && data.soundPack in SOUND_PACKS) {
    state.soundPack = data.soundPack;
    els.soundPackSelect.value = data.soundPack;
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
// --- Movable boxes (debug mode) ---
// Every box can be dragged on its own. Positions snap to a grid so nothing ends
// up misaligned, and they are saved in localStorage. Moving a box for the first
// time switches the page from the flow layout to a free layout (each box gets
// absolute left/top); "Restablecer disposición" goes back to the original one.
const LAYOUT_KEY = 'htz_layout';
const LAYOUT_GRID = 20;
const LAYOUT_BOXES = [
  { id: 'wheel', selector: '#wheelBox', labelKey: 'layoutBoxWheel' },
  { id: 'eliminated', selector: '.eliminated-panel', labelKey: 'layoutBoxEliminated' },
  { id: 'messages', selector: '#messagesBox', labelKey: 'layoutBoxMessages' },
  { id: 'participants', selector: '.participants', labelKey: 'layoutBoxParticipants' },
  { id: 'controls', selector: '.participants-controls', labelKey: 'layoutBoxControls' },
  { id: 'winners', selector: '.logs-box', labelKey: 'layoutBoxWinners' },
  { id: 'settings', selector: '.settings', labelKey: 'layoutBoxSettings' },
];
let layoutEditing = false;
let layoutDrag = null;
let layoutResizeObserver = null;

const layoutMain = () => document.querySelector('main');
const layoutBoxEl = (id) => document.querySelector(`[data-layout-id="${id}"]`);
const snapToGrid = (value) => Math.round(value / LAYOUT_GRID) * LAYOUT_GRID;
const isCustomLayout = () => document.body.classList.contains('custom-layout');

// Keeps the free layout consistent: "Eliminados" is as tall as the wheel, and
// the page is tall enough for the lowest box.
function refreshLayoutMetrics() {
  if (!isCustomLayout()) return;
  const wheel = layoutBoxEl('wheel');
  const eliminated = layoutBoxEl('eliminated');
  if (wheel && eliminated) eliminated.style.height = `${wheel.offsetHeight}px`;
  let bottom = 0;
  LAYOUT_BOXES.forEach(({ id }) => {
    const el = layoutBoxEl(id);
    if (el) bottom = Math.max(bottom, el.offsetTop + el.offsetHeight);
  });
  layoutMain().style.minHeight = `${bottom + LAYOUT_GRID}px`;
}

function applyLayout(positions) {
  document.body.classList.add('custom-layout');
  LAYOUT_BOXES.forEach(({ id }) => {
    const el = layoutBoxEl(id);
    if (!el) return;
    const pos = positions[id] || { x: 0, y: 0 };
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
  });
  if (typeof ResizeObserver !== 'undefined' && !layoutResizeObserver) {
    layoutResizeObserver = new ResizeObserver(() => refreshLayoutMetrics());
    LAYOUT_BOXES.forEach(({ id }) => {
      const el = layoutBoxEl(id);
      if (el) layoutResizeObserver.observe(el);
    });
  }
  refreshLayoutMetrics();
}

// Turns the current flow layout into positions (snapped to the grid)
function freezeLayout() {
  const mainRect = layoutMain().getBoundingClientRect();
  const positions = {};
  LAYOUT_BOXES.forEach(({ id }) => {
    const el = layoutBoxEl(id);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    positions[id] = {
      x: Math.max(0, snapToGrid(rect.left - mainRect.left)),
      y: Math.max(0, snapToGrid(rect.top - mainRect.top)),
    };
  });
  applyLayout(positions);
  saveLayout();
}

function saveLayout() {
  if (!isCustomLayout()) return;
  const boxes = {};
  LAYOUT_BOXES.forEach(({ id }) => {
    const el = layoutBoxEl(id);
    if (el) boxes[id] = { x: parseInt(el.style.left, 10) || 0, y: parseInt(el.style.top, 10) || 0 };
  });
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ version: 1, grid: LAYOUT_GRID, boxes }));
  } catch (err) {
    // Storage may be unavailable; the layout just won't persist
  }
}

function loadLayout() {
  try {
    const data = JSON.parse(localStorage.getItem(LAYOUT_KEY));
    if (!data || typeof data.boxes !== 'object' || data.boxes === null) return null;
    const positions = {};
    LAYOUT_BOXES.forEach(({ id }) => {
      const p = data.boxes[id];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        positions[id] = { x: Math.max(0, Math.round(p.x)), y: Math.max(0, Math.round(p.y)) };
      }
    });
    return Object.keys(positions).length ? positions : null;
  } catch (err) {
    return null;
  }
}

function resetLayout() {
  try {
    localStorage.removeItem(LAYOUT_KEY);
  } catch (err) {
    // ignore
  }
  document.body.classList.remove('custom-layout');
  LAYOUT_BOXES.forEach(({ id }) => {
    const el = layoutBoxEl(id);
    if (!el) return;
    el.style.left = '';
    el.style.top = '';
    el.style.height = '';
  });
  layoutMain().style.minHeight = '';
}

function onLayoutPointerDown(e) {
  if (!layoutEditing || e.button !== 0) return;
  const box = e.currentTarget;
  e.preventDefault();
  if (!isCustomLayout()) freezeLayout();
  if (box.setPointerCapture) box.setPointerCapture(e.pointerId);
  layoutDrag = {
    box,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    origX: parseInt(box.style.left, 10) || 0,
    origY: parseInt(box.style.top, 10) || 0,
  };
  box.classList.add('layout-dragging');
}

function onLayoutPointerMove(e) {
  if (!layoutDrag || layoutDrag.pointerId !== e.pointerId || layoutDrag.box !== e.currentTarget) return;
  const { box } = layoutDrag;
  const maxX = Math.max(0, Math.floor((layoutMain().clientWidth - box.offsetWidth) / LAYOUT_GRID) * LAYOUT_GRID);
  const x = Math.min(maxX, Math.max(0, snapToGrid(layoutDrag.origX + e.clientX - layoutDrag.startX)));
  const y = Math.max(0, snapToGrid(layoutDrag.origY + e.clientY - layoutDrag.startY));
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  refreshLayoutMetrics();
}

function onLayoutPointerUp(e) {
  if (!layoutDrag || layoutDrag.pointerId !== e.pointerId || layoutDrag.box !== e.currentTarget) return;
  const { box } = layoutDrag;
  if (box.releasePointerCapture) {
    try { box.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
  }
  box.classList.remove('layout-dragging');
  layoutDrag = null;
  saveLayout();
  refreshLayoutMetrics();
}

function initLayoutBoxes() {
  LAYOUT_BOXES.forEach(({ id, selector, labelKey }) => {
    const el = document.querySelector(selector);
    if (!el) return;
    el.classList.add('layout-box');
    el.dataset.layoutId = id;
    el.dataset.layoutLabel = t(labelKey);
    el.addEventListener('pointerdown', onLayoutPointerDown);
    el.addEventListener('pointermove', onLayoutPointerMove);
    el.addEventListener('pointerup', onLayoutPointerUp);
    el.addEventListener('pointercancel', onLayoutPointerUp);
  });
  // While editing, clicks on boxes must not trigger their actions (e.g. spinning the wheel)
  document.addEventListener('click', (e) => {
    if (layoutEditing && e.target.closest && e.target.closest('.layout-box')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
  const saved = loadLayout();
  if (saved) applyLayout(saved);
}

function setDebugMode(enabled) {
  layoutEditing = enabled;
  document.body.classList.toggle('debug-mode', enabled);
}

els.debugModeCheckbox.addEventListener('change', () => {
  setDebugMode(els.debugModeCheckbox.checked);
});
els.resetLayoutBtn.addEventListener('click', resetLayout);

// --- Timer widget ---
// A floating countdown (30s / 1m / 5m / custom). When it ends it sounds an alarm and
// can optionally run actions (shuffle, close/open joins, spin). By default it only
// sounds the alarm. The countdown is driven by a worker timer and a monotonic clock,
// so it keeps running when the tab is in the background.
const TIMER_KEY = 'htz_timer';
const TIMER_TICK_MS = 200;
const TIMER_MAX_SECONDS = 24 * 3600 - 1;
const timerSettings = {
  visible: false,
  alarm: true,
  actions: { shuffle: false, closeJoin: false, openJoin: false, spin: false },
  pos: null, // { x, y } in viewport px, always on the grid
  custom: { h: 0, m: 2, s: 0 }, // last value picked with "..."
};
const timer = { status: 'idle', totalMs: 0, endAt: 0, remainingMs: 0, tickId: null, doneText: '' };
const TIMER_ACTION_IDS = {
  shuffle: 'timerActShuffle',
  closeJoin: 'timerActCloseJoin',
  openJoin: 'timerActOpenJoin',
  spin: 'timerActSpin',
};
const TIMER_PICKER_MAX = { h: 23, m: 59, s: 59 };
const timerPickerValue = { h: 0, m: 0, s: 0 };
const timerBaseTitle = document.title;
let timerDrag = null;

function saveTimerSettings() {
  try {
    localStorage.setItem(TIMER_KEY, JSON.stringify(timerSettings));
  } catch (err) {
    // Storage may be unavailable; settings just won't persist
  }
}

function loadTimerSettings() {
  try {
    const data = JSON.parse(localStorage.getItem(TIMER_KEY));
    if (!data || typeof data !== 'object') return;
    timerSettings.visible = !!data.visible;
    timerSettings.alarm = data.alarm !== false;
    Object.keys(timerSettings.actions).forEach((k) => {
      timerSettings.actions[k] = !!(data.actions && data.actions[k]);
    });
    if (timerSettings.actions.closeJoin && timerSettings.actions.openJoin) timerSettings.actions.openJoin = false;
    if (data.pos && Number.isFinite(data.pos.x) && Number.isFinite(data.pos.y)) {
      timerSettings.pos = { x: data.pos.x, y: data.pos.y };
    }
    if (data.custom) {
      const clamp = (v, max) => Math.min(max, Math.max(0, Math.floor(Number(v)) || 0));
      timerSettings.custom = {
        h: clamp(data.custom.h, TIMER_PICKER_MAX.h),
        m: clamp(data.custom.m, TIMER_PICKER_MAX.m),
        s: clamp(data.custom.s, TIMER_PICKER_MAX.s),
      };
    }
  } catch (err) {
    // Unreadable data: keep the defaults
  }
}

function formatTimer(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function showTimerView(view) {
  els.timerIdle.hidden = view !== 'idle';
  els.timerPicker.hidden = view !== 'picker';
  els.timerRun.hidden = view !== 'run';
}

function renderTimer() {
  const { status } = timer;
  const remaining = status === 'running' ? Math.max(0, timer.endAt - performance.now()) : timer.remainingMs;
  const text = formatTimer(remaining);
  els.timerDisplay.textContent = text;
  els.timerProgressBar.style.width = timer.totalMs
    ? `${Math.max(0, Math.min(100, (remaining / timer.totalMs) * 100))}%`
    : '0%';
  els.timerWidget.dataset.status = status;
  els.timerPauseBtn.hidden = status === 'finished';
  els.timerRepeatBtn.hidden = status !== 'finished';
  els.timerPauseBtn.textContent = t(status === 'paused' ? 'timerResume' : 'timerPause');
  els.timerCancelBtn.textContent = t(status === 'finished' ? 'timerClose' : 'timerCancel');
  if (status === 'paused') els.timerStatus.textContent = t('timerPausedLabel');
  else if (status === 'finished') els.timerStatus.textContent = [t('timerTimeUp'), timer.doneText].filter(Boolean).join(' · ');
  else els.timerStatus.textContent = '';

  // Visible even when the widget is hidden or the tab is in the background
  const counting = status === 'running' || status === 'paused';
  els.timerBtn.textContent = counting ? `⏱ ${text}` : '⏱';
  els.timerBtn.classList.toggle('timer-active', counting);
  document.title = counting ? `⏱ ${text} · ${timerBaseTitle}` : timerBaseTitle;
}

function stopTimerTick() {
  if (timer.tickId !== null) {
    bgTimers.clear(timer.tickId);
    timer.tickId = null;
  }
}

function timerTick() {
  if (timer.status !== 'running') return;
  if (timer.endAt - performance.now() <= 0) finishTimer();
  else renderTimer();
}

function startTimer(seconds) {
  const sec = Math.max(1, Math.min(TIMER_MAX_SECONDS, Math.floor(seconds)));
  stopTimerTick();
  timer.status = 'running';
  timer.totalMs = sec * 1000;
  timer.remainingMs = timer.totalMs;
  timer.endAt = performance.now() + timer.totalMs;
  timer.doneText = '';
  timer.tickId = bgTimers.interval(timerTick, TIMER_TICK_MS);
  try {
    getAudioCtx(); // create/unlock audio now, inside the click, so the alarm can sound later
  } catch (err) {
    // Audio unavailable
  }
  showTimerView('run');
  renderTimer();
}

function pauseTimer() {
  if (timer.status !== 'running') return;
  timer.remainingMs = Math.max(0, timer.endAt - performance.now());
  timer.status = 'paused';
  stopTimerTick();
  renderTimer();
}

function resumeTimer() {
  if (timer.status !== 'paused') return;
  timer.endAt = performance.now() + timer.remainingMs;
  timer.status = 'running';
  timer.tickId = bgTimers.interval(timerTick, TIMER_TICK_MS);
  renderTimer();
}

function cancelTimer() {
  stopTimerTick();
  timer.status = 'idle';
  timer.remainingMs = 0;
  timer.totalMs = 0;
  timer.doneText = '';
  showTimerView('idle');
  renderTimer();
}

// Runs the configured actions in a fixed order: shuffle, joins, spin.
// Returns what was done (for the status line).
function runTimerActions() {
  const a = timerSettings.actions;
  const done = [];
  if (a.shuffle) {
    if (!state.animating && state.participants.length > 1) {
      shuffleParticipants();
      done.push(t('timerDoShuffle'));
    }
  }
  if (a.closeJoin) {
    setJoinAccepted(false);
    done.push(t('timerDoCloseJoin'));
  }
  if (a.openJoin) {
    setJoinAccepted(true);
    done.push(t('timerDoOpenJoin'));
  }
  if (a.spin) {
    if (state.spinning) done.push(t('timerSpinBusy'));
    else if (state.participants.length === 0) done.push(t('timerSpinEmpty'));
    else {
      spin();
      done.push(t('timerDoSpin'));
    }
  }
  return done;
}

function scheduleAlarmBeep(ctx, when, freq) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.linearRampToValueAtTime(0.28, when + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.15);
  osc.connect(gain).connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.16);
}

// Three groups of three beeps (about 2.7 s), scheduled on the audio clock
function playAlarm() {
  try {
    const ctx = getAudioCtx();
    const start = () => {
      const t0 = ctx.currentTime + 0.05;
      for (let group = 0; group < 3; group += 1) {
        for (let beep = 0; beep < 3; beep += 1) {
          scheduleAlarmBeep(ctx, t0 + group * 0.9 + beep * 0.2, beep === 2 ? 1319 : 988);
        }
      }
    };
    if (ctx.state === 'running') start();
    else ctx.resume().then(start).catch(() => {});
  } catch (err) {
    // Audio unavailable
  }
}

function finishTimer() {
  stopTimerTick();
  timer.status = 'finished';
  timer.remainingMs = 0;
  const done = runTimerActions();
  timer.doneText = done.length ? t('timerDoneActions', { list: done.join(', ') }) : '';
  if (timerSettings.alarm) playAlarm();
  if (!timerSettings.visible) setTimerVisible(true); // make sure the "time's up" is seen
  showTimerView('run');
  renderTimer();
}

// ---- time picker (hours : minutes : seconds, like the Windows one) ----
function renderTimerPicker() {
  els.timerPicker.querySelectorAll('.timer-col').forEach((col) => {
    const unit = col.dataset.unit;
    const size = TIMER_PICKER_MAX[unit] + 1;
    const items = col.querySelector('.timer-col-items');
    items.innerHTML = '';
    for (let offset = -2; offset <= 2; offset += 1) {
      const value = (timerPickerValue[unit] + offset + size) % size;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `timer-col-item${offset === 0 ? ' selected' : ''}`;
      btn.dataset.offset = String(offset);
      btn.textContent = String(value).padStart(2, '0');
      btn.addEventListener('click', () => {
        timerPickerValue[unit] = value;
        renderTimerPicker();
      });
      items.appendChild(btn);
    }
  });
  els.timerPickerStart.disabled = timerPickerValue.h + timerPickerValue.m + timerPickerValue.s === 0;
}

function stepTimerPicker(unit, dir) {
  const size = TIMER_PICKER_MAX[unit] + 1;
  timerPickerValue[unit] = (timerPickerValue[unit] + dir + size) % size;
  renderTimerPicker();
}

function openTimerPicker() {
  Object.assign(timerPickerValue, timerSettings.custom);
  renderTimerPicker();
  showTimerView('picker');
}

function startFromTimerPicker() {
  const { h, m, s } = timerPickerValue;
  if (h + m + s === 0) return;
  timerSettings.custom = { h, m, s };
  saveTimerSettings();
  startTimer(h * 3600 + m * 60 + s);
}

// ---- floating window: position (on the grid), drag, visibility ----
function placeTimerWidget(x, y) {
  const rect = els.timerWidget.getBoundingClientRect();
  const maxX = Math.max(0, window.innerWidth - rect.width);
  const maxY = Math.max(0, window.innerHeight - rect.height);
  const fallback = { x: window.innerWidth - rect.width - 40, y: 140 };
  const pos = timerSettings.pos || fallback;
  const nx = Math.min(maxX, Math.max(0, snapToGrid(x === undefined ? pos.x : x)));
  const ny = Math.min(maxY, Math.max(0, snapToGrid(y === undefined ? pos.y : y)));
  els.timerWidget.style.left = `${nx}px`;
  els.timerWidget.style.top = `${ny}px`;
  return { x: nx, y: ny };
}

function setTimerVisible(visible) {
  timerSettings.visible = visible;
  els.timerWidget.hidden = !visible;
  els.timerShowCheckbox.checked = visible;
  els.timerBtn.classList.toggle('active', visible);
  if (visible) placeTimerWidget();
  saveTimerSettings();
}

function initTimer() {
  loadTimerSettings();
  els.timerAlarmCheckbox.checked = timerSettings.alarm;
  Object.entries(TIMER_ACTION_IDS).forEach(([key, id]) => {
    els[id].checked = timerSettings.actions[key];
  });

  els.timerBtn.addEventListener('click', () => setTimerVisible(!timerSettings.visible));
  els.timerCloseBtn.addEventListener('click', () => setTimerVisible(false));
  els.timerShowCheckbox.addEventListener('change', () => setTimerVisible(els.timerShowCheckbox.checked));
  els.timerAlarmCheckbox.addEventListener('change', () => {
    timerSettings.alarm = els.timerAlarmCheckbox.checked;
    saveTimerSettings();
  });
  els.timerAlarmTestBtn.addEventListener('click', playAlarm);
  Object.entries(TIMER_ACTION_IDS).forEach(([key, id]) => {
    els[id].addEventListener('change', () => {
      timerSettings.actions[key] = els[id].checked;
      // "stop joins" and "accept joins" contradict each other
      if (els[id].checked && key === 'closeJoin') {
        timerSettings.actions.openJoin = false;
        els.timerActOpenJoin.checked = false;
      }
      if (els[id].checked && key === 'openJoin') {
        timerSettings.actions.closeJoin = false;
        els.timerActCloseJoin.checked = false;
      }
      saveTimerSettings();
    });
  });

  els.timerWidget.querySelectorAll('[data-seconds]').forEach((btn) => {
    btn.addEventListener('click', () => startTimer(Number(btn.dataset.seconds)));
  });
  els.timerCustomBtn.addEventListener('click', openTimerPicker);
  els.timerPickerStart.addEventListener('click', startFromTimerPicker);
  els.timerPickerCancel.addEventListener('click', () => showTimerView('idle'));
  els.timerPauseBtn.addEventListener('click', () => (timer.status === 'paused' ? resumeTimer() : pauseTimer()));
  els.timerRepeatBtn.addEventListener('click', () => startTimer(timer.totalMs / 1000));
  els.timerCancelBtn.addEventListener('click', cancelTimer);

  els.timerPicker.querySelectorAll('.timer-col').forEach((col) => {
    const unit = col.dataset.unit;
    col.addEventListener('wheel', (e) => {
      e.preventDefault();
      stepTimerPicker(unit, e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
    col.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); stepTimerPicker(unit, -1); }
      if (e.key === 'ArrowDown') { e.preventDefault(); stepTimerPicker(unit, 1); }
    });
    col.querySelectorAll('.timer-col-arrow').forEach((arrow) => {
      arrow.addEventListener('click', () => stepTimerPicker(unit, Number(arrow.dataset.dir)));
    });
  });
  els.timerPicker.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startFromTimerPicker();
    if (e.key === 'Escape') showTimerView('idle');
  });

  // Drag by the title bar; positions snap to the same grid as the other boxes
  els.timerHeader.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const rect = els.timerWidget.getBoundingClientRect();
    timerDrag = { id: e.pointerId, dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    els.timerHeader.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  els.timerHeader.addEventListener('pointermove', (e) => {
    if (!timerDrag || timerDrag.id !== e.pointerId) return;
    placeTimerWidget(e.clientX - timerDrag.dx, e.clientY - timerDrag.dy);
  });
  const endDrag = (e) => {
    if (!timerDrag || timerDrag.id !== e.pointerId) return;
    timerDrag = null;
    timerSettings.pos = placeTimerWidget(parseInt(els.timerWidget.style.left, 10), parseInt(els.timerWidget.style.top, 10));
    saveTimerSettings();
  };
  els.timerHeader.addEventListener('pointerup', endDrag);
  els.timerHeader.addEventListener('pointercancel', endDrag);
  window.addEventListener('resize', () => {
    if (timerSettings.visible) placeTimerWidget();
  });

  showTimerView('idle');
  setTimerVisible(timerSettings.visible);
  renderTimer();
}

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
    recentOrder: state.recentOrder,
    subNames: [...state.subNames],
    eliminatedLog: state.eliminatedLog,
    winnersLog: state.winnersLog,
    rotation: state.rotation,
    colorPalette: state.colorPalette,
    subColors: state.subColors,
    subText: getSubTextSettings(),
    soundPack: state.soundPack,
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
  state.recentOrder = Array.isArray(m.recentOrder) ? m.recentOrder : [];
  state.subNames = new Set(m.subNames);
  state.eliminatedLog = m.eliminatedLog;
  state.winnersLog = m.winnersLog;
  if (!keepRotation) state.rotation = m.rotation;
  state.colorPalette = m.colorPalette;
  if (m.subColors) state.subColors = m.subColors;
  if (m.subText) applySubTextSettings(m.subText);
  if (typeof m.soundPack === 'string' && m.soundPack in SOUND_PACKS) {
    state.soundPack = m.soundPack;
    if (OVERLAY_SOUND) loadSoundPack(state.soundPack); // overlays are silent unless &sound=1
  }
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
      endKind: m.endKind,
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
    loadSoundPack(state.soundPack);
    initLayoutBoxes();
    initTimer();
  }
  renderParticipants();
  renderLogs();
  updateSettingsVisibility();
  drawWheel();
  if (IS_OVERLAY) startOverlayClient();
  else startOverlayHost();
});
