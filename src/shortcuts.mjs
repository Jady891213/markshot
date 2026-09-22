// Legacy accelerator/shortcutEnabled settings now belong to the PC action.
export const SHORTCUT_PROFILES = Object.freeze([
  { profile: "desktop", enabled: "shortcutEnabled", accelerator: "accelerator" },
  { profile: "mobile", enabled: "mobileShortcutEnabled", accelerator: "mobileAccelerator" },
]);

export function acceleratorIdentity(value) {
  const aliases = { cmd: "command", commandorcontrol: "command", cmdorctrl: "command", alt: "option", ctrl: "control" };
  return String(value).toLowerCase().split("+").map((key) => aliases[key.trim()] || key.trim()).sort().join("+");
}

export function createShortcutRegistry(nativeShortcuts, onCapture) {
  let registered = new Map();
  return {
    apply(settings) {
      const desired = new Map(SHORTCUT_PROFILES.filter((item) => settings[item.enabled])
        .map((item) => [item.profile, settings[item.accelerator]]));
      const identities = [...desired.values()].map(acceleratorIdentity);
      if (new Set(identities).size !== identities.length) return { ok: false, conflict: true };
      const added = new Map();
      for (const [profile, accelerator] of desired) {
        if (registered.get(profile) === accelerator) continue;
        let ok = false;
        try { ok = nativeShortcuts.register(accelerator, () => onCapture(profile)); } catch { /* Invalid accelerator. */ }
        if (!ok) {
          for (const value of added.values()) nativeShortcuts.unregister(value);
          return { ok: false, conflict: true, profile };
        }
        added.set(profile, accelerator);
      }
      // Keep old bindings alive until every replacement has registered successfully.
      for (const [profile, accelerator] of registered) {
        if (desired.get(profile) !== accelerator) nativeShortcuts.unregister(accelerator);
      }
      registered = desired;
      return { ok: true };
    },
  };
}
