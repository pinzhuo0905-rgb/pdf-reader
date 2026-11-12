'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openDialog: () => ipcRenderer.invoke('dialog:open'),
  readFile: (p) => ipcRenderer.invoke('file:read', p),
  fileInfo: (p) => ipcRenderer.invoke('file:info', p),
  save: (p, data) => ipcRenderer.invoke('file:save', p, data),
  saveAs: (name, data) => ipcRenderer.invoke('dialog:saveAs', name, data),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  showItemInFolder: (p) => ipcRenderer.invoke('shell:showItem', p),
  appVersion: () => ipcRenderer.invoke('app:version'),
  toggleFullscreen: (v) => ipcRenderer.invoke('window:fullscreen', v),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximized: (cb) => ipcRenderer.on('window:maximized', (_e, v) => cb(v)),
  isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
  printPages: (payload) => ipcRenderer.invoke('print:pages', payload),
  loadCjkFont: () => ipcRenderer.invoke('font:load'),
  ocrWarmup: () => ipcRenderer.invoke('ocr:warmup'),
  ocrRecognize: (img) => ipcRenderer.invoke('ocr:recognize', img),
  openDefaultApps: () => ipcRenderer.invoke('shell:defaultApps'),
  allowClose: () => ipcRenderer.invoke('app:allow-close'),
  detachTab: (payload) => ipcRenderer.invoke('tab:detach', payload),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
  onCloseRequest: (cb) => ipcRenderer.on('close-request', () => cb()),
  onOpenFile: (cb) => {
    ipcRenderer.on('open-file', (_e, p) => cb(p));
  },
});
