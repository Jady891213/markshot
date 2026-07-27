import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray,
} from "electron";
import {
  buildDocument,
  detectSourceFormat,
  pageLayout,
  suggestedFileName,
} from "./rendering.mjs";
import { DocumentLibrary, isMarkdownPath } from "./documents.mjs";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from "./settings.mjs";
import { optimizePngLossless } from "./png.mjs";

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(SOURCE_DIR, "ui");
const MAX_RENDER_RECORDS = 5;

let mainWindow;
let renderWindow;
let tray;
let hudWindow;
let hudTimer;
let isQuitting = false;
let quickGenerationRunning = false;
let registeredAccelerator = "";
let settings = { ...DEFAULT_SETTINGS };
let settingsPath = "";
let documentLibrary;
let recentDocumentsPath = "";
let renderQueue = Promise.resolve();
let loadedRenderRevision = "";
const renderRecords = new Map();
const pendingOpenPaths = [];
let instantDocument = {
  id: "instant",
  kind: "instant",
  name: "即时分享",
  source: "",
  sourceFormat: "markdown",
  html: "",
  status: "ready",
};

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (!isMarkdownPath(filePath)) return;
  if (!documentLibrary) {
    pendingOpenPaths.push(filePath);
    return;
  }
  openDocumentPaths([filePath], { showWindow: true }).catch(console.error);
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function dataUrl(html) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function runInRenderQueue(task) {
  const result = renderQueue.then(task, task);
  renderQueue = result.catch(() => {});
  return result;
}

function createRenderWindow(width = 1080) {
  if (renderWindow && !renderWindow.isDestroyed()) return renderWindow;
  renderWindow = new BrowserWindow({
    show: false,
    frame: false,
    transparent: false,
    useContentSize: true,
    width,
    height: 100,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  renderWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  renderWindow.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  renderWindow.on("closed", () => {
    renderWindow = undefined;
    loadedRenderRevision = "";
  });
  return renderWindow;
}

async function waitForRenderedContent(window) {
  await window.webContents.executeJavaScript(`
    (async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      const images = Array.from(document.images || []);
      await Promise.race([
        Promise.all(images.map((image) => image.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener("error", resolve, { once: true });
            }))),
        new Promise((resolve) => setTimeout(resolve, 5000))
      ]);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
    })()
  `);
}

async function loadRenderRecord(record) {
  const window = createRenderWindow(record.options.width);
  window.setContentSize(record.options.width, 100);
  await window.loadURL(dataUrl(record.html));
  await waitForRenderedContent(window);
  loadedRenderRevision = record.revision;
  return window;
}

async function measureRecord(record) {
  const window = await loadRenderRecord(record);
  const totalHeight = await window.webContents.executeJavaScript(`
    Math.ceil(Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      document.documentElement.offsetHeight,
      document.body.offsetHeight
    ))
  `);
  record.totalHeight = totalHeight;
  record.pages = pageLayout(totalHeight, record.options.width);
  return record;
}

function rememberRecord(record) {
  renderRecords.delete(record.revision);
  renderRecords.set(record.revision, record);
  while (renderRecords.size > MAX_RENDER_RECORDS) {
    const oldestRevision = renderRecords.keys().next().value;
    renderRecords.delete(oldestRevision);
  }
}

async function renderPreview(request) {
  const built = buildDocument(request);
  const existing = renderRecords.get(built.revision);
  if (existing?.pages?.length) return existing;

  const record = {
    ...built,
    source: String(request.source ?? ""),
    sourceFormat: request.sourceFormat,
    images: undefined,
    pngBuffers: undefined,
    pages: [],
    totalHeight: 0,
  };
  await runInRenderQueue(() => measureRecord(record));
  rememberRecord(record);
  return record;
}

async function captureRecord(record) {
  if (record.images?.length === record.pages.length) return record.images;

  return runInRenderQueue(async () => {
    if (record.images?.length === record.pages.length) return record.images;
    const window =
      loadedRenderRevision === record.revision
        ? createRenderWindow(record.options.width)
        : await loadRenderRecord(record);
    const images = [];

    for (const page of record.pages) {
      window.setContentSize(page.width, page.height);
      await window.webContents.executeJavaScript(`
        window.scrollTo(0, ${page.y});
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
      `);
      const captured = await window.webContents.capturePage({
        x: 0,
        y: 0,
        width: page.width,
        height: page.height,
      });
      const capturedSize = captured.getSize();
      const image =
        capturedSize.width === page.width &&
        capturedSize.height === page.height
          ? captured
          : captured.resize({
              width: page.width,
              height: page.height,
              quality: "best",
            });
      const size = image.getSize();
      if (size.width !== page.width || size.height !== page.height) {
        throw new Error(
          `图片尺寸异常：预期 ${page.width}×${page.height}，实际 ${size.width}×${size.height}`,
        );
      }
      images.push(image);
    }
    record.images = images;
    return images;
  });
}

async function optimizedPagePng(record, pageIndex, image) {
  record.pngBuffers ??= [];
  if (record.pngBuffers[pageIndex]) return record.pngBuffers[pageIndex];
  const optimized = await optimizePngLossless(image.toPNG());
  record.pngBuffers[pageIndex] = optimized;
  return optimized;
}

async function copyPageImage(record, pageIndex, image) {
  const png = await optimizedPagePng(record, pageIndex, image);
  const clipboardImage = nativeImage.createFromBuffer(png);
  if (clipboardImage.isEmpty()) throw new Error("压缩后的图片无法读取");
  clipboard.writeImage(clipboardImage);
}

function publicRecord(record) {
  return {
    revision: record.revision,
    options: record.options,
    totalHeight: record.totalHeight,
    pages: record.pages,
    previewHtml: record.html,
  };
}

function readClipboardPayload() {
  const html = clipboard.readHTML().trim();
  const text = clipboard.readText().trim();
  const hasUsableHtml =
    html && detectSourceFormat(html, "auto") === "html";

  if (hasUsableHtml) {
    return {
      format: "html",
      text,
      html,
    };
  }
  return {
    format: text ? "markdown" : "plain",
    text,
    html: "",
  };
}

function sourceFromClipboard(payload) {
  return payload.format === "html" && payload.html
    ? payload.html
    : payload.text;
}

function documentLibrarySnapshot() {
  const library = documentLibrary?.snapshot() || {
    opened: [],
    recent: [],
  };
  return {
    instant: { ...instantDocument },
    ...library,
  };
}

function sendToMainWindow(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function markdownPathsFromArguments(argv = []) {
  return argv.filter(
    (argument) => path.isAbsolute(argument) && isMarkdownPath(argument),
  );
}

async function openDocumentPaths(
  filePaths,
  { showWindow = false, notify = true } = {},
) {
  if (!documentLibrary) {
    pendingOpenPaths.push(...filePaths.filter(isMarkdownPath));
    return { documents: [], errors: [] };
  }
  const result = await documentLibrary.openPaths(filePaths);
  if (showWindow) showMainWindow();
  if (notify && (result.documents.length || result.errors.length)) {
    sendToMainWindow("documents:opened", {
      ...result,
      library: documentLibrarySnapshot(),
    });
  }
  return result;
}

async function openMarkdownDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "打开 Markdown",
    filters: [
      {
        name: "Markdown 文档",
        extensions: ["md", "markdown", "mdown"],
      },
    ],
    properties: ["openFile", "multiSelections"],
  });
  if (result.canceled) return { canceled: true, documents: [], errors: [] };
  const opened = await openDocumentPaths(result.filePaths, {
    showWindow: true,
  });
  return { canceled: false, ...opened };
}

async function saveInstantDocument({ source, suggestedName } = {}) {
  const markdownSource = String(source || "");
  if (!markdownSource.trim()) throw new Error("即时内容为空，无法保存");
  const safeName = String(suggestedName || "即时分享.md")
    .replace(/[\\/:*?"<>|]/g, " ")
    .trim();
  const defaultName = /\.m(?:d|arkdown|down)$/i.test(safeName)
    ? safeName
    : `${safeName || "即时分享"}.md`;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "保存 Markdown",
    defaultPath: defaultName,
    filters: [
      {
        name: "Markdown 文档",
        extensions: ["md"],
      },
    ],
    properties: ["createDirectory", "showOverwriteConfirmation"],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  await fs.writeFile(result.filePath, markdownSource, "utf8");
  const opened = await openDocumentPaths([result.filePath], {
    showWindow: true,
  });
  instantDocument = {
    ...instantDocument,
    source: "",
    sourceFormat: "markdown",
    html: "",
  };
  sendToMainWindow("documents:changed", {
    type: "instant-cleared",
    document: { ...instantDocument },
    library: documentLibrarySnapshot(),
  });
  return {
    canceled: false,
    path: result.filePath,
    document: opened.documents[0],
    library: documentLibrarySnapshot(),
  };
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  app.focus({ steal: true });
  mainWindow.show();
  mainWindow.moveTop();
  mainWindow.focus();
}

function hideMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
}

function showHud(message, tone = "success", duration = 1500) {
  clearTimeout(hudTimer);
  if (hudWindow && !hudWindow.isDestroyed()) hudWindow.destroy();

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = 390;
  const height = 66;
  const x = Math.round(
    display.workArea.x + (display.workArea.width - width) / 2,
  );
  const y = display.workArea.y + 20;
  const toneColor =
    tone === "error"
      ? "rgba(181, 43, 43, 0.96)"
      : tone === "info"
        ? "rgba(40, 52, 68, 0.96)"
        : "rgba(28, 42, 57, 0.96)";

  hudWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    resizable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  hudWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });
  hudWindow.loadURL(
    dataUrl(`<!doctype html>
      <html lang="zh-CN">
        <head>
          <meta charset="utf-8">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
          <style>
            * { box-sizing: border-box; }
            html, body { margin: 0; width: 100%; height: 100%; background: transparent; }
            body {
              display: grid;
              place-items: center;
              padding: 8px;
              color: white;
              font: 14px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
            }
            .hud {
              width: 100%;
              padding: 14px 18px;
              text-align: center;
              background: ${toneColor};
              border: 1px solid rgba(255,255,255,.16);
              border-radius: 14px;
              box-shadow: 0 12px 34px rgba(0,0,0,.25);
              backdrop-filter: blur(18px);
            }
          </style>
        </head>
        <body><div class="hud">${escapeHtml(message)}</div></body>
      </html>`),
  );
  hudWindow.once("ready-to-show", () => {
    hudWindow?.showInactive();
  });
  hudTimer = setTimeout(() => {
    if (hudWindow && !hudWindow.isDestroyed()) hudWindow.destroy();
    hudWindow = undefined;
  }, duration);
}

async function quickGenerate() {
  if (quickGenerationRunning) {
    showHud("正在生成，请稍候", "info");
    return { status: "busy", pageCount: 0 };
  }

  const payload = readClipboardPayload();
  const source = sourceFromClipboard(payload);
  if (!source.trim()) {
    showHud("剪贴板中没有可生成的文字", "error", 2200);
    return { status: "empty", pageCount: 0 };
  }

  instantDocument = {
    ...instantDocument,
    source: payload.text || source,
    sourceFormat: payload.format,
    html: payload.format === "html" ? payload.html : "",
  };
  sendToMainWindow("documents:changed", {
    type: "instant-updated",
    document: { ...instantDocument },
    library: documentLibrarySnapshot(),
  });

  quickGenerationRunning = true;
  showHud("正在生成长图…", "info", 5000);
  try {
    const record = await renderPreview({
      source,
      sourceFormat: payload.format,
      title: "",
      ...settings,
    });
    if (record.pages.length > 1) {
      showMainWindow();
      mainWindow.webContents.send("quick:load", {
        source: instantDocument.source,
        sourceFormat: instantDocument.sourceFormat,
        html: payload.html,
        message: `内容已拆成 ${record.pages.length} 页，请选择需要复制的页面`,
      });
      showHud(
        `内容已拆成 ${record.pages.length} 页，请在窗口中选择`,
        "info",
        2600,
      );
      return {
        status: "needs-page-selection",
        pageCount: record.pages.length,
      };
    }

    const images = await captureRecord(record);
    await copyPageImage(record, 0, images[0]);
    showHud("图片已复制，可 Command+V", "success");
    return { status: "copied", pageCount: 1 };
  } catch (error) {
    console.error("Quick generation failed:", error);
    showHud(`生成失败：${error.message}`, "error", 3000);
    return {
      status: "failed",
      pageCount: 0,
      error: error.message,
    };
  } finally {
    quickGenerationRunning = false;
  }
}

function rebuildTrayMenu() {
  if (!tray) return;
  const shortcutLabel = settings.shortcutEnabled
    ? `快捷生成（${settings.accelerator.replaceAll("+", " + ")}）`
    : "快捷生成";
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "打开管理窗口",
        click: showMainWindow,
      },
      {
        label: shortcutLabel,
        click: quickGenerate,
      },
      { type: "separator" },
      {
        label: "启用全局快捷键",
        type: "checkbox",
        checked: settings.shortcutEnabled,
        click: async (menuItem) => {
          const result = await applyShortcutSettings({
            ...settings,
            shortcutEnabled: menuItem.checked,
          });
          if (!result.ok) {
            menuItem.checked = settings.shortcutEnabled;
            showHud("快捷键注册失败，可能已被其他应用占用", "error", 2600);
          }
          mainWindow?.webContents.send("settings:changed", settings);
        },
      },
      { type: "separator" },
      {
        label: "退出",
        accelerator: "Command+Q",
        click: () => app.quit(),
      },
    ]),
  );
}

async function registerAccelerator(accelerator) {
  if (registeredAccelerator === accelerator) {
    return { ok: globalShortcut.isRegistered(accelerator) };
  }

  let registered = false;
  try {
    registered = globalShortcut.register(accelerator, quickGenerate);
  } catch {
    registered = false;
  }
  if (!registered) return { ok: false, conflict: true };

  if (registeredAccelerator) {
    globalShortcut.unregister(registeredAccelerator);
  }
  registeredAccelerator = accelerator;
  return { ok: true };
}

async function applyShortcutSettings(nextInput) {
  const next = normalizeSettings(nextInput);
  if (next.shortcutEnabled) {
    const result = await registerAccelerator(next.accelerator);
    if (!result.ok) {
      rebuildTrayMenu();
      return {
        ...result,
        settings,
      };
    }
  } else if (registeredAccelerator) {
    globalShortcut.unregister(registeredAccelerator);
    registeredAccelerator = "";
  }

  settings = await saveSettings(settingsPath, next);
  rebuildTrayMenu();
  return { ok: true, settings };
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle("MS", { fontType: "monospaced" });
  tray.setToolTip("MarkShot");
  rebuildTrayMenu();
}

function createDockMenu() {
  if (!app.dock) return;
  app.dock.setMenu(
    Menu.buildFromTemplate([
      {
        label: "打开管理窗口",
        click: showMainWindow,
      },
      {
        label: "用剪贴板快速生成",
        click: quickGenerate,
      },
      { type: "separator" },
      {
        label: "退出 MarkShot",
        click: () => app.quit(),
      },
    ]),
  );
}

function createApplicationMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "MarkShot",
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "文件",
        submenu: [
          {
            label: "打开 Markdown…",
            accelerator: "Command+O",
            click: () => openMarkdownDialog().catch(console.error),
          },
          { type: "separator" },
          { role: "close" },
        ],
      },
      {
        label: "编辑",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "窗口",
        submenu: [
          { role: "minimize" },
          { role: "zoom" },
          { type: "separator" },
          { role: "front" },
        ],
      },
    ]),
  );
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 820,
    minWidth: 1120,
    minHeight: 650,
    show: false,
    title: "MarkShot",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 22 },
    backgroundColor: "#f5f7fa",
    webPreferences: {
      preload: path.join(SOURCE_DIR, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(UI_DIR, "index.html"));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    hideMainWindow();
  });
  mainWindow.on("minimize", (event) => {
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
}

function registerIpc() {
  ipcMain.handle("clipboard:read", () => readClipboardPayload());

  ipcMain.handle("preview:render", async (_event, request) => {
    const record = await renderPreview(request);
    return publicRecord(record);
  });

  ipcMain.handle("page:copy", async (_event, { revision, pageIndex }) => {
    const record = renderRecords.get(revision);
    if (!record) throw new Error("预览已过期，请重新生成");
    const images = await captureRecord(record);
    const image = images[pageIndex];
    if (!image) throw new Error("没有找到对应页面");
    await copyPageImage(record, pageIndex, image);
    return {
      ok: true,
      width: record.pages[pageIndex].width,
      height: record.pages[pageIndex].height,
    };
  });

  ipcMain.handle(
    "page:export",
    async (_event, { revision, pageIndex, suggestedName }) => {
      const record = renderRecords.get(revision);
      if (!record) throw new Error("预览已过期，请重新生成");
      const fallbackName = suggestedFileName(
        record.title,
        pageIndex,
        record.pages.length,
      );
      const result = await dialog.showSaveDialog(mainWindow, {
        title: "导出长图",
        defaultPath: suggestedName || fallbackName,
        filters: [{ name: "PNG 图片", extensions: ["png"] }],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
      if (result.canceled || !result.filePath) return { canceled: true };

      const images = await captureRecord(record);
      const image = images[pageIndex];
      if (!image) throw new Error("没有找到对应页面");
      const png = await optimizedPagePng(record, pageIndex, image);
      await fs.writeFile(result.filePath, png);
      return { canceled: false, path: result.filePath };
    },
  );

  ipcMain.handle("quick:generate", () => quickGenerate());
  ipcMain.handle("settings:get", () => settings);
  ipcMain.handle("settings:update", (_event, next) =>
    applyShortcutSettings({ ...settings, ...next }),
  );
  ipcMain.handle("shortcut:register", (_event, accelerator) =>
    applyShortcutSettings({
      ...settings,
      shortcutEnabled: true,
      accelerator,
    }),
  );
  ipcMain.handle("documents:get", () => documentLibrarySnapshot());
  ipcMain.handle("documents:open", () => openMarkdownDialog());
  ipcMain.handle("documents:open-recent", async (_event, filePath) => {
    const result = await openDocumentPaths([filePath], {
      showWindow: true,
    });
    return {
      ...result,
      library: documentLibrarySnapshot(),
    };
  });
  ipcMain.handle("documents:open-paths", async (_event, filePaths) => {
    const result = await openDocumentPaths(filePaths, {
      showWindow: true,
    });
    return {
      ...result,
      library: documentLibrarySnapshot(),
    };
  });
  ipcMain.handle("documents:save-instant", (_event, request) =>
    saveInstantDocument(request),
  );
  ipcMain.handle("documents:update-instant", (_event, next) => {
    instantDocument = {
      ...instantDocument,
      source: String(next?.source || ""),
      sourceFormat:
        next?.sourceFormat === "html"
          ? "html"
          : next?.sourceFormat === "plain"
            ? "plain"
            : "markdown",
      html: next?.sourceFormat === "html" ? String(next?.html || "") : "",
    };
    return { ...instantDocument };
  });
  ipcMain.handle("documents:close", (_event, documentId) => {
    documentLibrary?.closeDocument(documentId);
    return documentLibrarySnapshot();
  });
  ipcMain.handle("documents:remove-recent", async (_event, filePath) => {
    await documentLibrary?.removeRecent(filePath);
    return documentLibrarySnapshot();
  });
  ipcMain.on("window:hide", hideMainWindow);
  ipcMain.on("app:quit", () => app.quit());
}

if (gotSingleInstanceLock) {
  app.on("second-instance", (_event, argv) => {
    const filePaths = markdownPathsFromArguments(argv);
    if (filePaths.length) {
      openDocumentPaths(filePaths, { showWindow: true }).catch(console.error);
    } else {
      showMainWindow();
    }
  });
  app.on("activate", showMainWindow);
  app.on("window-all-closed", () => {
    // Keep the tray process alive until the user explicitly quits.
  });
  app.on("before-quit", () => {
    isQuitting = true;
  });
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    documentLibrary?.dispose();
    clearTimeout(hudTimer);
  });

  app.whenReady().then(async () => {
    app.setActivationPolicy("regular");
    settingsPath = path.join(app.getPath("userData"), "settings.json");
    recentDocumentsPath = path.join(
      app.getPath("userData"),
      "recent-documents.json",
    );
    settings = await loadSettings(settingsPath);
    documentLibrary = new DocumentLibrary({
      recentPath: recentDocumentsPath,
      onEvent: (payload) => {
        sendToMainWindow("documents:changed", {
          ...payload,
          library: documentLibrarySnapshot(),
        });
      },
    });
    await documentLibrary.initialize();
    pendingOpenPaths.push(...markdownPathsFromArguments(process.argv.slice(1)));
    if (pendingOpenPaths.length) {
      const queuedPaths = [...new Set(pendingOpenPaths)];
      pendingOpenPaths.length = 0;
      await openDocumentPaths(queuedPaths, {
        notify: false,
      });
    }
    registerIpc();
    createTray();
    createDockMenu();
    createApplicationMenu();
    createMainWindow();
    if (settings.shortcutEnabled) {
      const result = await registerAccelerator(settings.accelerator);
      if (!result.ok) {
        settings.shortcutEnabled = false;
        settings = await saveSettings(settingsPath, settings);
        rebuildTrayMenu();
        showHud("默认快捷键注册失败，请在设置中重新选择", "error", 3000);
      }
    }
  });
}
