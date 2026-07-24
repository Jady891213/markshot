import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from "../src/settings.mjs";

test("settings default to mobile and the approved global shortcut", () => {
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
});

test("settings persist presentation defaults without source content", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "MarkShot Settings TMP to delete."),
  );
  const filePath = path.join(directory, "settings.json");
  try {
    const saved = await saveSettings(filePath, {
      profile: "desktop",
      theme: "dark",
      background: "soft",
      showFooter: false,
      width: 640,
      fontSize: 40,
      padding: 24,
      shortcutEnabled: false,
      accelerator: "Command+Shift+Y",
      source: "不应保存的正文",
      title: "不应保存的标题",
    });
    const loaded = await loadSettings(filePath);
    assert.deepEqual(loaded, saved);
    assert.equal(saved.width, 1440);
    assert.equal(saved.fontSize, 26);
    assert.equal(saved.padding, 72);
    assert.equal(saved.showFooter, false);
    assert.equal("source" in loaded, false);
    assert.equal("title" in loaded, false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
