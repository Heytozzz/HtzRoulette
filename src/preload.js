// Preload: exposes a limited, safe API to the renderer process
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('htz', {
  connect: (channel) => ipcRenderer.invoke('twitch:connect', channel),
  disconnect: () => ipcRenderer.invoke('twitch:disconnect'),
  setJoinCommand: (command) => ipcRenderer.invoke('twitch:setJoinCommand', command),
  onParticipant: (callback) => {
    ipcRenderer.on('twitch:participant', (event, payload) => callback(payload));
  },
  onStatus: (callback) => {
    ipcRenderer.on('twitch:status', (event, status) => callback(status));
  },
  listThemes: () => ipcRenderer.invoke('themes:list'),
  getThemeImages: (themeName) => ipcRenderer.invoke('themes:getImages', themeName),
});
