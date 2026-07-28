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
