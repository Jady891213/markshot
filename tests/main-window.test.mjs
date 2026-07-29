import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const source = await fs.readFile(
  new URL("../src/main.mjs", import.meta.url),
  "utf8",
);

test("closing hides the Dock entry while minimizing stays native", () => {
  assert.match(
    source,
    /mainWindow\.on\("close",[\s\S]*?hideMainWindow\(\);\s*app\.dock\?\.hide\(\);/,
  );
  assert.doesNotMatch(source, /mainWindow\.on\("minimize"/);
  assert.match(
    source,
    /function showMainWindow\(\)[\s\S]*?void app\.dock\?\.show\(\);/,
  );
});

test("tray single click opens the menu and double click opens the window", () => {
  assert.match(source, /tray\.on\("click", scheduleTrayMenuPopup\)/);
  assert.match(
    source,
    /tray\.on\("double-click",[\s\S]*?cancelTrayMenuPopup\(\);[\s\S]*?showMainWindow\(\);/,
  );
  assert.match(source, /tray\.popUpContextMenu\(trayMenu\)/);
});

test("long-image capture retries transient failures and normalizes Retina output", () => {
  assert.match(source, /async function capturePageWithRetry\(window, page\)/);
  assert.match(source, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/);
  assert.match(source, /await window\.webContents\.capturePage\([\s\S]*?stayHidden: true/);
  assert.match(
    source,
    /if \(size\.width > 0 && size\.height > 0\)[\s\S]*?captured\.resize\(/,
  );
});

test("copy and quick generation compose at most four columns", () => {
  assert.match(source, /if \(record\.layout\.tooLong\)[\s\S]*?error\.tooManyColumns/);
  assert.match(source, /record\.outputPng = await composePngColumns\(columns\)/);
  assert.match(
    source,
    /if \(record\.layout\.tooLong\)[\s\S]*?return \{[\s\S]*?status: "too-long"/,
  );
});

test("show in Finder only accepts known document paths", () => {
  assert.match(source, /ipcMain\.handle\("documents:show-in-folder"/);
  assert.match(
    source,
    /const snapshot = documentLibrarySnapshot\(\);[\s\S]*?record\.path === target[\s\S]*?error\.unknownDocumentPath/,
  );
  assert.match(source, /shell\.showItemInFolder\(target\)/);
});
