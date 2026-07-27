const api = window.replyImage;

const PROFILE_LABELS = {
  mobile: "移动端",
  desktop: "PC",
};

const elements = {
  app: document.getElementById("app"),
  instantContent: document.getElementById("instant-content"),
  clear: document.getElementById("clear-content"),
  paste: document.getElementById("paste-content"),
  saveInstant: document.getElementById("save-instant"),
  openDocument: document.getElementById("open-document"),
  openedDocuments: document.getElementById("opened-documents"),
  recentDocuments: document.getElementById("recent-documents"),
  recentCount: document.getElementById("recent-count"),
  documentTitle: document.getElementById("document-title"),
  documentPath: document.getElementById("document-path"),
  contentScroll: document.getElementById("content-scroll"),
  previewHost: document.getElementById("preview-host"),
  splitHost: document.getElementById("split-host"),
  splitSource: document.getElementById("split-source"),
  sourceContent: document.getElementById("source-content"),
  emptyState: document.getElementById("empty-state"),
  outlineList: document.getElementById("outline-list"),
  outlineStatus: document.getElementById("outline-status"),
  toggleSidebar: document.getElementById("toggle-sidebar"),
  toggleStyle: document.getElementById("toggle-style"),
  profile: document.querySelectorAll('input[name="profile"]'),
  theme: document.querySelectorAll('input[name="theme"]'),
  background: document.querySelectorAll('input[name="background"]'),
  titleEnabled: document.getElementById("title-enabled"),
  imageTitle: document.getElementById("image-title"),
  showFooter: document.getElementById("show-footer"),
  previewPage: document.getElementById("preview-page"),
  copyPreview: document.getElementById("copy-preview"),
  shareToggle: document.getElementById("share-menu-toggle"),
  shareMenu: document.getElementById("share-menu"),
  exportPreview: document.getElementById("export-preview"),
  statusOrigin: document.getElementById("status-origin"),
  statusView: document.getElementById("status-view"),
  statusProfile: document.getElementById("status-profile"),
  statusPages: document.getElementById("status-pages"),
  openSettings: document.getElementById("open-settings"),
  closeSettings: document.getElementById("close-settings"),
  settingsModal: document.getElementById("settings-modal"),
  shortcutEnabled: document.getElementById("shortcut-enabled"),
  accelerator: document.getElementById("accelerator"),
  applyShortcut: document.getElementById("apply-shortcut"),
  shortcutError: document.getElementById("shortcut-error"),
  shortcutSummary: document.getElementById("shortcut-summary"),
  dropOverlay: document.getElementById("drop-overlay"),
  toast: document.getElementById("toast"),
};

const documents = new Map();
const documentViewState = new Map();
const frameRecords = new Map();
let library = { instant: undefined, opened: [], recent: [] };
let settings;
let currentMode = "instant";
let activeDocumentId = "instant";
let lastReadingDocumentId = "";
let currentView = "preview";
let currentPreview;
let selectedPageIndex = 0;
let shortcutDraft = "";
let renderTimer;
let settingsTimer;
let instantTimer;
let resizeTimer;
let toastTimer;
let renderSequence = 0;
let dragDepth = 0;
let outlineTargets = [];
let pendingScrollRestore = 0;

function selectedValue(controls, fallback) {
  return [...controls].find((control) => control.checked)?.value || fallback;
}

function selectValue(controls, value) {
  for (const control of controls) control.checked = control.value === value;
}

function showToast(message, tone = "success", duration = 2000) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", tone === "error");
  elements.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, duration);
}

function currentDocument() {
  return documents.get(activeDocumentId);
}

function currentState(documentId = activeDocumentId) {
  if (!documentId) return { view: "preview", scrollTop: 0, activeHeading: 0 };
  if (!documentViewState.has(documentId)) {
    documentViewState.set(documentId, {
      view: "preview",
      scrollTop: 0,
      activeHeading: 0,
    });
  }
  return documentViewState.get(documentId);
}

function saveCurrentState() {
  if (!activeDocumentId) return;
  const state = currentState();
  state.view = currentView;
  state.scrollTop = activeScrollContainer().scrollTop;
  const activeOutline = elements.outlineList.querySelector("button.active");
  state.activeHeading = Number(activeOutline?.dataset.outlineIndex || 0);
}

function restoreCurrentScroll() {
  const state = currentState();
  pendingScrollRestore = state.scrollTop || 0;
  requestAnimationFrame(() => {
    activeScrollContainer().scrollTop = pendingScrollRestore;
    requestAnimationFrame(updateActiveOutline);
  });
}

function activeFrameRecord() {
  if (currentView === "source") return undefined;
  return frameRecords.get(activeFrameHost());
}

function activeScrollContainer() {
  return activeFrameRecord()?.scrollContainer || elements.contentScroll;
}

function currentRenderOptions() {
  return {
    profile: selectedValue(elements.profile, "mobile"),
    theme: selectedValue(elements.theme, "light"),
    background: selectedValue(elements.background, "plain"),
    showFooter: elements.showFooter.checked,
  };
}

function currentSettings() {
  return {
    ...currentRenderOptions(),
    shortcutEnabled: elements.shortcutEnabled.checked,
    accelerator: shortcutDraft || settings.accelerator,
  };
}

function updateShortcutLabel() {
  const shortcut = elements.accelerator.value || "未设置";
  elements.shortcutSummary.textContent = elements.shortcutEnabled.checked
    ? shortcut.replaceAll("+", " + ")
    : "快捷键已关闭";
}

function syncReaderPresentation() {
  const options = currentRenderOptions();
  elements.contentScroll.dataset.readerTheme = options.theme;
  elements.contentScroll.dataset.readerProfile = options.profile;
}

function applySettingsToControls(next) {
  settings = { ...next };
  selectValue(elements.profile, settings.profile);
  selectValue(elements.theme, settings.theme);
  selectValue(elements.background, settings.background);
  elements.showFooter.checked = settings.showFooter;
  elements.shortcutEnabled.checked = settings.shortcutEnabled;
  elements.accelerator.value = settings.accelerator;
  shortcutDraft = settings.accelerator;
  syncReaderPresentation();
  updateShortcutLabel();
  updateStatus();
}

function persistSettings() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(async () => {
    try {
      const result = await api.updateSettings(currentSettings());
      if (result.ok) {
        settings = result.settings;
        updateShortcutLabel();
      } else if (result.conflict) {
        elements.shortcutError.textContent =
          "快捷键已被其他应用占用，已保留原快捷键。";
        applySettingsToControls(result.settings);
      }
    } catch (error) {
      showToast(`保存设置失败：${error.message}`, "error", 2800);
    }
  }, 180);
}

function updateStatus() {
  const document = currentDocument();
  const profile = currentRenderOptions().profile;
  elements.statusOrigin.innerHTML =
    document?.kind === "local"
      ? `<i class="status-dot"></i>${document.status === "missing" ? "文件不可用" : "文件监听中"}`
      : '<i class="status-dot"></i>即时分享';
  elements.statusView.textContent = {
    preview: "预览模式",
    split: "双栏模式",
    source: "源码模式",
  }[currentView];
  elements.statusProfile.textContent = `${PROFILE_LABELS[profile]} · ${
    profile === "desktop" ? "1600" : "1080"
  } px`;
  elements.statusPages.textContent = currentPreview?.pages?.length
    ? `${currentPreview.pages.length} 页图片`
    : document?.source?.trim()
      ? "等待预览"
      : "等待内容";
}

function documentSubtitle(document) {
  if (document.status === "missing") return "文件不可用 · 保留最后内容";
  const directory = document.path
    ? document.path.split("/").slice(0, -1).at(-1)
    : "";
  return `${directory || "本地文档"} · 正在监听`;
}

function createDocumentItem(record, { recent = false } = {}) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "document-item";
  if (!recent && record.id === activeDocumentId) item.classList.add("active");
  if (!recent && record.status === "missing") item.classList.add("missing");

  const icon = document.createElement("span");
  icon.className = "document-icon";
  icon.textContent = "MD";

  const copy = document.createElement("span");
  copy.className = "document-copy";
  const name = document.createElement("b");
  name.textContent = recent
    ? record.path.split("/").at(-1)
    : record.name;
  const detail = document.createElement("small");
  detail.textContent = recent
    ? record.path
    : documentSubtitle(record);
  copy.append(name, detail);

  const action = document.createElement("button");
  action.type = "button";
  action.className = "item-action";
  action.title = recent ? "从最近打开中移除" : "关闭文档";
  action.textContent = "×";
  action.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      const next = recent
        ? await api.removeRecent(record.path)
        : await api.closeDocument(record.id);
      applyLibrary(next);
      if (!recent && record.id === activeDocumentId) {
        const fallback = library.opened.at(0);
        if (fallback) activateDocument(fallback.id, { mode: "reading" });
        else setMode("reading");
      }
    } catch (error) {
      showToast(`操作失败：${error.message}`, "error");
    }
  });

  item.append(icon, copy, action);
  item.addEventListener("click", async () => {
    if (recent) {
      await openRecent(record.path);
    } else {
      activateDocument(record.id, { mode: "reading" });
    }
  });
  return item;
}

function renderDocumentLists() {
  elements.openedDocuments.replaceChildren(
    ...(library.opened.length
      ? library.opened.map((document) => createDocumentItem(document))
      : [emptyList("尚未打开 Markdown")]),
  );
  elements.recentDocuments.replaceChildren(
    ...(library.recent.length
      ? library.recent.map((entry) =>
          createDocumentItem(entry, { recent: true }),
        )
      : [emptyList("打开过的文档会显示在这里")]),
  );
  elements.recentCount.textContent = String(library.recent.length);
}

function emptyList(message) {
  const empty = document.createElement("div");
  empty.className = "document-empty";
  empty.textContent = message;
  return empty;
}

function applyLibrary(next, { preserveInstantInput = false } = {}) {
  library = {
    instant: next?.instant || library.instant,
    opened: Array.isArray(next?.opened) ? next.opened : [],
    recent: Array.isArray(next?.recent) ? next.recent : [],
  };
  documents.clear();
  if (library.instant) documents.set("instant", library.instant);
  for (const document of library.opened) documents.set(document.id, document);
  if (!preserveInstantInput && library.instant) {
    elements.instantContent.value = library.instant.source || "";
  }
  if (
    lastReadingDocumentId &&
    !documents.has(lastReadingDocumentId)
  ) {
    lastReadingDocumentId = "";
  }
  renderDocumentLists();
  updateStatus();
}

function setSidebarPanel(mode) {
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  document.querySelectorAll("[data-sidebar-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.sidebarPanel === mode);
  });
}

function setMode(mode) {
  if (mode !== "instant" && mode !== "reading") return;
  saveCurrentState();
  currentMode = mode;
  setSidebarPanel(mode);
  if (mode === "instant") {
    activateDocument("instant", { mode, preserveState: true });
    return;
  }
  const nextId =
    (lastReadingDocumentId && documents.has(lastReadingDocumentId)
      ? lastReadingDocumentId
      : library.opened[0]?.id) || "";
  if (nextId) {
    activateDocument(nextId, { mode, preserveState: true });
  } else {
    activeDocumentId = "";
    currentPreview = undefined;
    clearPreview();
    elements.documentTitle.textContent = "阅读";
    elements.documentPath.textContent =
      "打开 Markdown 后，可在这里阅读和分享";
    elements.sourceContent.textContent = "";
    elements.splitSource.textContent = "";
    updateStatus();
  }
}

function setView(view, { render = true, save = true } = {}) {
  if (!["preview", "split", "source"].includes(view)) return;
  if (save) saveCurrentState();
  currentView = view;
  currentState().view = view;
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.viewPanel === view);
  });
  if (render && currentPreview) {
    mountPreviewFrames();
    restoreCurrentScroll();
  }
  updateStatus();
}

function activateDocument(
  documentId,
  { mode, resetScroll = false, preserveState = false } = {},
) {
  const document = documents.get(documentId);
  if (!document) return;
  if (!preserveState) saveCurrentState();
  activeDocumentId = documentId;
  currentMode = mode || (document.kind === "local" ? "reading" : "instant");
  if (document.kind === "local") lastReadingDocumentId = documentId;
  setSidebarPanel(currentMode);
  if (resetScroll) {
    documentViewState.set(documentId, {
      view: "preview",
      scrollTop: 0,
      activeHeading: 0,
    });
  }
  const state = currentState(documentId);
  currentView = state.view || "preview";
  elements.documentTitle.textContent = document.name;
  elements.documentPath.textContent =
    document.kind === "local"
      ? document.path
      : "暂存于内存 · 不保存历史";
  elements.sourceContent.textContent = document.source || "";
  elements.splitSource.textContent = document.source || "";
  renderDocumentLists();
  setView(currentView, { render: false, save: false });
  scheduleRender(0);
}

function inputSource(document) {
  if (document?.sourceFormat === "html" && document.html) return document.html;
  return document?.source || "";
}

function scheduleRender(delay = 260) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderPreview, delay);
}

function clearPreview() {
  currentPreview = undefined;
  selectedPageIndex = 0;
  releaseFrame(elements.previewHost);
  releaseFrame(elements.splitHost);
  elements.previewHost.replaceChildren();
  elements.splitHost.replaceChildren();
  elements.emptyState.hidden = false;
  elements.outlineList.replaceChildren(emptyOutline("当前没有文档目录"));
  outlineTargets = [];
  updatePreviewToolbar();
}

async function renderPreview() {
  clearTimeout(renderTimer);
  const document = currentDocument();
  const source = inputSource(document);
  elements.sourceContent.textContent = document?.source || "";
  elements.splitSource.textContent = document?.source || "";
  if (!source.trim()) {
    clearPreview();
    updateStatus();
    return;
  }

  const sequence = ++renderSequence;
  elements.copyPreview.disabled = true;
  elements.shareToggle.disabled = true;
  elements.statusPages.textContent = "正在排版…";
  try {
    const result = await api.renderPreview({
      source,
      sourceFormat: document.sourceFormat,
      title: elements.titleEnabled.checked ? elements.imageTitle.value : "",
      ...currentRenderOptions(),
    });
    if (sequence !== renderSequence) return;
    currentPreview = result;
    selectedPageIndex = 0;
    elements.emptyState.hidden = true;
    updatePreviewToolbar();
    mountPreviewFrames();
    restoreCurrentScroll();
  } catch (error) {
    if (sequence !== renderSequence) return;
    clearPreview();
    showToast(`生成失败：${error.message}`, "error", 3000);
  } finally {
    if (sequence === renderSequence) updateStatus();
  }
}

function updatePreviewToolbar() {
  const pages = currentPreview?.pages || [];
  const hasPreview = pages.length > 0;
  selectedPageIndex = hasPreview
    ? Math.min(selectedPageIndex, pages.length - 1)
    : 0;
  elements.copyPreview.disabled = !hasPreview;
  elements.shareToggle.disabled = !hasPreview;
  elements.previewPage.hidden = pages.length <= 1;
  elements.previewPage.replaceChildren(
    ...pages.map((page) => {
      const option = document.createElement("option");
      option.value = String(page.index);
      option.textContent = `第 ${page.index + 1} / ${pages.length} 页`;
      return option;
    }),
  );
  elements.previewPage.value = String(selectedPageIndex);
}

function mountPreviewFrames() {
  if (!currentPreview) return;
  mountFrame(elements.previewHost, currentPreview);
  mountFrame(elements.splitHost, currentPreview);
}

function mountFrame(host, preview) {
  releaseFrame(host);
  const isMobile = preview.options.profile === "mobile";
  host.classList.toggle("mobile-frame-host", isMobile);
  host.classList.toggle("desktop-frame-host", !isMobile);
  const shell = document.createElement("div");
  shell.className = "frame-shell";
  const frame = document.createElement("iframe");
  frame.className = "document-frame";
  frame.title = "Markdown 格式预览";
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.style.width = `${preview.options.width}px`;
  frame.style.height = `${preview.totalHeight}px`;
  const documentUrl = URL.createObjectURL(
    new Blob([preview.previewHtml], { type: "text/html;charset=utf-8" }),
  );
  frame.src = documentUrl;
  shell.append(frame);
  let scrollContainer;
  if (isMobile) {
    const phone = document.createElement("div");
    phone.className = "phone-preview";
    phone.setAttribute("aria-label", "移动端预览设备");

    const island = document.createElement("div");
    island.className = "phone-island";
    island.setAttribute("aria-hidden", "true");

    scrollContainer = document.createElement("div");
    scrollContainer.className = "phone-screen";
    scrollContainer.append(shell);

    const homeIndicator = document.createElement("div");
    homeIndicator.className = "phone-home-indicator";
    homeIndicator.setAttribute("aria-hidden", "true");

    phone.append(island, scrollContainer, homeIndicator);
    host.replaceChildren(phone);
  } else {
    host.replaceChildren(shell);
  }
  frameRecords.set(host, {
    host,
    shell,
    frame,
    scrollContainer,
    width: preview.options.width,
    height: preview.totalHeight,
    profile: preview.options.profile,
    scale: 1,
    documentUrl,
  });
  if (scrollContainer) {
    scrollContainer.addEventListener("scroll", () => {
      if (activeFrameHost() !== host) return;
      currentState().scrollTop = scrollContainer.scrollTop;
      updateActiveOutline();
    });
  }
  frame.addEventListener(
    "load",
    () => {
      try {
        frame.contentDocument.addEventListener("click", (event) => {
          if (event.target.closest("a")) event.preventDefault();
        });
      } catch {
        // The sandbox remains readable for normal srcdoc previews.
      }
      updateFrameScale(host);
      if (
        (currentView === "preview" && host === elements.previewHost) ||
        (currentView === "split" && host === elements.splitHost)
      ) {
        buildOutline(host);
        restoreCurrentScroll();
      }
    },
    { once: true },
  );
}

function releaseFrame(host) {
  const record = frameRecords.get(host);
  if (!record) return;
  frameRecords.delete(host);
  if (record.documentUrl) URL.revokeObjectURL(record.documentUrl);
  host.classList.remove("mobile-frame-host", "desktop-frame-host");
}

function updateFrameScale(host) {
  const record = frameRecords.get(host);
  if (!record || !record.host.isConnected) return;
  const availableWidth = Math.max(
    240,
    record.scrollContainer?.clientWidth || record.host.clientWidth,
  );
  const maximumScale = record.profile === "desktop" ? 0.5 : 1;
  const scale = Math.min(maximumScale, availableWidth / record.width);
  record.scale = scale;
  record.shell.style.width = `${Math.round(record.width * scale)}px`;
  record.shell.style.height = `${Math.ceil(record.height * scale)}px`;
  record.frame.style.transform = `scale(${scale})`;
}

function activeFrameHost() {
  return currentView === "split" ? elements.splitHost : elements.previewHost;
}

function buildOutline(host = activeFrameHost()) {
  const record = frameRecords.get(host);
  const frameDocument = record?.frame.contentDocument;
  if (!frameDocument) {
    elements.outlineList.replaceChildren(emptyOutline("正在读取文档目录…"));
    return;
  }
  const headings = [
    ...frameDocument.querySelectorAll(".content h1, .content h2, .content h3"),
  ];
  outlineTargets = headings.map((heading, index) => ({
    index,
    heading,
    host,
    level: Number(heading.tagName.slice(1)),
    text: heading.textContent.trim(),
  }));
  if (!outlineTargets.length) {
    elements.outlineList.replaceChildren(emptyOutline("正文中没有标题"));
    elements.outlineStatus.textContent = "0 项";
    return;
  }
  elements.outlineList.replaceChildren(
    ...outlineTargets.map((target) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.outlineIndex = String(target.index);
      button.className = `level-${target.level}`;
      button.classList.toggle(
        "active",
        target.index === currentState().activeHeading,
      );
      button.textContent = target.text;
      button.addEventListener("click", () => scrollToHeading(target.index));
      return button;
    }),
  );
  elements.outlineStatus.textContent = `${outlineTargets.length} 项`;
  updateActiveOutline();
}

function emptyOutline(message) {
  const empty = document.createElement("div");
  empty.className = "outline-empty";
  empty.textContent = message;
  return empty;
}

function targetScrollTop(target) {
  const record = frameRecords.get(target.host);
  if (!record) return 0;
  if (record.scrollContainer) {
    return target.heading.offsetTop * record.scale;
  }
  const hostRect = target.host.getBoundingClientRect();
  const scrollRect = elements.contentScroll.getBoundingClientRect();
  const hostTop =
    hostRect.top - scrollRect.top + elements.contentScroll.scrollTop;
  return hostTop + target.heading.offsetTop * record.scale;
}

function scrollToHeading(index) {
  if (currentView === "source") {
    currentState().activeHeading = index;
    setView("preview");
    setTimeout(() => scrollToHeading(index), 60);
    return;
  }
  const target = outlineTargets[index];
  if (!target) return;
  currentState().activeHeading = index;
  activeScrollContainer().scrollTo({
    top: Math.max(0, targetScrollTop(target) - 22),
    behavior: "smooth",
  });
}

function updateActiveOutline() {
  if (!outlineTargets.length) return;
  const threshold = activeScrollContainer().scrollTop + 72;
  let activeIndex = 0;
  for (const target of outlineTargets) {
    if (targetScrollTop(target) <= threshold) activeIndex = target.index;
    else break;
  }
  currentState().activeHeading = activeIndex;
  elements.outlineList.querySelectorAll("button").forEach((button) => {
    button.classList.toggle(
      "active",
      Number(button.dataset.outlineIndex) === activeIndex,
    );
  });
}

async function copyCurrentPage() {
  if (!currentPreview) return;
  elements.copyPreview.disabled = true;
  const originalText = elements.copyPreview.textContent;
  elements.copyPreview.textContent = "复制中…";
  try {
    await api.copyPage({
      revision: currentPreview.revision,
      pageIndex: selectedPageIndex,
    });
    showToast("图片已复制，可直接粘贴");
  } catch (error) {
    showToast(`复制失败：${error.message}`, "error", 3000);
  } finally {
    elements.copyPreview.textContent = originalText;
    updatePreviewToolbar();
  }
}

async function exportCurrentPage() {
  if (!currentPreview) return;
  elements.shareMenu.hidden = true;
  try {
    const result = await api.exportPage({
      revision: currentPreview.revision,
      pageIndex: selectedPageIndex,
      suggestedName: "",
    });
    if (!result.canceled) showToast(`图片已导出：${result.path}`);
  } catch (error) {
    showToast(`导出失败：${error.message}`, "error", 3000);
  }
}

async function pasteClipboard() {
  elements.paste.disabled = true;
  try {
    const payload = await api.readClipboard();
    if (!payload.text && !payload.html) {
      showToast("剪贴板中没有文字", "error");
      return;
    }
    const instant = documents.get("instant");
    instant.source = payload.text || "已读取富文本内容";
    instant.sourceFormat = payload.format;
    instant.html = payload.format === "html" ? payload.html : "";
    elements.instantContent.value = instant.source;
    await api.updateInstantDocument(instant);
    setMode("instant");
    scheduleRender(0);
    showToast(payload.format === "html" ? "已读取富文本" : "已读取文本");
  } catch (error) {
    showToast(`读取剪贴板失败：${error.message}`, "error", 2800);
  } finally {
    elements.paste.disabled = false;
  }
}

async function saveInstant() {
  const source = elements.instantContent.value;
  if (!source.trim()) {
    showToast("即时内容为空，无法保存", "error");
    return;
  }
  elements.saveInstant.disabled = true;
  try {
    const firstHeading =
      source.match(/^\s*#\s+(.+)$/m)?.[1]?.trim().slice(0, 50) || "即时分享";
    const result = await api.saveInstantDocument({
      source,
      suggestedName: `${firstHeading}.md`,
    });
    if (result.canceled) return;
    applyLibrary(result.library);
    elements.instantContent.value = "";
    if (result.document) {
      activateDocument(result.document.id, {
        mode: "reading",
        resetScroll: true,
      });
    }
    showToast("文档已保存并加入阅读列表");
  } catch (error) {
    showToast(`保存失败：${error.message}`, "error", 3000);
  } finally {
    elements.saveInstant.disabled = false;
  }
}

async function openDocuments() {
  try {
    const result = await api.openMarkdownFiles();
    if (result.canceled) return;
    const snapshot = await api.getDocumentLibrary();
    applyLibrary(snapshot);
    const active = result.documents.at(-1);
    if (active) {
      activateDocument(active.id, { mode: "reading", resetScroll: true });
    }
    reportOpenErrors(result.errors);
  } catch (error) {
    showToast(`打开失败：${error.message}`, "error", 3000);
  }
}

async function openRecent(filePath) {
  try {
    const result = await api.openRecentFile(filePath);
    applyLibrary(result.library);
    const active = result.documents.at(-1);
    if (active) {
      activateDocument(active.id, { mode: "reading", resetScroll: true });
    }
    reportOpenErrors(result.errors);
  } catch (error) {
    showToast(`打开失败：${error.message}`, "error", 3000);
  }
}

function reportOpenErrors(errors = []) {
  if (!errors.length) return;
  const message =
    errors.length === 1
      ? errors[0].error
      : `${errors.length} 个文件未能打开`;
  showToast(message, "error", 3200);
}

async function openDroppedFiles(files) {
  try {
    const result = await api.openDroppedFiles(files);
    applyLibrary(result.library);
    const active = result.documents.at(-1);
    if (active) {
      activateDocument(active.id, { mode: "reading", resetScroll: true });
    }
    reportOpenErrors(result.errors);
  } catch (error) {
    showToast(`拖入文件失败：${error.message}`, "error", 3000);
  }
}

function openSettingsDialog() {
  elements.settingsModal.hidden = false;
  elements.shortcutError.textContent = "";
  elements.closeSettings.focus();
}

function closeSettingsDialog() {
  elements.settingsModal.hidden = true;
  elements.openSettings.focus();
}

function acceleratorFromEvent(event) {
  const modifierKeys = new Set(["Meta", "Alt", "Shift", "Control"]);
  if (modifierKeys.has(event.key)) return "";
  const parts = [];
  if (event.metaKey) parts.push("Command");
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Option");
  if (event.shiftKey) parts.push("Shift");
  if (!parts.length) return "";
  const aliases = {
    " ": "Space",
    Escape: "Esc",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
  };
  const key = aliases[event.key] || event.key.toUpperCase();
  if (!key || key.length > 12) return "";
  return [...parts, key].join("+");
}

async function applyShortcut() {
  elements.shortcutError.textContent = "";
  elements.applyShortcut.disabled = true;
  try {
    const result = await api.registerShortcut(shortcutDraft);
    if (!result.ok) {
      elements.shortcutError.textContent =
        "快捷键已被系统或其他应用占用，请换一个组合。";
      if (result.settings) applySettingsToControls(result.settings);
      return;
    }
    applySettingsToControls(result.settings);
    showToast("全局快捷键已更新");
  } catch (error) {
    elements.shortcutError.textContent = `设置失败：${error.message}`;
  } finally {
    elements.applyShortcut.disabled = false;
  }
}

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

elements.instantContent.addEventListener("input", () => {
  const instant = documents.get("instant");
  if (!instant) return;
  instant.source = elements.instantContent.value;
  instant.sourceFormat = "markdown";
  instant.html = "";
  clearTimeout(instantTimer);
  instantTimer = setTimeout(() => api.updateInstantDocument(instant), 160);
  if (activeDocumentId === "instant") scheduleRender();
});

elements.clear.addEventListener("click", async () => {
  const instant = documents.get("instant");
  elements.instantContent.value = "";
  if (instant) {
    instant.source = "";
    instant.sourceFormat = "markdown";
    instant.html = "";
    await api.updateInstantDocument(instant);
  }
  if (activeDocumentId === "instant") {
    elements.sourceContent.textContent = "";
    elements.splitSource.textContent = "";
    clearPreview();
    updateStatus();
  }
  elements.instantContent.focus();
});
elements.paste.addEventListener("click", pasteClipboard);
elements.saveInstant.addEventListener("click", saveInstant);
elements.openDocument.addEventListener("click", openDocuments);

elements.toggleSidebar.addEventListener("click", () => {
  const collapsed = elements.app.classList.toggle("sidebar-collapsed");
  elements.toggleSidebar.title = collapsed ? "展开侧栏" : "收起侧栏";
  setTimeout(updateAllFrameScales, 30);
});

elements.toggleStyle.addEventListener("click", () => {
  const active = elements.app.classList.toggle("style-open");
  elements.toggleStyle.classList.toggle("button-primary", active);
  document.querySelectorAll("[data-right-content]").forEach((panel) => {
    panel.classList.toggle(
      "active",
      panel.dataset.rightContent === (active ? "style" : "outline"),
    );
  });
});

[...elements.profile, ...elements.theme, ...elements.background].forEach(
  (control) => {
    control.addEventListener("change", () => {
      syncReaderPresentation();
      persistSettings();
      scheduleRender();
    });
  },
);
elements.titleEnabled.addEventListener("change", () => {
  elements.imageTitle.hidden = !elements.titleEnabled.checked;
  if (elements.titleEnabled.checked) elements.imageTitle.focus();
  scheduleRender();
});
elements.imageTitle.addEventListener("input", () => scheduleRender());
elements.showFooter.addEventListener("change", () => {
  persistSettings();
  scheduleRender();
});

elements.previewPage.addEventListener("change", () => {
  selectedPageIndex = Number(elements.previewPage.value) || 0;
});
elements.copyPreview.addEventListener("click", copyCurrentPage);
elements.shareToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  elements.shareMenu.hidden = !elements.shareMenu.hidden;
});
elements.exportPreview.addEventListener("click", exportCurrentPage);
document.addEventListener("click", (event) => {
  if (!event.target.closest(".share-split")) elements.shareMenu.hidden = true;
});

elements.openSettings.addEventListener("click", openSettingsDialog);
elements.closeSettings.addEventListener("click", closeSettingsDialog);
elements.settingsModal.addEventListener("click", (event) => {
  if (event.target === elements.settingsModal) closeSettingsDialog();
});
elements.shortcutEnabled.addEventListener("change", async () => {
  elements.shortcutError.textContent = "";
  const result = await api.updateSettings(currentSettings());
  if (!result.ok) {
    elements.shortcutError.textContent =
      "快捷键已被系统或其他应用占用，无法启用。";
  }
  applySettingsToControls(result.settings);
});
elements.accelerator.addEventListener("focus", () => {
  elements.accelerator.classList.add("is-recording");
  elements.accelerator.value = "请按新的组合键…";
});
elements.accelerator.addEventListener("blur", () => {
  elements.accelerator.classList.remove("is-recording");
  elements.accelerator.value = shortcutDraft;
});
elements.accelerator.addEventListener("keydown", (event) => {
  event.preventDefault();
  event.stopPropagation();
  const next = acceleratorFromEvent(event);
  if (!next) {
    elements.shortcutError.textContent =
      "请同时按下至少一个修饰键和一个普通按键。";
    return;
  }
  shortcutDraft = next;
  elements.accelerator.value = next;
  elements.shortcutError.textContent = "";
  updateShortcutLabel();
});
elements.applyShortcut.addEventListener("click", applyShortcut);

elements.contentScroll.addEventListener("scroll", () => {
  if (activeScrollContainer() !== elements.contentScroll) return;
  const state = currentState();
  state.scrollTop = elements.contentScroll.scrollTop;
  updateActiveOutline();
});

window.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth += 1;
  elements.dropOverlay.hidden = false;
});
window.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});
window.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) elements.dropOverlay.hidden = true;
});
window.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  elements.dropOverlay.hidden = true;
  if (event.dataTransfer.files.length) {
    openDroppedFiles(event.dataTransfer.files);
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    elements.shareMenu.hidden = true;
    if (!elements.settingsModal.hidden) closeSettingsDialog();
  }
});

function updateAllFrameScales() {
  for (const host of frameRecords.keys()) updateFrameScale(host);
  if (currentView !== "source") buildOutline(activeFrameHost());
}

new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(updateAllFrameScales, 90);
}).observe(elements.contentScroll);

api.onQuickLoad((payload) => {
  const instant = documents.get("instant");
  if (!instant) return;
  instant.source = payload.source || "";
  instant.sourceFormat = payload.sourceFormat || "markdown";
  instant.html = payload.sourceFormat === "html" ? payload.html : "";
  elements.instantContent.value = instant.source;
  setMode("instant");
  scheduleRender(0);
  showToast(payload.message, "success", 3000);
});

api.onSettingsChanged((next) => {
  applySettingsToControls(next);
  scheduleRender();
});

api.onDocumentsOpened((payload) => {
  applyLibrary(payload.library);
  const active = payload.documents?.at(-1);
  if (active) {
    activateDocument(active.id, { mode: "reading", resetScroll: true });
  }
  reportOpenErrors(payload.errors);
});

api.onDocumentChanged((payload) => {
  if (payload.library) applyLibrary(payload.library, { preserveInstantInput: false });
  const changed = payload.document;
  if (!changed) return;
  if (changed.kind === "instant") {
    elements.instantContent.value = changed.source || "";
  }
  if (changed.id === activeDocumentId) {
    documents.set(changed.id, changed);
    elements.sourceContent.textContent = changed.source || "";
    elements.splitSource.textContent = changed.source || "";
    scheduleRender(0);
    if (payload.type === "missing") {
      showToast("当前文件已被移动或删除，已保留最后内容", "error", 3200);
    }
  }
});

async function initialize() {
  [settings, library] = await Promise.all([
    api.getSettings(),
    api.getDocumentLibrary(),
  ]);
  applySettingsToControls(settings);
  applyLibrary(library);
  const firstOpened = library.opened.at(-1);
  if (firstOpened) {
    activateDocument(firstOpened.id, {
      mode: "reading",
      resetScroll: true,
    });
  } else {
    activateDocument("instant", { mode: "instant", resetScroll: true });
  }
  elements.instantContent.focus();
}

initialize().catch((error) => {
  showToast(`初始化失败：${error.message}`, "error", 4000);
});
