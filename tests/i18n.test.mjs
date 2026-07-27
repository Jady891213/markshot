import assert from "node:assert/strict";
import test from "node:test";
import {
  formatItemCount,
  formatLocalizedDate,
  formatOpenErrorCount,
  formatPageCount,
  formatPageOption,
  normalizeLanguage,
  translate,
} from "../src/i18n.mjs";

test("language normalization defaults legacy and unsupported values to Chinese", () => {
  assert.equal(normalizeLanguage(undefined), "zh-CN");
  assert.equal(normalizeLanguage("zh-CN"), "zh-CN");
  assert.equal(normalizeLanguage("en"), "en");
  assert.equal(normalizeLanguage("en-US"), "zh-CN");
});

test("translations support fallback and interpolation", () => {
  assert.equal(translate("en", "share.copy"), "Copy Image");
  assert.equal(
    translate("en", "toast.exported", { path: "/tmp/example.png" }),
    "Image exported: /tmp/example.png",
  );
  assert.equal(translate("en", "missing.key"), "missing.key");
});

test("English counters use singular and plural forms", () => {
  assert.equal(formatPageCount("en", 1), "1 page");
  assert.equal(formatPageCount("en", 2), "2 pages");
  assert.equal(formatItemCount("en", 1), "1 item");
  assert.equal(formatItemCount("en", 2), "2 items");
  assert.equal(formatOpenErrorCount("en", 1), "1 file could not be opened");
  assert.equal(formatOpenErrorCount("en", 2), "2 files could not be opened");
  assert.equal(formatPageOption("en", 2, 4), "Page 2 of 4");
});

test("footer dates follow the selected language", () => {
  const date = new Date("2026-07-28T14:05:00+08:00");
  const chinese = formatLocalizedDate("zh-CN", date);
  const english = formatLocalizedDate("en", date);
  assert.notEqual(chinese, english);
  assert.match(chinese, /2026/);
  assert.match(english, /2026/);
});
