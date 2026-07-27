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
    /const scale = Math\.min\(maximumScale, availableWidth \/ record\.width\);/,
  );
});
