// Backup module: export / import of the whole web configuration.
// Export = settings, layout, timer, image window, saved lists, channel, themes and
// image presets (optionally participants and Twitch credentials).
// Import = writes everything into localStorage / IndexedDB and reloads the page, so the
// existing loaders in app.js apply (and sanitize) the data exactly like a normal start.
// Loaded after app.js: uses its globals (t, saveState, theme/preset DB helpers, IS_OVERLAY).
(() => {
  if (typeof IS_OVERLAY !== 'undefined' && IS_OVERLAY) return;

  const FORMAT_APP = 'HtzRoulette';
  const FORMAT_VERSION = 1;
  const CODE_PREFIX_GZIP = 'HTZ1:';
  const CODE_PREFIX_PLAIN = 'HTZ0:';

  // localStorage keys that hold JSON objects (only these are exported/imported)
  const JSON_KEYS = ['htz_saved_state', 'htz_layout', 'htz_timer', 'htz_images', 'htz_saved_lists'];
  const STATE_KEY = 'htz_saved_state';
  const LISTS_KEY = 'htz_saved_lists';
  const CHANNEL_KEY = 'htz_channel';
  const CLIENT_ID_KEY = 'htz_twitch_client_id';
  const CLIENT_SECRET_KEY = 'htz_twitch_client_secret';
  // Fields of the saved state that belong to "participants" (not to the configuration)
  const PARTICIPANT_FIELDS = ['participants', 'recentOrder', 'subNames', 'eliminatedLog', 'winnersLog'];

  const $ = (id) => document.getElementById(id);
  const els = {
    includeParticipants: $('backupIncludeParticipants'),
    includeMedia: $('backupIncludeMedia'),
    includeCreds: $('backupIncludeCreds'),
    exportFileBtn: $('backupExportFileBtn'),
    exportCodeBtn: $('backupExportCodeBtn'),
    codeOut: $('backupCodeOut'),
    importFile: $('backupImportFile'),
    importFileBtn: $('backupImportFileBtn'),
    codeIn: $('backupCodeIn'),
    importCodeBtn: $('backupImportCodeBtn'),
    status: $('backupStatus'),
    channelInput: $('channelInput'),
  };
  if (!els.exportFileBtn) return; // the tab is not in the page

  // --- Small helpers ---
  const tr = (key, vars) => (typeof t === 'function' ? t(key, vars) : key);
  function setStatus(key, vars, isError) {
    els.status.textContent = key ? tr(key, vars) : '';
    els.status.style.color = isError ? '#e07070' : '';
  }

  function readJson(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch (err) {
      return null;
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }

  async function dataUrlToBlob(url) {
    const response = await fetch(url);
    return response.blob();
  }

  const isImageDataUrl = (v) => typeof v === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(v);

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(b64) {
    const binary = atob(b64.replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function streamToBytes(stream) {
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // --- Build the backup object ---
  async function buildBackup({ participants, media, credentials }) {
    if (typeof saveState === 'function') saveState(); // flush the latest in-memory state

    const storage = {};
    JSON_KEYS.forEach((key) => {
      const value = readJson(key);
      if (value) storage[key] = value;
    });

    if (!participants) {
      if (storage[STATE_KEY]) PARTICIPANT_FIELDS.forEach((f) => { delete storage[STATE_KEY][f]; });
      delete storage[LISTS_KEY];
    }

    const backup = {
      app: FORMAT_APP,
      version: FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      storage,
    };

    const channel = (els.channelInput.value || localStorage.getItem(CHANNEL_KEY) || '').trim();
    if (channel) backup.channel = channel;

    if (credentials) {
      backup.credentials = {
        clientId: localStorage.getItem(CLIENT_ID_KEY) || '',
        clientSecret: localStorage.getItem(CLIENT_SECRET_KEY) || '',
      };
    }

    if (media) {
      backup.themes = [];
      const themeNames = await loadThemeNamesFromDB();
      for (const name of themeNames) {
        const data = await loadThemeFromDB(name);
        if (!data) continue;
        backup.themes.push({
          name,
          bg: await Promise.all((data.bg || []).map(blobToDataUrl)),
          roulette: await Promise.all((data.roulette || []).map(blobToDataUrl)),
        });
      }

      backup.imagePresets = [];
      const titles = await listImagePresetTitles();
      for (const title of titles) {
        const record = await loadImagePreset(title);
        if (!record || !record.image) continue;
        backup.imagePresets.push({
          title,
          image: await blobToDataUrl(record.image),
          savedAt: record.savedAt || Date.now(),
        });
      }
    }
    return backup;
  }

  function readExportOptions(forCode) {
    return {
      participants: els.includeParticipants.checked,
      media: forCode ? false : els.includeMedia.checked, // images make codes far too long
      credentials: els.includeCreds.checked,
    };
  }

  // --- Export: file ---
  async function exportFile() {
    setStatus('backupWorking');
    try {
      const backup = await buildBackup(readExportOptions(false));
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `htzroulette-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setStatus('backupExportedFile', {
        themes: (backup.themes || []).length,
        presets: (backup.imagePresets || []).length,
      });
    } catch (err) {
      console.error('Backup export failed:', err);
      setStatus('backupExportError', null, true);
    }
  }

  // --- Export: code (settings only, compressed text) ---
  async function encodeCode(backup) {
    const text = JSON.stringify(backup);
    if (typeof CompressionStream === 'function') {
      const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
      return CODE_PREFIX_GZIP + bytesToBase64(await streamToBytes(stream));
    }
    return CODE_PREFIX_PLAIN + bytesToBase64(new TextEncoder().encode(text));
  }

  async function exportCode() {
    setStatus('backupWorking');
    try {
      const backup = await buildBackup(readExportOptions(true));
      const code = await encodeCode(backup);
      els.codeOut.value = code;
      els.codeOut.hidden = false;
      els.codeOut.select();
      let copied = false;
      try {
        await navigator.clipboard.writeText(code);
        copied = true;
      } catch (err) {
        // Clipboard blocked: the code stays selected in the box so it can be copied by hand
      }
      setStatus(copied ? 'backupCodeCopied' : 'backupCodeReady');
    } catch (err) {
      console.error('Backup code export failed:', err);
      setStatus('backupExportError', null, true);
    }
  }

  // --- Parse + validate an imported backup ---
  async function decodeText(raw) {
    const text = raw.trim();
    if (!text) throw new Error('empty');
    if (text.startsWith('{')) return JSON.parse(text);
    if (text.startsWith(CODE_PREFIX_GZIP)) {
      if (typeof DecompressionStream !== 'function') throw new Error('no-decompression');
      const bytes = base64ToBytes(text.slice(CODE_PREFIX_GZIP.length));
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return JSON.parse(new TextDecoder().decode(await streamToBytes(stream)));
    }
    if (text.startsWith(CODE_PREFIX_PLAIN)) {
      const bytes = base64ToBytes(text.slice(CODE_PREFIX_PLAIN.length));
      return JSON.parse(new TextDecoder().decode(bytes));
    }
    throw new Error('unknown-format');
  }

  const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

  function validateBackup(data) {
    if (!isPlainObject(data) || data.app !== FORMAT_APP) throw new Error('not-a-backup');
    if (!Number.isFinite(data.version) || data.version > FORMAT_VERSION) throw new Error('newer-version');

    const clean = { storage: {}, themes: [], imagePresets: [] };

    if (isPlainObject(data.storage)) {
      JSON_KEYS.forEach((key) => {
        if (isPlainObject(data.storage[key])) clean.storage[key] = data.storage[key];
      });
    }
    if (typeof data.channel === 'string') {
      clean.channel = data.channel.trim().replace(/^#/, '').toLowerCase().slice(0, 50);
    }
    if (isPlainObject(data.credentials)) {
      clean.credentials = {
        clientId: typeof data.credentials.clientId === 'string' ? data.credentials.clientId.slice(0, 200) : '',
        clientSecret: typeof data.credentials.clientSecret === 'string' ? data.credentials.clientSecret.slice(0, 200) : '',
      };
    }
    if (Array.isArray(data.themes)) {
      data.themes.forEach((theme) => {
        if (!isPlainObject(theme) || typeof theme.name !== 'string' || !theme.name.trim()) return;
        const pick = (list) => (Array.isArray(list) ? list.filter(isImageDataUrl) : []);
        clean.themes.push({ name: theme.name.trim(), bg: pick(theme.bg), roulette: pick(theme.roulette) });
      });
    }
    if (Array.isArray(data.imagePresets)) {
      data.imagePresets.forEach((preset) => {
        if (!isPlainObject(preset) || typeof preset.title !== 'string' || !preset.title.trim()) return;
        if (!isImageDataUrl(preset.image)) return;
        clean.imagePresets.push({ title: preset.title.trim(), image: preset.image });
      });
    }
    return clean;
  }

  // --- Apply an imported backup, then reload ---
  async function applyBackup(clean) {
    // 1) Media first (IndexedDB), so a failure here does not leave a half-applied config
    for (const theme of clean.themes) {
      await saveThemeToDB(theme.name, {
        bg: await Promise.all(theme.bg.map(dataUrlToBlob)),
        roulette: await Promise.all(theme.roulette.map(dataUrlToBlob)),
      });
    }
    for (const preset of clean.imagePresets) {
      await saveImagePreset(preset.title, await dataUrlToBlob(preset.image));
    }

    // 2) localStorage
    const storage = { ...clean.storage };
    if (storage[STATE_KEY] && !('participants' in storage[STATE_KEY])) {
      // Backup without participants: keep the ones currently in this browser
      const current = readJson(STATE_KEY) || {};
      const merged = { ...storage[STATE_KEY] };
      PARTICIPANT_FIELDS.forEach((f) => { if (f in current) merged[f] = current[f]; });
      storage[STATE_KEY] = merged;
    }
    Object.keys(storage).forEach((key) => localStorage.setItem(key, JSON.stringify(storage[key])));
    if (clean.channel !== undefined) localStorage.setItem(CHANNEL_KEY, clean.channel);
    if (clean.credentials) {
      localStorage.setItem(CLIENT_ID_KEY, clean.credentials.clientId);
      localStorage.setItem(CLIENT_SECRET_KEY, clean.credentials.clientSecret);
    }
  }

  async function runImport(rawText) {
    let clean;
    try {
      clean = validateBackup(await decodeText(rawText));
    } catch (err) {
      const key = {
        empty: 'backupImportEmpty',
        'not-a-backup': 'backupImportInvalid',
        'newer-version': 'backupImportNewer',
        'no-decompression': 'backupImportNoDecompression',
      }[err.message] || 'backupImportInvalid';
      setStatus(key, null, true);
      return;
    }

    const summary = tr('backupImportConfirm', { themes: clean.themes.length, presets: clean.imagePresets.length });
    if (!window.confirm(summary)) {
      setStatus('backupImportCancelled');
      return;
    }

    setStatus('backupWorking');
    try {
      await applyBackup(clean);
    } catch (err) {
      console.error('Backup import failed:', err);
      setStatus('backupImportError', null, true);
      return;
    }
    setStatus('backupImportDone');
    setTimeout(() => window.location.reload(), 800);
  }

  // --- Channel persistence (it was not saved before, so it could not be exported) ---
  try {
    const savedChannel = localStorage.getItem(CHANNEL_KEY);
    if (savedChannel && !els.channelInput.value) els.channelInput.value = savedChannel;
  } catch (err) {
    // Storage may be unavailable; ignore
  }
  els.channelInput.addEventListener('change', () => {
    try {
      localStorage.setItem(CHANNEL_KEY, els.channelInput.value.trim());
    } catch (err) {
      // ignore
    }
  });

  // --- Wire up the UI ---
  els.exportFileBtn.addEventListener('click', exportFile);
  els.exportCodeBtn.addEventListener('click', exportCode);
  els.importFileBtn.addEventListener('click', async () => {
    const file = els.importFile.files && els.importFile.files[0];
    if (!file) { setStatus('backupImportNoFile', null, true); return; }
    try {
      await runImport(await file.text());
    } catch (err) {
      console.error('Could not read the backup file:', err);
      setStatus('backupImportInvalid', null, true);
    }
  });
  els.importCodeBtn.addEventListener('click', () => runImport(els.codeIn.value));
})();
