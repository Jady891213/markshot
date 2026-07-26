const { contextBridge, ipcRenderer, webUtils } = require("electron");

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
  getDocumentLibrary: () => ipcRenderer.invoke("documents:get"),
  openMarkdownFiles: () => ipcRenderer.invoke("documents:open"),
  openRecentFile: (filePath) =>
    ipcRenderer.invoke("documents:open-recent", filePath),
  openDroppedFiles: (files) =>
    ipcRenderer.invoke(
      "documents:open-paths",
      Array.from(files || [], (file) => webUtils.getPathForFile(file)),
    ),
  saveInstantDocument: (request) =>
    ipcRenderer.invoke("documents:save-instant", request),
  updateInstantDocument: (document) =>
    ipcRenderer.invoke("documents:update-instant", document),
  closeDocument: (documentId) =>
    ipcRenderer.invoke("documents:close", documentId),
  removeRecent: (filePath) =>
    ipcRenderer.invoke("documents:remove-recent", filePath),
  hideWindow: () => ipcRenderer.send("window:hide"),
  quitApp: () => ipcRenderer.send("app:quit"),
  onQuickLoad: (callback) => subscribe("quick:load", callback),
  onSettingsChanged: (callback) => subscribe("settings:changed", callback),
  onDocumentsOpened: (callback) => subscribe("documents:opened", callback),
  onDocumentChanged: (callback) => subscribe("documents:changed", callback),
  onOpenRequested: (callback) => subscribe("documents:open-requested", callback),
});
