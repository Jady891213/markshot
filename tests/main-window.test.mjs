import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const source = await fs.readFile(
  new URL("../src/main.mjs", import.meta.url),
  "utf8",
);
const preload = await fs.readFile(
  new URL("../src/preload.cjs", import.meta.url),
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

test("long-image capture uses document-coordinate clips and retries transient failures", () => {
  assert.match(source, /async function capturePageWithDebugger\(debuggerSession, page, imageScale\)/);
  assert.match(source, /Page\.captureScreenshot/);
  assert.match(source, /captureBeyondViewport: true/);
  assert.match(source, /y: page\.y \/ renderCaptureScaleFactor/);
  assert.match(source, /attempt === 0 \? 0 : attempt \/ imageScale/);
  assert.match(source, /\(page\.height \+ capturePadding\)/);
  assert.match(source, /debuggerSession\.detach\(\)/);
  assert.match(source, /async function capturePageWithRetry\(window, page, imageScale\)/);
  assert.match(source, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/);
  assert.match(source, /zoomFactor: 1 \/ renderCaptureScaleFactor/);
  assert.match(source, /renderDeviceScaleFactor \/ record\.options\.imageScale/);
  assert.match(source, /const expectedWidth = page\.width \* imageScale/);
  assert.match(
    source,
    /if \(pages\.length > 1\) throw error;[\s\S]*?capturePageWithRetry/,
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

test("document cards start a native file drag for known Markdown paths", () => {
  assert.match(
    preload,
    /startFileDrag: \(filePath\) =>\s*ipcRenderer\.send\("documents:start-drag", filePath\)/,
  );
  assert.match(source, /ipcMain\.on\("documents:start-drag"/);
  assert.match(
    source,
    /record\.path === target[\s\S]*?!known \|\| !isMarkdownPath\(target\)/,
  );
  assert.match(source, /statSync\(target\)\.isFile\(\)/);
  assert.match(
    source,
    /event\.sender\.startDrag\(\{ file: target, icon \}\)/,
  );
});

test("closing a document waits for recent-stack persistence", () => {
  assert.match(
    source,
    /ipcMain\.handle\("documents:close", async[\s\S]*?await documentLibrary\?\.closeDocument\(documentId\)/,
  );
});
