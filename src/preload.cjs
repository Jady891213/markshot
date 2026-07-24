const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("replyImage", {
  readClipboard: () => ipcRenderer.invoke("clipboard:read"),
  renderPreview: (request) => ipcRenderer.invoke("preview:render", request),
  copyPage: (request) => ipcRenderer.invoke("page:copy", request),
  exportPage: (request) => ipcRenderer.invoke("page:export", request),
  quickGenerate: () => ipcRenderer.invoke("quick:generate"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (settings) =>
    ipcRenderer.invoke("settings:update", settings),
  registerShortcut: (accelerator) =>
    ipcRenderer.invoke("shortcut:register", accelerator),
  hideWindow: () => ipcRenderer.send("window:hide"),
  quitApp: () => ipcRenderer.send("app:quit"),
  onQuickLoad: (callback) => subscribe("quick:load", callback),
  onSettingsChanged: (callback) => subscribe("settings:changed", callback),
});
