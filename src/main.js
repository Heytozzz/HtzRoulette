// Main process: creates the app window and manages the Twitch chat connection
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const tmi = require('tmi.js');

let mainWindow = null;
let tmiClient = null;
let joinCommand = '!join';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Disconnect a previous client, if any
async function disconnectClient() {
  if (tmiClient) {
    try {
      await tmiClient.disconnect();
    } catch (err) {
      // Ignore disconnect errors
    }
    tmiClient = null;
  }
}

// Handle connect request from renderer
ipcMain.handle('twitch:connect', async (event, channelName) => {
  await disconnectClient();

  const channel = channelName.trim().replace(/^#/, '').toLowerCase();
  if (!channel) {
    return { ok: false, error: 'empty-channel' };
  }

  tmiClient = new tmi.Client({
    channels: [channel],
  });

  tmiClient.on('message', (chan, tags, message, self) => {
    if (self) return;
    if (message.trim().toLowerCase() === joinCommand) {
      const username = tags['display-name'] || tags.username;
      mainWindow.webContents.send('twitch:participant', username);
    }
  });

  tmiClient.on('disconnected', (reason) => {
    if (mainWindow) mainWindow.webContents.send('twitch:status', { connected: false, reason });
  });

  try {
    await tmiClient.connect();
    if (mainWindow) mainWindow.webContents.send('twitch:status', { connected: true, channel });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('twitch:disconnect', async () => {
  await disconnectClient();
  return { ok: true };
});

ipcMain.handle('twitch:setJoinCommand', (event, command) => {
  joinCommand = String(command).trim().toLowerCase() || '!join';
  return { ok: true, command: joinCommand };
});
