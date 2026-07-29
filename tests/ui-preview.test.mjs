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
});

test("desktop preview stays at a fixed 800 px reading width", () => {
  assert.match(
    script,
    /const maximumScale = record\.profile === "desktop" \? 0\.5 : 1;/,
  );
  assert.match(
    script,
    /availableWidth \/ \(record\.scaleWidth \|\| record\.width\)/,
  );
});

test("multi-page output is presented as one top-aligned column strip", () => {
  assert.match(html, /id="preview-layout"/);
  assert.doesNotMatch(html, /id="preview-page"/);
  assert.match(script, /function mountColumnFrames\(host, preview\)/);
  assert.match(script, /preview\.layout\.outputWidth/);
  assert.match(styles, /\.multi-column-inner\s*\{/);
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
