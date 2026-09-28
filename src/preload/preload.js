'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setPrefs: (partial) => ipcRenderer.invoke('settings:setPrefs', partial),
  setApiKey: (key) => ipcRenderer.invoke('settings:setApiKey', key),
  chooseServiceAccount: () => ipcRenderer.invoke('settings:chooseServiceAccount'),
  clearKey: () => ipcRenderer.invoke('settings:clearKey'),
  testKey: () => ipcRenderer.invoke('key:test'),

  startSession: (opts) => ipcRenderer.invoke('session:start', opts),
  stopSession: () => ipcRenderer.invoke('session:stop'),
  sendAudio: (pcm) => ipcRenderer.send('audio:chunk', pcm),
  getUsage: () => ipcRenderer.invoke('usage:get'),
  askMicAccess: () => ipcRenderer.invoke('mic:access'),

  toggleOverlay: () => ipcRenderer.invoke('overlay:toggle'),
  closeOverlay: () => ipcRenderer.send('overlay:close'),

  copyTranscript: () => ipcRenderer.invoke('transcript:copy'),
  saveTranscript: (format) => ipcRenderer.invoke('transcript:save', format),
  clearTranscript: () => ipcRenderer.invoke('transcript:clear'),
  openExternal: (url) => ipcRenderer.send('open-external', url),

  onCaption: (fn) => ipcRenderer.on('caption', (_e, msg) => fn(msg)),
  onOverlayState: (fn) => ipcRenderer.on('overlay-state', (_e, open) => fn(open)),
});
