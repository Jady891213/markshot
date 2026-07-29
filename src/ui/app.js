import {
  formatItemCount,
  formatOpenErrorCount,
  normalizeLanguage,
  translate,
} from "../i18n.mjs";

const api = window.replyImage;

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
  previewSearch: document.getElementById("preview-search"),
  previewSearchInput: document.getElementById("preview-search-input"),
  previewSearchCount: document.getElementById("preview-search-count"),
  previewSearchPrevious: document.getElementById("preview-search-previous"),
  previewSearchNext: document.getElementById("preview-search-next"),
  previewSearchClose: document.getElementById("preview-search-close"),
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
  language: document.querySelectorAll('input[name="language"]'),
  titleEnabled: document.getElementById("title-enabled"),
  imageTitle: document.getElementById("image-title"),
  showFooter: document.getElementById("show-footer"),
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
let documentItemMenu;
let documentItemMenuOwner;
let settings;
let currentMode = "instant";
let activeDocumentId = "instant";
let lastReadingDocumentId = "";
let currentView = "preview";
let currentPreview;
let shortcutDraft = "";
let renderTimer;
let settingsTimer;
let instantTimer;
let resizeTimer;
let toastTimer;
let renderSequence = 0;
let dragDepth = 0;
let outlineTargets = [];
let previewSearchMatches = [];
let previewSearchIndex = -1;
let pendingScrollRestore = 0;
let instantSyntheticSource = false;

function currentLanguage() {
  return normalizeLanguage(settings?.language);
}

function t(key, values = {}) {
  return translate(currentLanguage(), key, values);
}

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

function wheelDeltaPixels(event, scrollContainer) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * scrollContainer.clientHeight;
  }
  return event.deltaY;
}

function previewFrames(record) {
  return record?.frames || (record?.frame ? [record.frame] : []);
}

function clearSearchHighlights(record) {
  for (const frame of previewFrames(record)) {
    const frameDocument = frame.contentDocument;
    const root = frameDocument?.querySelector(".content");
    if (!root) continue;
    root.querySelectorAll("mark[data-markshot-search-index]").forEach((mark) => {
      mark.replaceWith(frameDocument.createTextNode(mark.textContent || ""));
    });
    root.normalize();
  }
}

function highlightSearchDocument(frameDocument, query) {
  const root = frameDocument?.querySelector(".content");
  if (!root || !query) return [];
  if (!frameDocument.querySelector("style[data-markshot-search-style]")) {
    const style = frameDocument.createElement("style");
    style.dataset.markshotSearchStyle = "";
    style.textContent = `
      mark[data-markshot-search-index] {
        padding: 0;
        color: inherit;
        background: #fde047;
        border-radius: 2px;
        box-shadow: 0 0 0 1px rgba(161, 98, 7, 0.18);
      }
      mark[data-markshot-search-index].markshot-search-current {
        background: #fb923c;
        box-shadow: 0 0 0 2px rgba(194, 65, 12, 0.42);
      }
    `;
    frameDocument.head.append(style);
  }

  const normalizedQuery = query.toLocaleLowerCase(currentLanguage());
  const textNodes = [];
  const walker = frameDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (
          !node.nodeValue ||
          !parent ||
          parent.closest("mark[data-markshot-search-index]") ||
          ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return node.nodeValue
          .toLocaleLowerCase(currentLanguage())
          .includes(normalizedQuery)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    },
  );
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  const matches = [];
  for (const textNode of textNodes) {
    const text = textNode.nodeValue;
    const normalizedText = text.toLocaleLowerCase(currentLanguage());
    const fragment = frameDocument.createDocumentFragment();
    let cursor = 0;
    let matchAt = normalizedText.indexOf(normalizedQuery);
    while (matchAt >= 0) {
      if (matchAt > cursor) {
        fragment.append(frameDocument.createTextNode(text.slice(cursor, matchAt)));
      }
      const mark = frameDocument.createElement("mark");
      mark.dataset.markshotSearchIndex = String(matches.length);
      mark.textContent = text.slice(matchAt, matchAt + query.length);
      matches.push(mark);
      fragment.append(mark);
      cursor = matchAt + query.length;
      matchAt = normalizedText.indexOf(normalizedQuery, cursor);
    }
    if (cursor < text.length) {
      fragment.append(frameDocument.createTextNode(text.slice(cursor)));
    }
    textNode.replaceWith(fragment);
  }
  return matches;
}

function updatePreviewSearchCount() {
  const total = previewSearchMatches.length;
  const current = previewSearchIndex >= 0 ? previewSearchIndex + 1 : 0;
  elements.previewSearchCount.textContent = `${current} / ${total}`;
  elements.previewSearchPrevious.disabled = !total;
  elements.previewSearchNext.disabled = !total;
}

function scrollToPreviewSearchMatch(mark) {
  const record = activeFrameRecord();
  const frame = record?.frame;
  if (!record || !frame || !mark) return;
  const documentOffset =
    mark.getBoundingClientRect().top + (frame.contentWindow?.scrollY || 0);

  if (record.pages?.length) {
    const page =
      record.pages.find(
        ({ y, height }) =>
          documentOffset >= y && documentOffset < y + height,
      ) || record.pages.at(-1);
    const hostRect = record.host.getBoundingClientRect();
    const scrollRect = elements.contentScroll.getBoundingClientRect();
    const hostTop =
      hostRect.top - scrollRect.top + elements.contentScroll.scrollTop;
    elements.contentScroll.scrollTo({
      left: Math.max(
        0,
        page.index * (record.scaleWidth || page.width) * record.scale,
      ),
      top: Math.max(
        0,
        hostTop + (documentOffset - page.y) * record.scale - 52,
      ),
      behavior: "smooth",
    });
    return;
  }

  if (record.scrollContainer) {
    record.scrollContainer.scrollTo({
      top: Math.max(0, documentOffset * record.scale - 38),
      behavior: "smooth",
    });
    return;
  }

  const hostRect = record.host.getBoundingClientRect();
  const scrollRect = elements.contentScroll.getBoundingClientRect();
  const hostTop =
    hostRect.top - scrollRect.top + elements.contentScroll.scrollTop;
  elements.contentScroll.scrollTo({
    top: Math.max(0, hostTop + documentOffset * record.scale - 52),
    behavior: "smooth",
  });
}

function activatePreviewSearchMatch(index, { scroll = true } = {}) {
  const total = previewSearchMatches.length;
  previewSearchIndex = total ? (index + total) % total : -1;
  const record = activeFrameRecord();
  for (const frame of previewFrames(record)) {
    const frameDocument = frame.contentDocument;
    frameDocument
      ?.querySelectorAll("mark[data-markshot-search-index]")
      .forEach((mark) => {
        mark.classList.toggle(
          "markshot-search-current",
          Number(mark.dataset.markshotSearchIndex) === previewSearchIndex,
        );
      });
  }
  updatePreviewSearchCount();
  if (scroll && previewSearchIndex >= 0) {
    scrollToPreviewSearchMatch(previewSearchMatches[previewSearchIndex]);
  }
}

function applyPreviewSearch({ scroll = false } = {}) {
  const record = activeFrameRecord();
  clearSearchHighlights(record);
  previewSearchMatches = [];
  previewSearchIndex = -1;
  const query = elements.previewSearchInput.value;
  if (!record || !query) {
    updatePreviewSearchCount();
    return;
  }

  for (const frame of previewFrames(record)) {
    const matches = highlightSearchDocument(frame.contentDocument, query);
    if (frame === record.frame) previewSearchMatches = matches;
  }
  activatePreviewSearchMatch(previewSearchMatches.length ? 0 : -1, { scroll });
}

function openPreviewSearch() {
  if (!currentPreview) return;
  if (currentView === "source") setView("preview");
  elements.previewSearch.hidden = false;
  requestAnimationFrame(() => {
    elements.previewSearchInput.focus();
    elements.previewSearchInput.select();
    if (elements.previewSearchInput.value) applyPreviewSearch();
  });
}

function closePreviewSearch() {
  for (const record of frameRecords.values()) clearSearchHighlights(record);
  previewSearchMatches = [];
  previewSearchIndex = -1;
  elements.previewSearchInput.value = "";
  elements.previewSearch.hidden = true;
  updatePreviewSearchCount();
}

function handlePreviewSearchShortcut(event) {
  if (!event.metaKey || event.altKey || event.key.toLowerCase() !== "f") {
    return false;
  }
  if (!currentPreview) return false;
  event.preventDefault();
  event.stopPropagation();
  openPreviewSearch();
  return true;
}

function currentRenderOptions() {
  return {
    language: currentLanguage(),
    profile: selectedValue(elements.profile, "mobile"),
    theme: selectedValue(elements.theme, "light"),
    background: selectedValue(elements.background, "plain"),
    showFooter: elements.showFooter.checked,
  };
}

function currentSettings() {
  return {
    ...currentRenderOptions(),
    language: selectedValue(elements.language, currentLanguage()),
    shortcutEnabled: elements.shortcutEnabled.checked,
    accelerator: shortcutDraft || settings.accelerator,
  };
}

function updateShortcutLabel() {
  const shortcut = elements.accelerator.value || t("settings.shortcutUnset");
  elements.shortcutSummary.textContent = elements.shortcutEnabled.checked
    ? shortcut.replaceAll("+", " + ")
    : t("settings.shortcutOff");
}

function applyTranslations() {
  document.documentElement.lang = currentLanguage();
  clearTimeout(toastTimer);
  elements.toast.classList.remove("is-visible");
  elements.toast.textContent = "";
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  for (const [attribute, datasetName] of [
    ["aria-label", "i18nAriaLabel"],
    ["title", "i18nTitle"],
    ["placeholder", "i18nPlaceholder"],
  ]) {
    document.querySelectorAll(`[data-${datasetName.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}]`).forEach(
      (element) => element.setAttribute(attribute, t(element.dataset[datasetName])),
    );
  }
  const collapsed = elements.app.classList.contains("sidebar-collapsed");
  const sidebarKey = collapsed
    ? "nav.expandSidebar"
    : "nav.collapseSidebar";
  elements.toggleSidebar.title = t(sidebarKey);
  elements.toggleSidebar.setAttribute("aria-label", t(sidebarKey));
  if (instantSyntheticSource) {
    const instant = documents.get("instant");
    if (instant) {
      instant.source = t("instant.richText");
      elements.instantContent.value = instant.source;
      elements.sourceContent.textContent = instant.source;
      elements.splitSource.textContent = instant.source;
    }
  }
  const active = currentDocument();
  if (active?.kind === "instant") {
    elements.documentTitle.textContent = t("instant.title");
    elements.documentPath.textContent = t("instant.memoryOnly");
  } else if (!active && currentMode === "reading") {
    elements.documentTitle.textContent = t("mode.reading");
    elements.documentPath.textContent = t("reading.description");
  }
  if (library.opened) renderDocumentLists();
  updatePreviewToolbar();
  updateStatus();
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
  selectValue(elements.language, settings.language);
  elements.showFooter.checked = settings.showFooter;
  elements.shortcutEnabled.checked = settings.shortcutEnabled;
  elements.accelerator.value = settings.accelerator;
  shortcutDraft = settings.accelerator;
  applyTranslations();
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
        elements.shortcutError.textContent = t(
          "settings.shortcutConflictKept",
        );
        applySettingsToControls(result.settings);
      }
    } catch (error) {
      showToast(
        t("toast.settingsSaveFailed", { message: error.message }),
        "error",
        2800,
      );
    }
  }, 180);
}

function updateStatus() {
  const document = currentDocument();
  const profile = currentRenderOptions().profile;
  elements.statusOrigin.innerHTML =
    document?.kind === "local"
      ? `<i class="status-dot"></i>${document.status === "missing" ? t("status.fileUnavailable") : t("status.fileWatching")}`
      : `<i class="status-dot"></i>${t("instant.title")}`;
  elements.statusView.textContent = {
    preview: t("view.previewMode"),
    split: t("view.splitMode"),
    source: t("view.sourceMode"),
  }[currentView];
  elements.statusProfile.textContent = `${t(
    profile === "desktop" ? "profile.desktop" : "profile.mobile",
  )} · ${
    profile === "desktop" ? "1600" : "1080"
  } px`;
  elements.statusPages.textContent = currentPreview?.pages?.length
    ? currentPreview.layout?.tooLong
      ? t("share.contentTooLong")
      : currentPreview.pages.length === 1
        ? t("share.singleColumn")
        : t("share.columnCount", { count: currentPreview.pages.length })
    : document?.source?.trim()
      ? t("status.waitingPreview")
      : t("status.waitingContent");
}

function documentSubtitle(document) {
  if (document.status === "missing") return t("status.missingDocument");
  const directory = document.path
    ? document.path.split("/").slice(0, -1).at(-1)
    : "";
  return directory || t("status.localDocument");
}

function closeDocumentItemMenu() {
  documentItemMenu?.remove();
  documentItemMenu = undefined;
  documentItemMenuOwner?.setAttribute("aria-expanded", "false");
  documentItemMenuOwner = undefined;
}

function showDocumentItemMenu(record, owner, point) {
  closeDocumentItemMenu();
  const menu = document.createElement("div");
  menu.className = "document-item-menu";
  menu.setAttribute("role", "menu");

  const reveal = document.createElement("button");
  reveal.type = "button";
  reveal.setAttribute("role", "menuitem");
  reveal.textContent = t("action.revealInFinder");
  reveal.addEventListener("click", async (event) => {
    event.stopPropagation();
    closeDocumentItemMenu();
    try {
      await api.showItemInFolder(record.path);
    } catch (error) {
      showToast(t("toast.actionFailed", { message: error.message }), "error");
    }
  });
  menu.append(reveal);
  document.body.append(menu);

  const anchor = owner.getBoundingClientRect();
  const left = point?.x ?? anchor.right - menu.offsetWidth;
  const top = point?.y ?? anchor.bottom + 4;
  menu.style.left = `${Math.max(
    8,
    Math.min(left, window.innerWidth - menu.offsetWidth - 8),
  )}px`;
  menu.style.top = `${Math.max(
    8,
    Math.min(top, window.innerHeight - menu.offsetHeight - 8),
  )}px`;
  documentItemMenu = menu;
  documentItemMenuOwner = owner;
  owner.setAttribute("aria-expanded", "true");
  reveal.focus();
}

function createDocumentItem(record, { recent = false } = {}) {
  const item = document.createElement("div");
  item.tabIndex = 0;
  item.setAttribute("role", "button");
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
  action.title = t("action.moreDocument");
  action.setAttribute("aria-label", t("action.moreDocument"));
  action.setAttribute("aria-haspopup", "menu");
  action.setAttribute("aria-expanded", "false");
  action.textContent = "•••";
  action.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (documentItemMenuOwner === action) closeDocumentItemMenu();
    else showDocumentItemMenu(record, action);
  });

  item.append(icon, copy, action);
  item.addEventListener("click", async () => {
    if (recent) {
      await openRecent(record.path);
    } else {
      activateDocument(record.id, { mode: "reading" });
    }
  });
  item.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    item.click();
  });
  item.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showDocumentItemMenu(record, action, {
      x: event.clientX,
      y: event.clientY,
    });
  });
  return item;
}

function renderDocumentLists() {
  closeDocumentItemMenu();
  elements.openedDocuments.replaceChildren(
    ...(library.opened.length
      ? library.opened.map((document) => createDocumentItem(document))
      : [emptyList(t("reading.emptyOpened"))]),
  );
  elements.recentDocuments.replaceChildren(
    ...(library.recent.length
      ? library.recent.map((entry) =>
          createDocumentItem(entry, { recent: true }),
        )
      : [emptyList(t("reading.emptyRecent"))]),
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
    elements.documentTitle.textContent = t("mode.reading");
    elements.documentPath.textContent = t("reading.description");
    elements.sourceContent.textContent = "";
    elements.splitSource.textContent = "";
    updateStatus();
  }
}

function setView(view, { render = true, save = true } = {}) {
  if (!["preview", "split", "source"].includes(view)) return;
  if (view === "source" && !elements.previewSearch.hidden) {
    closePreviewSearch();
  }
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
  if (activeDocumentId !== documentId) closePreviewSearch();
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
  elements.documentTitle.textContent =
    document.kind === "instant" ? t("instant.title") : document.name;
  elements.documentPath.textContent =
    document.kind === "local"
      ? document.path
      : t("instant.memoryOnly");
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
  closePreviewSearch();
  currentPreview = undefined;
  releaseFrame(elements.previewHost);
  releaseFrame(elements.splitHost);
  elements.previewHost.replaceChildren();
  elements.splitHost.replaceChildren();
  elements.emptyState.hidden = false;
  elements.outlineList.replaceChildren(emptyOutline(t("outline.none")));
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
  elements.statusPages.textContent = t("status.rendering");
  try {
    const result = await api.renderPreview({
      source,
      sourceFormat: document.sourceFormat,
      title: elements.titleEnabled.checked ? elements.imageTitle.value : "",
      ...currentRenderOptions(),
    });
    if (sequence !== renderSequence) return;
    currentPreview = result;
    elements.emptyState.hidden = true;
    updatePreviewToolbar();
    mountPreviewFrames();
    restoreCurrentScroll();
  } catch (error) {
    if (sequence !== renderSequence) return;
    clearPreview();
    showToast(
      t("toast.generateFailed", { message: error.message }),
      "error",
      3000,
    );
  } finally {
    if (sequence === renderSequence) updateStatus();
  }
}

function updatePreviewToolbar() {
  const pages = currentPreview?.pages || [];
  const hasPreview = pages.length > 0;
  const tooLong = Boolean(currentPreview?.layout?.tooLong);
  elements.copyPreview.disabled = !hasPreview || tooLong;
  elements.shareToggle.disabled = !hasPreview || tooLong;
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
  frame.title = t("preview.frameTitle");
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
    phone.setAttribute("aria-label", t("preview.mobileDevice"));

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
        frame.contentWindow.addEventListener(
          "keydown",
          handlePreviewSearchShortcut,
        );
        frame.contentWindow.addEventListener(
          "wheel",
          (event) => {
            if (activeFrameHost() !== host || event.ctrlKey || !event.deltaY) {
              return;
            }
            event.preventDefault();
            const destination = scrollContainer || elements.contentScroll;
            destination.scrollTop += wheelDeltaPixels(event, destination);
          },
          { passive: false },
        );
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
        if (
          !elements.previewSearch.hidden &&
          elements.previewSearchInput.value
        ) {
          applyPreviewSearch();
        }
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
  host.classList.remove(
    "mobile-frame-host",
    "desktop-frame-host",
  );
}

function updateFrameScale(host) {
  const record = frameRecords.get(host);
  if (!record || !record.host.isConnected) return;
  const availableWidth = Math.max(
    240,
    record.scrollContainer?.clientWidth ||
      Math.min(record.host.clientWidth, elements.contentScroll.clientWidth),
  );
  const maximumScale = record.profile === "desktop" ? 0.5 : 1;
  const scale = Math.min(
    maximumScale,
    availableWidth / (record.scaleWidth || record.width),
  );
  record.scale = scale;
  record.shell.style.width = `${Math.round(record.width * scale)}px`;
  record.shell.style.height = `${Math.ceil(record.height * scale)}px`;
  (record.inner || record.frame).style.transform = `scale(${scale})`;
}

function activeFrameHost() {
  return currentView === "split" ? elements.splitHost : elements.previewHost;
}

function buildOutline(host = activeFrameHost()) {
  const record = frameRecords.get(host);
  if (!record) {
    elements.outlineList.replaceChildren(emptyOutline(t("outline.none")));
    elements.outlineStatus.textContent = t("outline.current");
    return;
  }
  const frameDocument = record?.frame.contentDocument;
  if (!frameDocument) {
    elements.outlineList.replaceChildren(emptyOutline(t("outline.reading")));
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
    elements.outlineList.replaceChildren(emptyOutline(t("outline.noHeadings")));
    elements.outlineStatus.textContent = formatItemCount(currentLanguage(), 0);
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
  elements.outlineStatus.textContent = formatItemCount(
    currentLanguage(),
    outlineTargets.length,
  );
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
  const page = record.pages?.find(
    ({ y, height }) =>
      target.heading.offsetTop >= y &&
      target.heading.offsetTop < y + height,
  );
  const localOffset = page
    ? target.heading.offsetTop - page.y
    : target.heading.offsetTop;
  return hostTop + localOffset * record.scale;
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
  const record = frameRecords.get(target.host);
  if (record?.pages?.length) {
    const page = record.pages.find(
      ({ y, height }) =>
        target.heading.offsetTop >= y &&
        target.heading.offsetTop < y + height,
    );
    if (page) {
      elements.contentScroll.scrollTo({
        left: Math.max(
          0,
          page.index * (record.scaleWidth || page.width) * record.scale,
        ),
        behavior: "smooth",
      });
    }
  }
  activeScrollContainer().scrollTo({
    top: Math.max(0, targetScrollTop(target) - 22),
    behavior: "smooth",
  });
}

function updateActiveOutline() {
  if (!outlineTargets.length) return;
  const record = frameRecords.get(activeFrameHost());
  if (record?.pages?.length) {
    const columnWidth = (record.scaleWidth || 1) * record.scale;
    const pageIndex = Math.max(
      0,
      Math.min(
        record.pages.length - 1,
        Math.round(elements.contentScroll.scrollLeft / columnWidth),
      ),
    );
    const page = record.pages[pageIndex];
    const hostRect = record.host.getBoundingClientRect();
    const scrollRect = elements.contentScroll.getBoundingClientRect();
    const hostTop =
      hostRect.top - scrollRect.top + elements.contentScroll.scrollTop;
    const localY = Math.max(
      0,
      (elements.contentScroll.scrollTop - hostTop + 72) / record.scale,
    );
    const documentOffset = page.y + localY;
    let activeIndex = 0;
    for (const target of outlineTargets) {
      if (target.heading.offsetTop <= documentOffset) {
        activeIndex = target.index;
      } else {
        break;
      }
    }
    currentState().activeHeading = activeIndex;
    elements.outlineList.querySelectorAll("button").forEach((button) => {
      button.classList.toggle(
        "active",
        Number(button.dataset.outlineIndex) === activeIndex,
      );
    });
    return;
  }
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
  elements.copyPreview.textContent = t("share.copying");
  try {
    await api.copyPage({
      revision: currentPreview.revision,
    });
    showToast(t("toast.copied"));
  } catch (error) {
    showToast(
      t("toast.copyFailed", { message: error.message }),
      "error",
      3000,
    );
  } finally {
    elements.copyPreview.textContent = t("share.copy");
    updatePreviewToolbar();
  }
}

async function exportCurrentPage() {
  if (!currentPreview) return;
  elements.shareMenu.hidden = true;
  try {
    const result = await api.exportPage({
      revision: currentPreview.revision,
      suggestedName: "",
    });
    if (!result.canceled) {
      showToast(t("toast.exported", { path: result.path }));
    }
  } catch (error) {
    showToast(
      t("toast.exportFailed", { message: error.message }),
      "error",
      3000,
    );
  }
}

async function pasteClipboard() {
  elements.paste.disabled = true;
  try {
    const payload = await api.readClipboard();
    if (!payload.text && !payload.html) {
      showToast(t("toast.clipboardEmpty"), "error");
      return;
    }
    const instant = documents.get("instant");
    instantSyntheticSource = !payload.text && Boolean(payload.html);
    instant.source = payload.text || t("instant.richText");
    instant.sourceFormat = payload.format;
    instant.html = payload.format === "html" ? payload.html : "";
    elements.instantContent.value = instant.source;
    await api.updateInstantDocument(instant);
    setMode("instant");
    scheduleRender(0);
    showToast(
      t(payload.format === "html" ? "toast.richTextRead" : "toast.textRead"),
    );
  } catch (error) {
    showToast(
      t("toast.clipboardReadFailed", { message: error.message }),
      "error",
      2800,
    );
  } finally {
    elements.paste.disabled = false;
  }
}

async function saveInstant() {
  const source = elements.instantContent.value;
  if (!source.trim()) {
    showToast(t("toast.instantEmpty"), "error");
    return;
  }
  elements.saveInstant.disabled = true;
  try {
    const result = await api.saveInstantDocument({
      source,
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
    showToast(t("toast.documentSaved"));
  } catch (error) {
    showToast(
      t("toast.saveFailed", { message: error.message }),
      "error",
      3000,
    );
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
    showToast(
      t("toast.openFailed", { message: error.message }),
      "error",
      3000,
    );
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
    showToast(
      t("toast.openFailed", { message: error.message }),
      "error",
      3000,
    );
  }
}

function reportOpenErrors(errors = []) {
  if (!errors.length) return;
  const message =
    errors.length === 1
      ? errors[0].error
      : formatOpenErrorCount(currentLanguage(), errors.length);
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
    showToast(
      t("toast.dropFailed", { message: error.message }),
      "error",
      3000,
    );
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
      elements.shortcutError.textContent = t(
        "settings.shortcutConflict",
      );
      if (result.settings) applySettingsToControls(result.settings);
      return;
    }
    applySettingsToControls(result.settings);
    showToast(t("settings.shortcutUpdated"));
  } catch (error) {
    elements.shortcutError.textContent = t("error.settingsFailed", {
      message: error.message,
    });
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
  instantSyntheticSource = false;
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
  const label = t(collapsed ? "nav.expandSidebar" : "nav.collapseSidebar");
  elements.toggleSidebar.title = label;
  elements.toggleSidebar.setAttribute("aria-label", label);
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
elements.language.forEach((control) => {
  control.addEventListener("change", async () => {
    settings.language = selectedValue(elements.language, currentLanguage());
    applyTranslations();
    syncReaderPresentation();
    scheduleRender(0);
    try {
      const result = await api.updateSettings(currentSettings());
      applySettingsToControls(result.settings);
      if (!result.ok && result.conflict) {
        elements.shortcutError.textContent = t(
          "settings.shortcutConflictKept",
        );
      }
    } catch (error) {
      showToast(
        t("toast.settingsSaveFailed", { message: error.message }),
        "error",
        2800,
      );
    }
  });
});
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

elements.copyPreview.addEventListener("click", copyCurrentPage);
elements.shareToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  elements.shareMenu.hidden = !elements.shareMenu.hidden;
});
elements.exportPreview.addEventListener("click", exportCurrentPage);
elements.previewSearchInput.addEventListener("input", () => {
  applyPreviewSearch({ scroll: true });
});
elements.previewSearchInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  activatePreviewSearchMatch(
    previewSearchIndex + (event.shiftKey ? -1 : 1),
  );
});
elements.previewSearchPrevious.addEventListener("click", () => {
  activatePreviewSearchMatch(previewSearchIndex - 1);
});
elements.previewSearchNext.addEventListener("click", () => {
  activatePreviewSearchMatch(previewSearchIndex + 1);
});
elements.previewSearchClose.addEventListener("click", closePreviewSearch);
document.addEventListener("click", (event) => {
  if (!event.target.closest(".share-split")) elements.shareMenu.hidden = true;
  if (
    documentItemMenu &&
    !event.target.closest(".document-item-menu") &&
    !event.target.closest(".item-action")
  ) {
    closeDocumentItemMenu();
  }
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
    elements.shortcutError.textContent = t(
      "settings.shortcutConflictEnable",
    );
  }
  applySettingsToControls(result.settings);
});
elements.accelerator.addEventListener("focus", () => {
  elements.accelerator.classList.add("is-recording");
  elements.accelerator.value = t("settings.shortcutRecord");
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
    elements.shortcutError.textContent = t("settings.shortcutInvalid");
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
  if (handlePreviewSearchShortcut(event)) return;
  if (event.key === "Escape") {
    if (!elements.previewSearch.hidden) {
      event.preventDefault();
      closePreviewSearch();
      return;
    }
    elements.shareMenu.hidden = true;
    closeDocumentItemMenu();
    if (!elements.settingsModal.hidden) closeSettingsDialog();
  }
});

window.addEventListener("blur", closeDocumentItemMenu);
window.addEventListener("resize", closeDocumentItemMenu);

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
  instantSyntheticSource = false;
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
      showToast(t("toast.fileMissing"), "error", 3200);
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
  showToast(
    t("toast.initializeFailed", { message: error.message }),
    "error",
    4000,
  );
});
