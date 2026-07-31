import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const [html, script, styles] = await Promise.all([
  fs.readFile(new URL("../src/ui/index.html", import.meta.url), "utf8"),
  fs.readFile(new URL("../src/ui/app.js", import.meta.url), "utf8"),
  fs.readFile(new URL("../src/ui/app.css", import.meta.url), "utf8"),
]);

test("preview document may apply the same inline theme CSS as image capture", () => {
  assert.match(
    html,
    /style-src 'self' 'unsafe-inline'; script-src 'self';/,
  );
  assert.match(html, /frame-src 'self' data: blob:/);
  assert.match(script, /new Blob\(\[preview\.previewHtml\]/);
  assert.doesNotMatch(script, /\.srcdoc\s*=/);
});

test("mobile preview adds device chrome without changing captured HTML", () => {
  assert.match(script, /preview\.options\.profile === "mobile"/);
  assert.match(script, /phone\.className = "phone-preview"/);
  assert.match(script, /scrollContainer\.className = "phone-screen"/);
  assert.match(styles, /\.phone-preview\s*\{/);
  assert.match(styles, /\.phone-screen\s*\{/);
  assert.match(
    styles,
    /\.phone-screen\s*\{[^}]*overflow-x: hidden;[^}]*overflow-y: auto;/s,
  );
});

test("preview uses its real output width and only shrinks when space is insufficient", () => {
  assert.match(
    script,
    /const scale = Math\.min\(\s*1,/,
  );
  assert.match(
    script,
    /availableWidth \/ \(record\.scaleWidth \|\| record\.width\)/,
  );
  assert.doesNotMatch(script, /maximumScale/);
});

test("long output stays single-column in preview while copy composes columns", () => {
  assert.doesNotMatch(html, /id="preview-layout"/);
  assert.doesNotMatch(html, /id="preview-page"/);
  assert.doesNotMatch(script, /function mountColumnFrames\(host, preview\)/);
  assert.match(script, /frame\.style\.height = `\$\{preview\.totalHeight\}px`/);
  assert.doesNotMatch(styles, /\.multi-column-inner\s*\{/);
});

test("preview iframe forwards wheel input without direction-change latency", () => {
  assert.match(
    script,
    /frame\.contentWindow\.addEventListener\(\s*"wheel"/s,
  );
  assert.match(script, /\{ passive: false \}/);
  assert.match(
    script,
    /destination\.scrollTop \+= wheelDeltaPixels\(event, destination\)/,
  );
});

test("copy and export split action stays seamless and equal-height", () => {
  assert.match(styles, /\.share-split\s*\{[^}]*height: 32px;/s);
  assert.match(
    styles,
    /\.share-split > \.button\s*\{[^}]*height: 32px;[^}]*padding-top: 0;[^}]*padding-bottom: 0;/s,
  );
  assert.match(
    styles,
    /\.share-split > \.button:first-child\s*\{[^}]*border-right: 0;/s,
  );
  assert.match(
    styles,
    /\.share-split \.share-toggle\s*\{[^}]*border-left: 0;/s,
  );
});

test("language controls update the live interface without shrinking labels", () => {
  assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/);
  assert.match(html, /name="language" value="zh-CN"/);
  assert.match(html, /name="language" value="en"/);
  assert.match(html, /data-i18n="settings\.language"/);
  assert.match(script, /document\.documentElement\.lang = currentLanguage\(\)/);
  assert.match(script, /scheduleRender\(0\)/);
  assert.match(styles, /\.settings-dialog\s*\{[^}]*width: 460px;/s);
  assert.match(
    styles,
    /\.mode-switch button,\s*\.view-switch button\s*\{[^}]*white-space: nowrap;/s,
  );
});

test("reading items use one Finder menu for more and context-click actions", () => {
  assert.doesNotMatch(script, /documentSubtitle[\s\S]*status\.watching/);
  assert.match(script, /action\.textContent = "•••"/);
  assert.match(script, /item\.addEventListener\("contextmenu"/);
  assert.match(script, /api\.showItemInFolder\(record\.path\)/);
  assert.match(styles, /\.document-item-menu\s*\{/);
});

test("Open and Recent are exclusive stacks with close actions and Markdown icons", () => {
  assert.match(html, /class="document-stack"/);
  assert.match(html, /data-i18n="reading\.opened">打开<\/b>/);
  assert.match(html, /data-i18n="reading\.recent">最近<\/b>/);
  assert.match(script, /close\.className = "item-close"/);
  assert.match(script, /remove\.className = "item-remove"/);
  assert.match(script, /await removeRecentDocument\(record\)/);
  assert.match(script, /record\.status === "missing"/);
  assert.match(script, /status\.missingRecent/);
  assert.match(script, /await closeOpenedDocument\(record\)/);
  assert.match(script, /const next = library\.opened\.at\(-1\)/);
  assert.match(
    script,
    /<rect x="2\.75" y="5\.25" width="18\.5" height="13\.5"/,
  );
  assert.match(styles, /\.document-icon svg\s*\{/);
  assert.match(styles, /\.document-actions\s*\{/);
  assert.match(styles, /\.document-item\.missing \.document-copy b\s*\{/);
});

test("Markdown files drop in with an affordance and document cards drag out natively", () => {
  assert.match(html, /id="drop-overlay"[\s\S]*?class="drop-zone"/);
  assert.match(html, /class="drop-icon"[\s\S]*?>MD<\/span>/);
  assert.match(script, /item\.draggable = Boolean\(record\.path\)/);
  assert.match(script, /item\.addEventListener\("dragstart"/);
  assert.match(script, /api\.startFileDrag\(record\.path\)/);
  assert.match(
    script,
    /Array\.from\(event\.dataTransfer\?\.types \|\| \[\]\)\.includes\("Files"\)/,
  );
  assert.match(styles, /\.drop-zone\s*\{[\s\S]*?border: 2px dashed #5d83e5;/);
});

test("settings use a compact Quick Capture row without subtitle or apply help", () => {
  assert.doesNotMatch(html, /data-i18n="settings\.subtitle"/);
  assert.doesNotMatch(html, /id="apply-shortcut"/);
  assert.doesNotMatch(html, /id="shortcut-help"/);
  assert.match(html, /class="shortcut-setting-row"/);
  assert.match(html, /id="edit-shortcut"/);
  assert.match(html, /id="disable-shortcut"/);
  assert.match(
    styles,
    /\.dialog-header\s*\{[\s\S]*?border-bottom: 0;/,
  );
  assert.match(
    script,
    /elements\.accelerator\.addEventListener\("keyup"[\s\S]*?scheduleShortcutApply/,
  );
  assert.match(script, /updateShortcutLabel\(\);\s*scheduleShortcutApply\(420\)/);
  assert.match(script, /async function applyShortcut\(\)/);
  assert.match(
    script,
    /elements\.shortcutEnabled\.checked = false;[\s\S]*?api\.updateSettings\(currentSettings\(\)\)/,
  );
});

test("Command+F searches the current preview without changing exported HTML", () => {
  assert.match(html, /id="preview-search-input"/);
  assert.match(html, /id="preview-search-previous"/);
  assert.match(html, /id="preview-search-next"/);
  assert.match(script, /function handlePreviewSearchShortcut\(event\)/);
  assert.match(
    script,
    /event\.metaKey[\s\S]*?event\.key\.toLowerCase\(\) !== "f"/,
  );
  assert.match(script, /function highlightSearchDocument\(frameDocument, query\)/);
  assert.match(script, /mark\.dataset\.markshotSearchIndex/);
  assert.match(script, /frame\.contentWindow\.addEventListener\(\s*"keydown"/s);
  assert.match(script, /event\.shiftKey \? -1 : 1/);
  assert.match(styles, /\.preview-search\s*\{/);
  assert.doesNotMatch(script, /preview\.previewHtml\s*=/);
});
