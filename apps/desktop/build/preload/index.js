"use strict";

// src/preload/index.ts
var import_electron = require("electron");

// src/shared/bridge.ts
var CHANNELS = {
  settingsGet: "ng:settings:get",
  settingsSet: "ng:settings:set",
  settingsChanged: "ng:settings:changed",
  sample: "ng:sample",
  adapters: "ng:adapters",
  setPaused: "ng:paused",
  windowAction: "ng:window",
  openView: "ng:open-view",
  openViewRequest: "ng:open-view-request",
  appInfo: "ng:app-info",
  loginItem: "ng:login-item",
  relaunchWindow: "ng:relaunch-window"
};

// src/preload/index.ts
function subscribe(channel, handler) {
  const listener = (_event, payload) => handler(payload);
  import_electron.ipcRenderer.on(channel, listener);
  return () => import_electron.ipcRenderer.removeListener(channel, listener);
}
var api = {
  getSettings: () => import_electron.ipcRenderer.invoke(CHANNELS.settingsGet),
  setSettings: (patch) => import_electron.ipcRenderer.invoke(CHANNELS.settingsSet, patch),
  onSettings: (handler) => subscribe(CHANNELS.settingsChanged, handler),
  onSample: (handler) => subscribe(CHANNELS.sample, handler),
  getAdapters: () => import_electron.ipcRenderer.invoke(CHANNELS.adapters),
  setPaused: (paused) => import_electron.ipcRenderer.invoke(CHANNELS.setPaused, paused),
  window: (action, value) => import_electron.ipcRenderer.invoke(CHANNELS.windowAction, action, value),
  openView: (view) => import_electron.ipcRenderer.invoke(CHANNELS.openView, view),
  onOpenView: (handler) => subscribe(CHANNELS.openViewRequest, handler),
  getAppInfo: () => import_electron.ipcRenderer.invoke(CHANNELS.appInfo),
  setLoginItem: (enabled) => import_electron.ipcRenderer.invoke(CHANNELS.loginItem, enabled),
  relaunchWindow: () => import_electron.ipcRenderer.invoke(CHANNELS.relaunchWindow)
};
import_electron.contextBridge.exposeInMainWorld("netgauge", api);
