import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_LANGUAGE, normalizeLanguage } from "./i18n.mjs";
import { normalizeRenderOptions } from "./rendering.mjs";

export const DEFAULT_SETTINGS = Object.freeze({
  language: DEFAULT_LANGUAGE,
  profile: "mobile",
  theme: "light",
  background: "plain",
  showFooter: true,
  width: 390,
  fontSize: 14,
  padding: 16,
  shortcutEnabled: true,
  accelerator: "Command+Option+T",
});

export function normalizeSettings(input = {}) {
  const render = normalizeRenderOptions({
    ...DEFAULT_SETTINGS,
    ...input,
  });
  const accelerator =
    typeof input.accelerator === "string" &&
    input.accelerator.trim().length >= 3 &&
    input.accelerator.trim().length <= 80
      ? input.accelerator.trim()
      : DEFAULT_SETTINGS.accelerator;

  return {
    ...render,
    language: normalizeLanguage(input.language),
    shortcutEnabled:
      typeof input.shortcutEnabled === "boolean"
        ? input.shortcutEnabled
        : DEFAULT_SETTINGS.shortcutEnabled,
    accelerator,
  };
}

export async function loadSettings(filePath) {
  try {
    const source = await fs.readFile(filePath, "utf8");
    return normalizeSettings(JSON.parse(source));
  } catch (error) {
    if (error.code !== "ENOENT" && error.name !== "SyntaxError") throw error;
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(filePath, settings) {
  const normalized = normalizeSettings(settings);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );
  await fs.rename(temporaryPath, filePath);
  return normalized;
}
