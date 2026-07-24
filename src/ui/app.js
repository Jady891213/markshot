const api = window.replyImage;

const PROFILE_LABELS = {
  mobile: "移动端",
  desktop: "PC",
};

const elements = {
  content: document.getElementById("content"),
  title: document.getElementById("title"),
  titleEnabled: document.getElementById("title-enabled"),
  titleField: document.getElementById("title-field"),
  profile: document.querySelectorAll('input[name="profile"]'),
  theme: document.querySelectorAll('input[name="theme"]'),
  background: document.querySelectorAll('input[name="background"]'),
  showFooter: document.getElementById("show-footer"),
  paste: document.getElementById("paste-content"),
  render: document.getElementById("render-preview"),
  clear: document.getElementById("clear-content"),
  openSettings: document.getElementById("open-settings"),
  closeSettings: document.getElementById("close-settings"),
  settingsModal: document.getElementById("settings-modal"),
  shortcutEnabled: document.getElementById("shortcut-enabled"),
  accelerator: document.getElementById("accelerator"),
  applyShortcut: document.getElementById("apply-shortcut"),
  shortcutError: document.getElementById("shortcut-error"),
  shortcutSummary: document.getElementById("shortcut-summary"),
  previewStage: document.getElementById("preview-stage"),
  pageList: document.getElementById("page-list"),
  emptyState: document.getElementById("empty-state"),
  previewMeta: document.getElementById("preview-meta"),
  previewPage: document.getElementById("preview-page"),
  copyPreview: document.getElementById("copy-preview"),
  exportPreview: document.getElementById("export-preview"),
  toast: document.getElementById("toast"),
};

let settings;
let sourceFormat = "markdown";
let sourceHtml = "";
let currentPreview;
let renderTimer;
let settingsTimer;
let toastTimer;
let resizeTimer;
let renderSequence = 0;
let shortcutDraft = "";
let selectedPageIndex = 0;

function selectedValue(controls, fallback) {
  return [...controls].find((control) => control.checked)?.value || fallback;
}

function selectValue(controls, value) {
  for (const control of controls) control.checked = control.value === value;
}

function showToast(message, tone = "success", duration = 1800) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", tone === "error");
  elements.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, duration);
}

function setEmptyState(isEmpty) {
  elements.emptyState.hidden = !isEmpty;
  elements.pageList.hidden = isEmpty;
}

function updatePreviewToolbar() {
  const pages = currentPreview?.pages || [];
  const hasPreview = pages.length > 0;
  selectedPageIndex = hasPreview
    ? Math.min(selectedPageIndex, pages.length - 1)
    : 0;

  elements.copyPreview.disabled = !hasPreview;
  elements.exportPreview.disabled = !hasPreview;
  elements.previewPage.hidden = pages.length <= 1;
  elements.previewPage.replaceChildren(
    ...pages.map((page) => {
      const option = document.createElement("option");
      option.value = String(page.index);
      option.textContent = `第 ${page.index + 1} 页`;
      return option;
    }),
  );
  elements.previewPage.value = String(selectedPageIndex);
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
  updateControlLabels();
}

function updateControlLabels() {
  const shortcut = elements.accelerator.value || "未设置";
  elements.shortcutSummary.textContent = elements.shortcutEnabled.checked
    ? shortcut.replaceAll("+", " + ")
    : "快捷键已关闭";
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

async function persistSettings() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(async () => {
    try {
      const result = await api.updateSettings(currentSettings());
      if (result.ok) {
        settings = result.settings;
        updateControlLabels();
      } else if (result.conflict) {
        elements.shortcutError.textContent =
          "快捷键已被其他应用占用，已保留原快捷键。";
        applySettingsToControls(result.settings);
      }
    } catch (error) {
      showToast(`保存设置失败：${error.message}`, "error", 2600);
    }
  }, 180);
}

function inputSource() {
  if (sourceFormat === "html" && sourceHtml) return sourceHtml;
  return elements.content.value;
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderPreview, 350);
}

async function renderPreview() {
  clearTimeout(renderTimer);
  const source = inputSource();
  if (!source.trim()) {
    currentPreview = undefined;
    selectedPageIndex = 0;
    elements.pageList.replaceChildren();
    elements.previewMeta.textContent = "等待输入内容";
    updatePreviewToolbar();
    setEmptyState(true);
    return;
  }

  const sequence = ++renderSequence;
  elements.render.disabled = true;
  elements.render.textContent = "正在生成…";
  elements.copyPreview.disabled = true;
  elements.exportPreview.disabled = true;
  elements.previewMeta.textContent = "正在生成最终效果预览…";

  try {
    const result = await api.renderPreview({
      source,
      sourceFormat,
      title: elements.titleEnabled.checked ? elements.title.value : "",
      ...currentRenderOptions(),
    });
    if (sequence !== renderSequence) return;
    currentPreview = result;
    selectedPageIndex = 0;
    updatePreviewToolbar();
    drawPages();
    const pageLabel =
      result.pages.length > 1 ? ` · ${result.pages.length} 页` : "";
    const profileLabel = PROFILE_LABELS[result.options.profile] || "移动端";
    elements.previewMeta.textContent = `${profileLabel}${pageLabel}`;
    setEmptyState(false);
  } catch (error) {
    if (sequence !== renderSequence) return;
    elements.previewMeta.textContent = "生成失败";
    showToast(`生成失败：${error.message}`, "error", 3000);
  } finally {
    if (sequence === renderSequence) {
      elements.render.disabled = false;
      elements.render.textContent = "预览";
      updatePreviewToolbar();
    }
  }
}

function previewScale(outputWidth) {
  const availableWidth = Math.max(280, elements.previewStage.clientWidth - 76);
  return Math.min(1, availableWidth / outputWidth);
}

async function copyPage(pageIndex, button) {
  if (!currentPreview) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "复制中…";
  try {
    const result = await api.copyPage({
      revision: currentPreview.revision,
      pageIndex,
    });
    const profileLabel =
      PROFILE_LABELS[currentPreview.options.profile] || "移动端";
    showToast(`已复制${profileLabel}图片，可直接粘贴`);
  } catch (error) {
    showToast(`复制失败：${error.message}`, "error", 3000);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function exportPage(pageIndex, button) {
  if (!currentPreview) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "准备中…";
  try {
    const result = await api.exportPage({
      revision: currentPreview.revision,
      pageIndex,
      suggestedName: "",
    });
    if (!result.canceled) showToast(`图片已导出：${result.path}`);
  } catch (error) {
    showToast(`导出失败：${error.message}`, "error", 3000);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function drawPages() {
  if (!currentPreview) return;
  const { options, pages, previewImages } = currentPreview;
  const scale = previewScale(options.width);
  const page = pages[selectedPageIndex] || pages[0];
  if (!page) {
    elements.pageList.replaceChildren();
    return;
  }

  const wrapper = document.createElement("article");
  wrapper.className = "page-preview";

  const viewport = document.createElement("div");
  viewport.className = "page-viewport";
  viewport.style.width = `${Math.round(page.width * scale)}px`;
  viewport.style.height = `${Math.round(page.height * scale)}px`;

  const preview = previewImages?.[page.index];
  const image = document.createElement("img");
  image.alt = `长图预览第 ${page.index + 1} 页`;
  image.draggable = false;
  image.src = preview?.dataUrl || "";
  image.style.width = `${Math.round(page.width * scale)}px`;
  image.style.height = `${Math.round(page.height * scale)}px`;
  viewport.append(image);
  wrapper.append(viewport);

  if (pages.length > 1) {
    const pageNumber = document.createElement("span");
    pageNumber.className = "page-number";
    pageNumber.textContent = `${page.index + 1} / ${pages.length}`;
    wrapper.append(pageNumber);
  }
  elements.pageList.replaceChildren(wrapper);
}

async function pasteClipboard() {
  elements.paste.disabled = true;
  try {
    const payload = await api.readClipboard();
    if (!payload.text && !payload.html) {
      showToast("剪贴板中没有文字", "error");
      return;
    }
    elements.content.value = payload.text || "已读取富文本内容";
    sourceFormat = payload.format;
    sourceHtml = payload.format === "html" ? payload.html : "";
    showToast(payload.format === "html" ? "已读取富文本" : "已读取文本");
    scheduleRender();
  } catch (error) {
    showToast(`读取剪贴板失败：${error.message}`, "error", 2600);
  } finally {
    elements.paste.disabled = false;
  }
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
  parts.push(key);
  return parts.join("+");
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

elements.content.addEventListener("input", () => {
  sourceFormat = "markdown";
  sourceHtml = "";
  scheduleRender();
});
elements.title.addEventListener("input", scheduleRender);
elements.titleEnabled.addEventListener("change", () => {
  elements.titleField.hidden = !elements.titleEnabled.checked;
  if (elements.titleEnabled.checked) elements.title.focus();
  scheduleRender();
});
[...elements.profile, ...elements.theme, ...elements.background].forEach(
  (control) => {
    control.addEventListener("change", () => {
      persistSettings();
      scheduleRender();
    });
  },
);
elements.showFooter.addEventListener("change", () => {
    persistSettings();
    scheduleRender();
});
elements.paste.addEventListener("click", pasteClipboard);
elements.render.addEventListener("click", renderPreview);
elements.clear.addEventListener("click", () => {
  elements.content.value = "";
  elements.title.value = "";
  elements.titleEnabled.checked = false;
  elements.titleField.hidden = true;
  sourceFormat = "markdown";
  sourceHtml = "";
  renderPreview();
  elements.content.focus();
});
elements.openSettings.addEventListener("click", openSettingsDialog);
elements.closeSettings.addEventListener("click", closeSettingsDialog);
elements.settingsModal.addEventListener("click", (event) => {
  if (event.target === elements.settingsModal) closeSettingsDialog();
});
elements.previewPage.addEventListener("change", () => {
  selectedPageIndex = Number(elements.previewPage.value) || 0;
  drawPages();
});
elements.copyPreview.addEventListener("click", () =>
  copyPage(selectedPageIndex, elements.copyPreview),
);
elements.exportPreview.addEventListener("click", () =>
  exportPage(selectedPageIndex, elements.exportPreview),
);

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
  updateControlLabels();
});
elements.applyShortcut.addEventListener("click", applyShortcut);

api.onQuickLoad((payload) => {
  elements.content.value = payload.source || "";
  sourceFormat = payload.sourceFormat;
  sourceHtml = payload.sourceFormat === "html" ? payload.html : "";
  renderPreview();
  showToast(payload.message, "success", 3000);
});
api.onSettingsChanged((next) => applySettingsToControls(next));

new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawPages, 120);
}).observe(elements.previewStage);

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.settingsModal.hidden) {
    closeSettingsDialog();
    return;
  }
  if (event.metaKey && event.key === "Enter") renderPreview();
});

async function initialize() {
  settings = await api.getSettings();
  applySettingsToControls(settings);
  updatePreviewToolbar();
  setEmptyState(true);
  elements.content.focus();
}

initialize().catch((error) => {
  showToast(`初始化失败：${error.message}`, "error", 4000);
});
