// Renderer process: UI logic, no direct Node/Electron access (uses window.htz bridge)

const state = {
  participants: [],
  spinning: false,
  rotation: 0,
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

// --- Participants list ---
function renderParticipants() {
  els.participantList.innerHTML = '';
  if (state.participants.length === 0) {
    const li = document.createElement('li');
    li.textContent = t('empty');
    els.participantList.appendChild(li);
    return;
  }
  state.participants.forEach((name) => {
    const li = document.createElement('li');
    li.textContent = name;
    els.participantList.appendChild(li);
  });
}

function addParticipant(name) {
  if (!name) return;
  if (state.participants.includes(name)) return;
  state.participants.push(name);
  renderParticipants();
  drawWheel();
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

  // Pointer
  ctx.beginPath();
  ctx.moveTo(cx + radius + 12, cy);
  ctx.lineTo(cx + radius - 6, cy - 10);
  ctx.lineTo(cx + radius - 6, cy + 10);
  ctx.closePath();
  ctx.fillStyle = '#ffcc00';
  ctx.fill();
}

// --- Spin logic ---
function spin() {
  if (state.spinning || state.participants.length === 0) return;
  state.spinning = true;
  els.winnerText.textContent = '';

  const count = state.participants.length;
  const sliceAngle = (Math.PI * 2) / count;
  const winnerIndex = Math.floor(Math.random() * count);

  // Target angle so the winner slice center lands at the pointer (angle 0, right side)
  const targetSliceCenter = winnerIndex * sliceAngle + sliceAngle / 2;
  const extraSpins = 5 + Math.floor(Math.random() * 3);
  const targetRotation = extraSpins * Math.PI * 2 - targetSliceCenter;

  const startRotation = state.rotation;
  const duration = 4000;
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
      state.spinning = false;
      els.winnerText.textContent = t('winner', { name: state.participants[winnerIndex] });
    }
  }

  requestAnimationFrame(animate);
}

function resetParticipants() {
  state.participants = [];
  state.rotation = 0;
  els.winnerText.textContent = '';
  renderParticipants();
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

// --- Init ---
loadStrings().then(() => {
  renderParticipants();
  drawWheel();
});
