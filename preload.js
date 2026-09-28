const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rotastock', {
  isElectron: true,
  loadDB: () => ipcRenderer.invoke('db:load'),
  saveDB: (text) => ipcRenderer.invoke('db:save', text),
  listBackups: () => ipcRenderer.invoke('db:listBackups'),
  readBackup: (name) => ipcRenderer.invoke('db:readBackup', name)
});
