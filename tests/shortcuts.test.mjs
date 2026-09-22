import assert from "node:assert/strict";
import test from "node:test";
import { createShortcutRegistry, acceleratorIdentity } from "../src/shortcuts.mjs";
import { DEFAULT_SETTINGS } from "../src/settings.mjs";

function fixture() {
  const bindings = new Map();
  const captures = [];
  const registry = createShortcutRegistry({
    register(key, callback) {
      const id = acceleratorIdentity(key);
      if (bindings.has(id) || key === "Command+X") return false;
      if (key === "invalid") throw Error("Invalid accelerator");
      bindings.set(id, callback);
      return true;
    },
    unregister(key) { bindings.delete(acceleratorIdentity(key)); },
  }, (profile) => captures.push(profile));
  return { registry, bindings, captures };
}

test("two global shortcuts dispatch fixed desktop and mobile profiles", () => {
  const { registry, bindings, captures } = fixture();
  assert.equal(registry.apply(DEFAULT_SETTINGS).ok, true);
  bindings.get(acceleratorIdentity("Command+Option+T"))();
  bindings.get(acceleratorIdentity("Command+Option+M"))();
  assert.deepEqual(captures, ["desktop", "mobile"]);
  assert.equal(registry.apply({...DEFAULT_SETTINGS, profile:"mobile"}).ok, true);
  assert.equal(bindings.size, 2);
});

test("conflicts and invalid keys keep both previous shortcuts alive", () => {
  const { registry, bindings } = fixture();
  registry.apply(DEFAULT_SETTINGS);
  for (const key of ["Command+X", "invalid", "Alt+Cmd+T"]) {
    assert.equal(registry.apply({...DEFAULT_SETTINGS, mobileAccelerator:key}).ok, false);
    assert.equal(bindings.size, 2);
    assert.ok(bindings.has(acceleratorIdentity(DEFAULT_SETTINGS.mobileAccelerator)));
  }
});

test("partial registration failure rolls back new bindings", () => {
  const { registry, bindings } = fixture();
  registry.apply(DEFAULT_SETTINGS);
  assert.equal(registry.apply({...DEFAULT_SETTINGS, accelerator:"Command+Y", mobileAccelerator:"Command+X"}).ok, false);
  assert.equal(bindings.size, 2);
  assert.ok(!bindings.has(acceleratorIdentity("Command+Y")));
});

test("disable or customize one shortcut leaves the other untouched", () => {
  const { registry, bindings, captures } = fixture();
  registry.apply(DEFAULT_SETTINGS);
  assert.equal(registry.apply({...DEFAULT_SETTINGS, shortcutEnabled:false}).ok, true);
  assert.equal(bindings.size, 1);
  bindings.get(acceleratorIdentity(DEFAULT_SETTINGS.mobileAccelerator))();
  assert.deepEqual(captures, ["mobile"]);
  assert.equal(registry.apply({...DEFAULT_SETTINGS, mobileAccelerator:"Command+Shift+M"}).ok, true);
  assert.equal(bindings.size, 2);
  assert.ok(!bindings.has(acceleratorIdentity(DEFAULT_SETTINGS.mobileAccelerator)));
});
