import crypto from "node:crypto";
import { watch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createLocalizedError } from "./i18n.mjs";
import { decodeText } from "./rendering.mjs";

export const MAX_RECENT_FILES = 20;
export const MARKDOWN_EXTENSIONS = Object.freeze([
  ".md",
  ".markdown",
  ".mdown",
]);

export function isMarkdownPath(filePath) {
  return MARKDOWN_EXTENSIONS.includes(
    path.extname(String(filePath)).toLowerCase(),
  );
}

function timestampFileName(date) {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ];
  const time = [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ];
  return `markshot_${parts.join("")}_${time.join("")}.md`;
}

export function suggestedMarkdownFileName(source, date = new Date()) {
  const heading = String(source || "").match(
    /^\s{0,3}#(?!#)\s+(.+?)\s*#*\s*$/m,
  )?.[1];
  const title = String(heading || "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 80)
    .trim();
  return title ? `${title}.md` : timestampFileName(date);
}

export function normalizeRecentFiles(input, maximum = MAX_RECENT_FILES) {
  const seen = new Set();
  const normalized = [];
  for (const item of Array.isArray(input) ? input : []) {
    const filePath =
      typeof item === "string"
        ? item
        : typeof item?.path === "string"
          ? item.path
          : "";
    if (!filePath || !isMarkdownPath(filePath)) continue;
    const absolutePath = path.resolve(filePath);
    if (seen.has(absolutePath)) continue;
    seen.add(absolutePath);
    normalized.push({
      path: absolutePath,
      openedAt:
        typeof item?.openedAt === "number" && Number.isFinite(item.openedAt)
          ? item.openedAt
          : 0,
    });
    if (normalized.length >= maximum) break;
  }
  return normalized;
}

export async function loadRecentFiles(filePath) {
  try {
    const source = await fs.readFile(filePath, "utf8");
    return normalizeRecentFiles(JSON.parse(source));
  } catch (error) {
    if (error.code !== "ENOENT" && error.name !== "SyntaxError") throw error;
    return [];
  }
}

export async function saveRecentFiles(filePath, recentFiles) {
  const normalized = normalizeRecentFiles(recentFiles);
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

function documentId(filePath) {
  return `local-${crypto
    .createHash("sha1")
    .update(filePath)
    .digest("hex")
    .slice(0, 16)}`;
}

function publicDocument(record) {
  return {
    id: record.id,
    kind: "local",
    name: record.name,
    path: record.path,
    source: record.source,
    sourceFormat: "markdown",
    status: record.status,
    modifiedAt: record.modifiedAt,
  };
}

export class DocumentLibrary {
  constructor({
    recentPath,
    onEvent = () => {},
    getLanguage = () => "zh-CN",
  }) {
    this.recentPath = recentPath;
    this.onEvent = onEvent;
    this.getLanguage = getLanguage;
    this.documents = new Map();
    this.recentFiles = [];
    this.watchers = new Map();
    this.refreshTimers = new Map();
  }

  async initialize() {
    this.recentFiles = await loadRecentFiles(this.recentPath);
    return this.snapshot();
  }

  snapshot() {
    return {
      opened: [...this.documents.values()].map(publicDocument),
      recent: this.recentFiles.map((item) => ({ ...item })),
    };
  }

  async resolvePath(filePath) {
    const absolutePath = path.resolve(String(filePath));
    try {
      return await fs.realpath(absolutePath);
    } catch {
      return absolutePath;
    }
  }

  async openPaths(filePaths) {
    const documents = [];
    const errors = [];
    for (const candidate of filePaths || []) {
      try {
        documents.push(await this.openPath(candidate));
      } catch (error) {
        errors.push({
          path: String(candidate),
          error: error.message,
        });
      }
    }
    return { documents, errors };
  }

  async openPath(filePath) {
    if (!isMarkdownPath(filePath)) {
      throw createLocalizedError(
        this.getLanguage(),
        "error.unsupportedMarkdown",
      );
    }

    const resolvedPath = await this.resolvePath(filePath);
    const existing = [...this.documents.values()].find(
      (record) => record.path === resolvedPath,
    );
    if (existing) {
      await this.touchRecent(resolvedPath);
      return publicDocument(existing);
    }

    const [buffer, stat] = await Promise.all([
      fs.readFile(resolvedPath),
      fs.stat(resolvedPath),
    ]);
    if (!stat.isFile()) {
      throw createLocalizedError(this.getLanguage(), "error.notAFile");
    }

    const record = {
      id: documentId(resolvedPath),
      name: path.basename(resolvedPath),
      path: resolvedPath,
      source: decodeText(buffer),
      status: "watching",
      modifiedAt: stat.mtimeMs,
    };
    this.documents.set(record.id, record);
    this.startWatcher(record);
    await this.touchRecent(resolvedPath);
    return publicDocument(record);
  }

  async touchRecent(filePath) {
    const openedAt = Date.now();
    this.recentFiles = normalizeRecentFiles([
      { path: filePath, openedAt },
      ...this.recentFiles.filter((item) => item.path !== filePath),
    ]);
    this.recentFiles = await saveRecentFiles(
      this.recentPath,
      this.recentFiles,
    );
  }

  startWatcher(record) {
    this.stopWatcher(record.id);
    const fileName = path.basename(record.path);
    try {
      const watcher = watch(
        path.dirname(record.path),
        { persistent: false },
        (_eventType, changedName) => {
          if (changedName && String(changedName) !== fileName) return;
          this.scheduleRefresh(record.id);
        },
      );
      watcher.on("error", () => this.scheduleRefresh(record.id));
      this.watchers.set(record.id, watcher);
    } catch {
      record.status = "missing";
    }
  }

  scheduleRefresh(documentIdValue) {
    clearTimeout(this.refreshTimers.get(documentIdValue));
    const timer = setTimeout(() => {
      this.refreshTimers.delete(documentIdValue);
      this.refreshDocument(documentIdValue).catch(() => {});
    }, 180);
    this.refreshTimers.set(documentIdValue, timer);
  }

  async refreshDocument(documentIdValue) {
    const record = this.documents.get(documentIdValue);
    if (!record) return;
    try {
      const [buffer, stat] = await Promise.all([
        fs.readFile(record.path),
        fs.stat(record.path),
      ]);
      const nextSource = decodeText(buffer);
      const changed =
        nextSource !== record.source ||
        record.status !== "watching" ||
        record.modifiedAt !== stat.mtimeMs;
      record.source = nextSource;
      record.status = "watching";
      record.modifiedAt = stat.mtimeMs;
      if (changed) {
        this.onEvent({
          type: "changed",
          document: publicDocument(record),
        });
      }
    } catch (error) {
      if (error.code !== "ENOENT") return;
      if (record.status === "missing") return;
      record.status = "missing";
      this.onEvent({
        type: "missing",
        document: publicDocument(record),
      });
    }
  }

  closeDocument(documentIdValue) {
    const existed = this.documents.delete(documentIdValue);
    this.stopWatcher(documentIdValue);
    return existed;
  }

  async removeRecent(filePath) {
    const resolvedPath = path.resolve(String(filePath));
    this.recentFiles = this.recentFiles.filter(
      (item) => item.path !== resolvedPath,
    );
    this.recentFiles = await saveRecentFiles(
      this.recentPath,
      this.recentFiles,
    );
    return this.snapshot();
  }

  stopWatcher(documentIdValue) {
    clearTimeout(this.refreshTimers.get(documentIdValue));
    this.refreshTimers.delete(documentIdValue);
    const watcher = this.watchers.get(documentIdValue);
    if (watcher) watcher.close();
    this.watchers.delete(documentIdValue);
  }

  dispose() {
    for (const documentIdValue of this.watchers.keys()) {
      this.stopWatcher(documentIdValue);
    }
  }
}
