const { contextBridge, ipcRenderer } = require('electron');
const on = (ch, cb) => { const f = (_e, d) => cb(d); ipcRenderer.on(ch, f); return () => ipcRenderer.removeListener(ch, f); };
contextBridge.exposeInMainWorld('karmin', {
  minimize: () => ipcRenderer.invoke('win:minimize'),
  maximize: () => ipcRenderer.invoke('win:maximize'),
  close: () => ipcRenderer.invoke('win:close'),
  info: () => ipcRenderer.invoke('app:info'),
  catalog: force => ipcRenderer.invoke('catalog:get', force),
  install: id => ipcRenderer.invoke('app:install', id),
  launch: id => ipcRenderer.invoke('app:launch', id),
  pickExe: id => ipcRenderer.invoke('app:pickExe', id),
  forget: id => ipcRenderer.invoke('app:forget', id),
  downloads: () => ipcRenderer.invoke('downloads:get'),
  cancel: id => ipcRenderer.invoke('download:cancel', id),
  retry: appId => ipcRenderer.invoke('download:retry', appId),
  clearDownloads: () => ipcRenderer.invoke('downloads:clear'),
  showFile: p => ipcRenderer.invoke('download:showFile', p),
  openExternal: url => ipcRenderer.invoke('open:external', url),
  onDownloads: cb => on('downloads:update', cb),
  onCatalog: cb => on('catalog:update', cb),
  onWinState: cb => on('win:state', cb),
});
