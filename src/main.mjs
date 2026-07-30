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
  shell,
  Tray,
} from "electron";
import {
  buildDocument,
  detectSourceFormat,
  extractDiagramBlocks,
  imageLayout,
  MAX_IMAGE_COLUMNS,
  normalizeRenderOptions,
  suggestedFileName,
} from "./rendering.mjs";
import {
  diagramCacheKey,
  diagramErrorFigure,
  diagramFigure,
  DIAGRAM_RENDER_TIMEOUT_MS,
  DIAGRAM_RENDERER_REVISION,
  MAX_DIAGRAM_SOURCE_LENGTH,
  MAX_DIAGRAMS_PER_DOCUMENT,
} from "./diagrams.mjs";
import {
  DocumentLibrary,
  isMarkdownPath,
  suggestedMarkdownFileName,
} from "./documents.mjs";
import {
  createLocalizedError,
  normalizeLanguage,
  translate,
} from "./i18n.mjs";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from "./settings.mjs";
import { composePngColumns, optimizePngLossless } from "./png.mjs";

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(SOURCE_DIR, "ui");
const MAX_RENDER_RECORDS = 5;

let mainWindow;
let renderWindow;
let diagramWindow;
let diagramWindowReady;
let tray;
let trayMenu;
let trayClickTimer;
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
let renderCaptureScaleFactor = 1;
const renderRecords = new Map();
const diagramCache = new Map();
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

function t(key, values = {}) {
  return translate(normalizeLanguage(settings.language), key, values);
}

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

async function createDiagramWindow() {
  if (diagramWindow && !diagramWindow.isDestroyed()) {
    await diagramWindowReady;
    return diagramWindow;
  }
  diagramWindow = new BrowserWindow({
    show: false,
    frame: false,
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(SOURCE_DIR, "diagram-preload.cjs"),
      partition: "markshot-diagrams",
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  diagramWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  diagramWindow.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  diagramWindow.webContents.session.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ftp://*/*"] },
    (_details, callback) => callback({ cancel: true }),
  );
  diagramWindow.on("closed", () => {
    diagramWindow = undefined;
    diagramWindowReady = undefined;
  });
  diagramWindowReady = diagramWindow.loadFile(
    path.join(SOURCE_DIR, "diagram-host.html"),
  );
  await diagramWindowReady;
  return diagramWindow;
}

function rememberDiagram(key, html) {
  diagramCache.delete(key);
  diagramCache.set(key, html);
  while (diagramCache.size > 100) {
    diagramCache.delete(diagramCache.keys().next().value);
  }
}

async function renderDiagramBlock(block, options) {
  const key = diagramCacheKey(block, options);
  if (diagramCache.has(key)) return diagramCache.get(key);
  if (block.source.length > MAX_DIAGRAM_SOURCE_LENGTH) {
    throw new Error(
      `Diagram source exceeds ${MAX_DIAGRAM_SOURCE_LENGTH} characters`,
    );
  }

  const window = await createDiagramWindow();
  const payload = {
    id: key.slice(0, 16),
    type: block.type,
    source: block.source,
    theme: options.theme,
    width: Math.max(
      240,
      options.width -
        options.padding * 2 -
        Math.round(options.padding * 1.18) * 2,
    ),
  };
  let timer;
  try {
    const svg = await Promise.race([
      window.webContents.executeJavaScript(
        `window.markshotDiagramHost.render(${JSON.stringify(payload)})`,
      ),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Diagram rendering timed out")),
          DIAGRAM_RENDER_TIMEOUT_MS,
        );
      }),
    ]);
    const html = diagramFigure(block.type, svg);
    rememberDiagram(key, html);
    return html;
  } catch (error) {
    if (error.message === "Diagram rendering timed out") {
      diagramWindow?.destroy();
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function renderDiagramBlocks(blocks, options) {
  const html = [];
  for (const block of blocks) {
    if (block.index >= MAX_DIAGRAMS_PER_DOCUMENT) {
      html.push(
        diagramErrorFigure(
          options.language,
          block,
          options.language === "en"
            ? `A document can contain at most ${MAX_DIAGRAMS_PER_DOCUMENT} diagrams`
            : `一个文档最多支持 ${MAX_DIAGRAMS_PER_DOCUMENT} 个图表`,
        ),
      );
      continue;
    }
    try {
      html.push(await renderDiagramBlock(block, options));
    } catch (error) {
      console.error(`Failed to render ${block.type} diagram:`, error);
      html.push(diagramErrorFigure(options.language, block, error.message));
    }
  }
  return html;
}

function createRenderWindow(width = 1080) {
  if (renderWindow && !renderWindow.isDestroyed()) return renderWindow;
  renderCaptureScaleFactor = Math.max(
    1,
    Number(screen.getPrimaryDisplay()?.scaleFactor) || 1,
  );
  renderWindow = new BrowserWindow({
    show: false,
    frame: false,
    transparent: false,
    useContentSize: true,
    width: Math.ceil(width / renderCaptureScaleFactor),
    height: 100,
    webPreferences: {
      offscreen: true,
      zoomFactor: 1 / renderCaptureScaleFactor,
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
  window.setContentSize(
    Math.ceil(record.options.width / renderCaptureScaleFactor),
    100,
  );
  await window.loadURL(dataUrl(record.html));
  window.webContents.setZoomFactor(1 / renderCaptureScaleFactor);
  await waitForRenderedContent(window);
  loadedRenderRevision = record.revision;
  return window;
}

async function measureRecord(record) {
  const window = await loadRenderRecord(record);
  const measurement = await window.webContents.executeJavaScript(`
    (() => {
      const totalHeight = Math.ceil(Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      document.documentElement.offsetHeight,
      document.body.offsetHeight
      ));
      const candidates = [];
      const seen = new Set();
      const add = (element, kind, level = 7) => {
        if (!element) return;
        const y = Math.round(element.getBoundingClientRect().top + window.scrollY);
        if (y <= 0 || y >= totalHeight || seen.has(y)) return;
        seen.add(y);
        candidates.push({ y, kind, level });
      };
      document.querySelectorAll(".content h1, .content h2, .content h3, .content h4, .content h5, .content h6")
        .forEach((element) => add(
          element,
          "heading",
          Number(element.tagName.slice(1)) || 6
        ));
      document.querySelectorAll(".content > *")
        .forEach((element) => add(element, "block"));
      add(document.querySelector(".footer"), "block");
      return { totalHeight, candidates };
    })()
  `);
  record.totalHeight = measurement.totalHeight;
  const layout = imageLayout(
    measurement.totalHeight,
    record.options.width,
    measurement.candidates,
  );
  record.pages = layout.pages;
  record.layout = {
    columnCount: layout.columnCount,
    tooLong: layout.tooLong,
    outputWidth: layout.outputWidth,
    outputHeight: layout.outputHeight,
  };
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
  const options = normalizeRenderOptions(request);
  const prepared = extractDiagramBlocks(request.source, request.sourceFormat);
  const diagramHtml = await renderDiagramBlocks(prepared.diagrams, options);
  const built = buildDocument({
    ...request,
    preparedSource: prepared.source,
    diagramHtml,
    diagramRevision: DIAGRAM_RENDERER_REVISION,
  });
  const existing = renderRecords.get(built.revision);
  if (existing?.pages?.length) return existing;

  const record = {
    ...built,
    source: String(request.source ?? ""),
    sourceFormat: request.sourceFormat,
    images: undefined,
    pngBuffers: undefined,
    outputPng: undefined,
    pages: [],
    layout: undefined,
    totalHeight: 0,
  };
  await runInRenderQueue(() => measureRecord(record));
  rememberRecord(record);
  return record;
}

function waitForNextPaint(window, timeout = 800) {
  return new Promise((resolve) => {
    let timer;
    const finish = () => {
      clearTimeout(timer);
      window.webContents.removeListener("paint", finish);
      resolve();
    };
    window.webContents.once("paint", finish);
    timer = setTimeout(finish, timeout);
    window.webContents.invalidate();
  });
}

async function capturePageWithRetry(window, page) {
  let actual = "0×0";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const captureWidth = Math.ceil(page.width / renderCaptureScaleFactor);
    const captureHeight = Math.ceil(page.height / renderCaptureScaleFactor);
    window.setContentSize(captureWidth, captureHeight);
    await window.webContents.executeJavaScript(`
      window.scrollTo(0, ${page.y});
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
    `);
    await waitForNextPaint(window);
    const captured = await window.webContents.capturePage(
      {
        x: 0,
        y: 0,
        width: captureWidth,
        height: captureHeight,
      },
      { stayHidden: true, stayAwake: true },
    );
    const size = captured.getSize();
    actual = `${size.width}×${size.height}`;
    if (size.width === page.width && size.height === page.height) {
      return captured;
    }
    if (
      size.width >= page.width &&
      size.height >= page.height &&
      size.width - page.width <= Math.ceil(renderCaptureScaleFactor) &&
      size.height - page.height <= Math.ceil(renderCaptureScaleFactor)
    ) {
      return captured.crop({
        x: 0,
        y: 0,
        width: page.width,
        height: page.height,
      });
    }
    if (size.width > 0 && size.height > 0) {
      const resized = captured.resize({
        width: page.width,
        height: page.height,
        quality: "best",
      });
      const resizedSize = resized.getSize();
      actual = `${resizedSize.width}×${resizedSize.height}`;
      if (
        resizedSize.width === page.width &&
        resizedSize.height === page.height
      ) {
        return resized;
      }
    }
    if (attempt < 2) {
      await new Promise((resolve) =>
        setTimeout(resolve, 80 * 2 ** attempt),
      );
    }
  }
  throw createLocalizedError(settings.language, "error.invalidImageSize", {
    expected: `${page.width}×${page.height}`,
    actual,
  });
}

async function capturePageWithDebugger(debuggerSession, page) {
  let actual = "0×0";
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const capturePadding =
        attempt === 0 ? 0 : Math.ceil(renderCaptureScaleFactor);
      const result = await debuggerSession.sendCommand(
        "Page.captureScreenshot",
        {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: true,
          clip: {
            x: 0,
            y: page.y / renderCaptureScaleFactor,
            width:
              (page.width + capturePadding) /
              renderCaptureScaleFactor,
            height:
              (page.height + capturePadding) /
              renderCaptureScaleFactor,
            scale: 1,
          },
        },
      );
      const captured = nativeImage.createFromBuffer(
        Buffer.from(result.data, "base64"),
      );
      const size = captured.getSize();
      actual = `${size.width}×${size.height}`;
      if (size.width === page.width && size.height === page.height) {
        return captured;
      }
      if (
        size.width >= page.width &&
        size.height >= page.height &&
        size.width - page.width <= Math.ceil(renderCaptureScaleFactor) &&
        size.height - page.height <= Math.ceil(renderCaptureScaleFactor)
      ) {
        return captured.crop({
          x: 0,
          y: 0,
          width: page.width,
          height: page.height,
        });
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < 2) {
      await new Promise((resolve) =>
        setTimeout(resolve, 80 * 2 ** attempt),
      );
    }
  }
  if (actual === "0×0" && lastError) throw lastError;
  throw createLocalizedError(settings.language, "error.invalidImageSize", {
    expected: `${page.width}×${page.height}`,
    actual,
  });
}

async function captureRecordPages(window, pages) {
  const debuggerSession = window.webContents.debugger;
  const attachedHere = !debuggerSession.isAttached();
  if (attachedHere) debuggerSession.attach("1.3");
  try {
    await debuggerSession.sendCommand("Page.enable");
    const images = [];
    for (const page of pages) {
      images.push(await capturePageWithDebugger(debuggerSession, page));
    }
    return images;
  } catch (error) {
    if (pages.length > 1) throw error;
    return [await capturePageWithRetry(window, pages[0])];
  } finally {
    if (attachedHere && debuggerSession.isAttached()) {
      debuggerSession.detach();
    }
  }
}

async function captureRecord(record) {
  if (record.images?.length === record.pages.length) return record.images;
  if (record.layout?.tooLong) {
    throw createLocalizedError(settings.language, "error.tooManyColumns", {
      count: record.pages.length,
      max: MAX_IMAGE_COLUMNS,
    });
  }

  return runInRenderQueue(async () => {
    if (record.images?.length === record.pages.length) return record.images;
    const window =
      loadedRenderRevision === record.revision
        ? createRenderWindow(record.options.width)
        : await loadRenderRecord(record);
    const images = await captureRecordPages(window, record.pages);
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

async function finalOutputPng(record, images) {
  if (record.outputPng) return record.outputPng;
  if (images.length === 1) {
    record.outputPng = await optimizedPagePng(record, 0, images[0]);
    return record.outputPng;
  }
  const columns = [];
  for (let index = 0; index < images.length; index += 1) {
    columns.push(await optimizedPagePng(record, index, images[index]));
  }
  record.outputPng = await composePngColumns(columns);
  return record.outputPng;
}

async function copyOutputImage(record, images) {
  const png = await finalOutputPng(record, images);
  const clipboardImage = nativeImage.createFromBuffer(png);
  if (clipboardImage.isEmpty()) {
    throw createLocalizedError(
      settings.language,
      "error.invalidCompressedImage",
    );
  }
  const size = clipboardImage.getSize();
  if (
    size.width !== record.layout.outputWidth ||
    size.height !== record.layout.outputHeight
  ) {
    throw createLocalizedError(settings.language, "error.invalidImageSize", {
      expected: `${record.layout.outputWidth}×${record.layout.outputHeight}`,
      actual: `${size.width}×${size.height}`,
    });
  }
  clipboard.writeImage(clipboardImage);
}

function publicRecord(record) {
  return {
    revision: record.revision,
    options: record.options,
    totalHeight: record.totalHeight,
    pages: record.pages,
    layout: record.layout,
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
    instant: {
      ...instantDocument,
      name: t("instant.title"),
    },
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
    title: t("dialog.openMarkdown"),
    filters: [
      {
        name: t("dialog.markdownDocument"),
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

async function saveInstantDocument({ source } = {}) {
  const markdownSource = String(source || "");
  if (!markdownSource.trim()) {
    throw createLocalizedError(settings.language, "error.emptyInstant");
  }
  const result = await dialog.showSaveDialog(mainWindow, {
    title: t("dialog.saveMarkdown"),
    defaultPath: suggestedMarkdownFileName(markdownSource),
    filters: [
      {
        name: t("dialog.markdownDocument"),
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
  void app.dock?.show();
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
  const width = settings.language === "en" ? 490 : 420;
  const height = 58;
  const x = Math.round(
    display.workArea.x + (display.workArea.width - width) / 2,
  );
  const y = display.workArea.y + 20;
  const toneStyle =
    tone === "error"
      ? {
          color: "#ff6961",
          background: "rgba(255, 69, 58, 0.18)",
          glyph: "!",
        }
      : tone === "info"
        ? {
            color: "#64a8ff",
            background: "rgba(10, 132, 255, 0.2)",
            glyph: "…",
          }
        : {
            color: "#4ee06f",
            background: "rgba(48, 209, 88, 0.18)",
            glyph: "✓",
          };

  hudWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    show: false,
    frame: false,
    type: "panel",
    transparent: false,
    backgroundColor: "#00000000",
    vibrancy: "hud",
    visualEffectState: "active",
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    roundedCorners: true,
    resizable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  hudWindow.setIgnoreMouseEvents(true);
  hudWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });
  hudWindow.loadURL(
    dataUrl(`<!doctype html>
      <html lang="${normalizeLanguage(settings.language)}">
        <head>
          <meta charset="utf-8">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
          <style>
            * { box-sizing: border-box; }
            html, body {
              margin: 0;
              width: 100%;
              height: 100%;
              overflow: hidden;
              background: transparent;
            }
            body {
              color: rgba(255, 255, 255, 0.96);
              font: 13px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
              user-select: none;
            }
            .hud {
              width: 100%;
              height: 100%;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 10px;
              padding: 0 18px;
              background: rgba(18, 22, 30, 0.34);
              border: 1px solid rgba(255, 255, 255, 0.2);
              border-radius: 12px;
              animation: hud-in 140ms cubic-bezier(.2, .8, .2, 1);
            }
            .status {
              width: 21px;
              height: 21px;
              flex: 0 0 21px;
              display: grid;
              place-items: center;
              color: ${toneStyle.color};
              background: ${toneStyle.background};
              border: 1px solid color-mix(in srgb, ${toneStyle.color} 48%, transparent);
              border-radius: 50%;
              font-size: 13px;
              font-weight: 700;
              line-height: 1;
            }
            .message {
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }
            @keyframes hud-in {
              from {
                opacity: 0;
                transform: translateY(-4px) scale(.985);
              }
              to {
                opacity: 1;
                transform: translateY(0) scale(1);
              }
            }
          </style>
        </head>
        <body>
          <div class="hud" role="status">
            <span class="status" aria-hidden="true">${toneStyle.glyph}</span>
            <span class="message">${escapeHtml(message)}</span>
          </div>
        </body>
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
    showHud(t("hud.busy"), "info");
    return { status: "busy", pageCount: 0 };
  }

  const payload = readClipboardPayload();
  const source = sourceFromClipboard(payload);
  if (!source.trim()) {
    showHud(t("hud.clipboardEmpty"), "error", 2200);
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
  showHud(t("hud.generating"), "info", 5000);
  try {
    const record = await renderPreview({
      source,
      sourceFormat: payload.format,
      title: "",
      ...settings,
    });
    if (record.layout.tooLong) {
      showMainWindow();
      mainWindow.webContents.send("quick:load", {
        source: instantDocument.source,
        sourceFormat: instantDocument.sourceFormat,
        html: payload.html,
        message: t("error.tooManyColumns", {
          count: record.pages.length,
          max: MAX_IMAGE_COLUMNS,
        }),
      });
      showHud(
        t("error.tooManyColumns", {
          count: record.pages.length,
          max: MAX_IMAGE_COLUMNS,
        }),
        "error",
        3000,
      );
      return {
        status: "too-long",
        pageCount: record.pages.length,
      };
    }

    const images = await captureRecord(record);
    await copyOutputImage(record, images);
    showHud(t("hud.copied"), "success");
    return { status: "copied", pageCount: record.pages.length };
  } catch (error) {
    console.error("Quick generation failed:", error);
    showHud(
      t("toast.generateFailed", { message: error.message }),
      "error",
      3000,
    );
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
    ? `${t("menu.quickGenerate")}（${settings.accelerator.replaceAll("+", " + ")}）`
    : t("menu.quickGenerate");
  trayMenu = Menu.buildFromTemplate([
    {
      label: t("menu.openManager"),
      click: showMainWindow,
    },
    {
      label: shortcutLabel,
      click: quickGenerate,
    },
    { type: "separator" },
    {
      label: t("menu.enableShortcut"),
      type: "checkbox",
      checked: settings.shortcutEnabled,
      click: async (menuItem) => {
        const result = await applyShortcutSettings({
          ...settings,
          shortcutEnabled: menuItem.checked,
        });
        if (!result.ok) {
          menuItem.checked = settings.shortcutEnabled;
          showHud(t("hud.shortcutConflict"), "error", 2600);
        }
        mainWindow?.webContents.send("settings:changed", settings);
      },
    },
    { type: "separator" },
    {
      label: t("menu.quit"),
      accelerator: "Command+Q",
      click: () => app.quit(),
    },
  ]);
}

function cancelTrayMenuPopup() {
  clearTimeout(trayClickTimer);
  trayClickTimer = undefined;
}

function scheduleTrayMenuPopup() {
  cancelTrayMenuPopup();
  trayClickTimer = setTimeout(() => {
    trayClickTimer = undefined;
    if (tray && !tray.isDestroyed() && trayMenu) {
      tray.popUpContextMenu(trayMenu);
    }
  }, 300);
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
  const shortcutChanged =
    next.shortcutEnabled !== settings.shortcutEnabled ||
    next.accelerator !== settings.accelerator;
  if (shortcutChanged && next.shortcutEnabled) {
    const result = await registerAccelerator(next.accelerator);
    if (!result.ok) {
      settings = await saveSettings(settingsPath, {
        ...next,
        shortcutEnabled: settings.shortcutEnabled,
        accelerator: settings.accelerator,
      });
      rebuildNativeMenus();
      return {
        ...result,
        settings,
      };
    }
  } else if (shortcutChanged && registeredAccelerator) {
    globalShortcut.unregister(registeredAccelerator);
    registeredAccelerator = "";
  }

  settings = await saveSettings(settingsPath, next);
  rebuildNativeMenus();
  return { ok: true, settings };
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle("MS", { fontType: "monospaced" });
  tray.setToolTip("MarkShot");
  tray.setIgnoreDoubleClickEvents(false);
  tray.on("click", scheduleTrayMenuPopup);
  tray.on("right-click", () => {
    cancelTrayMenuPopup();
    if (trayMenu) tray.popUpContextMenu(trayMenu);
  });
  tray.on("double-click", () => {
    cancelTrayMenuPopup();
    showMainWindow();
  });
  rebuildTrayMenu();
}

function createDockMenu() {
  if (!app.dock) return;
  app.dock.setMenu(
    Menu.buildFromTemplate([
      {
        label: t("menu.openManager"),
        click: showMainWindow,
      },
      {
        label: t("menu.quickGenerateClipboard"),
        click: quickGenerate,
      },
      { type: "separator" },
      {
        label: t("menu.quitMarkShot"),
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
          { label: t("menu.about"), role: "about" },
          { type: "separator" },
          { label: t("menu.hide"), role: "hide" },
          { label: t("menu.hideOthers"), role: "hideOthers" },
          { label: t("menu.showAll"), role: "unhide" },
          { type: "separator" },
          { label: t("menu.quitMarkShot"), role: "quit" },
        ],
      },
      {
        label: t("menu.file"),
        submenu: [
          {
            label: t("menu.openMarkdown"),
            accelerator: "Command+O",
            click: () => openMarkdownDialog().catch(console.error),
          },
          { type: "separator" },
          { label: t("menu.close"), role: "close" },
        ],
      },
      {
        label: t("menu.edit"),
        submenu: [
          { label: t("menu.undo"), role: "undo" },
          { label: t("menu.redo"), role: "redo" },
          { type: "separator" },
          { label: t("menu.cut"), role: "cut" },
          { label: t("menu.copy"), role: "copy" },
          { label: t("menu.paste"), role: "paste" },
          { label: t("menu.selectAll"), role: "selectAll" },
        ],
      },
      {
        label: t("menu.window"),
        submenu: [
          { label: t("menu.minimize"), role: "minimize" },
          { label: t("menu.zoom"), role: "zoom" },
          { type: "separator" },
          { label: t("menu.bringAllToFront"), role: "front" },
        ],
      },
    ]),
  );
}

function rebuildNativeMenus() {
  rebuildTrayMenu();
  createDockMenu();
  createApplicationMenu();
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
    app.dock?.hide();
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

  ipcMain.handle("page:copy", async (_event, { revision }) => {
    const record = renderRecords.get(revision);
    if (!record) {
      throw createLocalizedError(settings.language, "error.previewExpired");
    }
    const images = await captureRecord(record);
    await copyOutputImage(record, images);
    return {
      ok: true,
      width: record.layout.outputWidth,
      height: record.layout.outputHeight,
      columnCount: record.layout.columnCount,
    };
  });

  ipcMain.handle(
    "page:export",
    async (_event, { revision, suggestedName }) => {
      const record = renderRecords.get(revision);
      if (!record) {
        throw createLocalizedError(settings.language, "error.previewExpired");
      }
      if (record.layout.tooLong) {
        throw createLocalizedError(settings.language, "error.tooManyColumns", {
          count: record.pages.length,
          max: MAX_IMAGE_COLUMNS,
        });
      }
      const fallbackName = suggestedFileName(record.title);
      const result = await dialog.showSaveDialog(mainWindow, {
        title: t("dialog.exportImage"),
        defaultPath: suggestedName || fallbackName,
        filters: [{ name: t("dialog.pngImage"), extensions: ["png"] }],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
      if (result.canceled || !result.filePath) return { canceled: true };

      const images = await captureRecord(record);
      const png = await finalOutputPng(record, images);
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
  ipcMain.handle("documents:show-in-folder", (_event, filePath) => {
    const target = path.resolve(String(filePath || ""));
    const snapshot = documentLibrarySnapshot();
    const known = [...snapshot.opened, ...snapshot.recent].some(
      (record) => record.path === target,
    );
    if (!known) {
      throw createLocalizedError(
        settings.language,
        "error.unknownDocumentPath",
      );
    }
    shell.showItemInFolder(target);
    return { ok: true };
  });
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
    cancelTrayMenuPopup();
    renderWindow?.destroy();
    diagramWindow?.destroy();
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
      getLanguage: () => settings.language,
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
        rebuildNativeMenus();
        showHud(t("hud.defaultShortcutConflict"), "error", 3000);
      }
    }
  });
}
