import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DocumentLibrary,
  isMarkdownPath,
  loadRecentFiles,
  normalizeRecentFiles,
  suggestedMarkdownFileName,
} from "../src/documents.mjs";

test("Markdown paths and recent entries are normalized and deduplicated", () => {
  assert.equal(isMarkdownPath("/tmp/说明.MD"), true);
  assert.equal(isMarkdownPath("/tmp/说明.markdown"), true);
  assert.equal(isMarkdownPath("/tmp/说明.txt"), false);

  const recent = normalizeRecentFiles([
    { path: "/tmp/a.md", openedAt: 2 },
    { path: "/tmp/a.md", openedAt: 1 },
    { path: "/tmp/b.txt", openedAt: 3 },
    { path: "/tmp/c.mdown", openedAt: 4 },
  ]);
  assert.deepEqual(
    recent.map((item) => path.basename(item.path)),
    ["a.md", "c.mdown"],
  );
});

test("saved Markdown names prefer the title and otherwise use a timestamp", () => {
  assert.equal(
    suggestedMarkdownFileName("# **季度报告：** [详情](https://example.com)"),
    "季度报告： 详情.md",
  );
  assert.equal(
    suggestedMarkdownFileName(
      "没有一级标题",
      new Date(2026, 6, 29, 9, 8, 7),
    ),
    "markshot_20260729_090807.md",
  );
});

test("document library opens, watches and marks local Markdown missing", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "MarkShot Documents TMP to delete."),
  );
  const markdownPath = path.join(directory, "中文说明.md");
  const recentPath = path.join(directory, "recent-documents.json");
  const events = [];
  const library = new DocumentLibrary({
    recentPath,
    onEvent: (event) => events.push(event),
  });

  try {
    await fs.writeFile(markdownPath, "# 第一版\n\n正文", "utf8");
    await library.initialize();
    const first = await library.openPaths([markdownPath]);
    assert.equal(first.errors.length, 0);
    assert.equal(first.documents.length, 1);
    assert.equal(first.documents[0].source, "# 第一版\n\n正文");
    assert.equal(first.documents[0].status, "watching");

    const duplicate = await library.openPaths([markdownPath]);
    assert.equal(duplicate.documents[0].id, first.documents[0].id);
    assert.equal(library.snapshot().opened.length, 1);
    assert.equal(library.snapshot().recent.length, 0);

    await fs.writeFile(markdownPath, "# 第二版\n\n外部更新", "utf8");
    await library.refreshDocument(first.documents[0].id);
    assert.equal(library.snapshot().opened[0].source, "# 第二版\n\n外部更新");
    assert.equal(events.at(-1).type, "changed");

    const persistedRecent = await loadRecentFiles(recentPath);
    const resolvedMarkdownPath = await fs.realpath(markdownPath);
    assert.equal(persistedRecent.length, 1);
    assert.equal(persistedRecent[0].path, resolvedMarkdownPath);
    assert.equal("source" in persistedRecent[0], false);

    await fs.unlink(markdownPath);
    await library.refreshDocument(first.documents[0].id);
    assert.equal(library.snapshot().opened[0].status, "missing");
    assert.equal(events.at(-1).type, "missing");
    assert.equal(
      library.snapshot().opened[0].source,
      "# 第二版\n\n外部更新",
    );

    await library.closeDocument(first.documents[0].id);
    assert.equal(library.snapshot().opened.length, 0);
    assert.equal(library.snapshot().recent.length, 1);
    assert.equal(library.snapshot().recent[0].path, resolvedMarkdownPath);
    assert.equal(library.snapshot().recent[0].status, "missing");
  } finally {
    library.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("opened and recent stacks are exclusive and closing moves a file to recent first", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "MarkShot Stack TMP to delete."),
  );
  const firstPath = path.join(directory, "第一篇.md");
  const secondPath = path.join(directory, "第二篇.md");
  const recentPath = path.join(directory, "recent-documents.json");
  const library = new DocumentLibrary({ recentPath });

  try {
    await Promise.all([
      fs.writeFile(firstPath, "# 第一篇", "utf8"),
      fs.writeFile(secondPath, "# 第二篇", "utf8"),
    ]);
    await library.initialize();
    const first = (await library.openPaths([firstPath])).documents[0];
    const second = (await library.openPaths([secondPath])).documents[0];

    let snapshot = library.snapshot();
    assert.deepEqual(
      snapshot.opened.map((document) => document.name),
      ["第一篇.md", "第二篇.md"],
    );
    assert.deepEqual(snapshot.recent, []);

    await library.closeDocument(first.id);
    snapshot = library.snapshot();
    assert.deepEqual(
      snapshot.opened.map((document) => document.name),
      ["第二篇.md"],
    );
    assert.deepEqual(
      snapshot.recent.map((entry) => path.basename(entry.path)),
      ["第一篇.md"],
    );

    await library.closeDocument(second.id);
    snapshot = library.snapshot();
    assert.deepEqual(
      snapshot.recent.map((entry) => path.basename(entry.path)),
      ["第二篇.md", "第一篇.md"],
    );

    await library.openPaths([firstPath]);
    snapshot = library.snapshot();
    assert.deepEqual(
      snapshot.opened.map((document) => document.name),
      ["第一篇.md"],
    );
    assert.deepEqual(
      snapshot.recent.map((entry) => path.basename(entry.path)),
      ["第二篇.md"],
    );
  } finally {
    library.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("recent list keeps only the newest twenty Markdown paths", () => {
  const input = Array.from({ length: 25 }, (_, index) => ({
    path: `/tmp/${index}.md`,
    openedAt: 100 - index,
  }));
  const recent = normalizeRecentFiles(input);
  assert.equal(recent.length, 20);
  assert.equal(path.basename(recent[0].path), "0.md");
  assert.equal(path.basename(recent.at(-1).path), "19.md");
});

test("recent files expose missing status and removal keeps the local file", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "MarkShot Recent Status TMP to delete."),
  );
  const existingPath = path.join(directory, "仍然存在.md");
  const missingPath = path.join(directory, "已经失效.md");
  const recentPath = path.join(directory, "recent-documents.json");
  const library = new DocumentLibrary({ recentPath });

  try {
    await fs.writeFile(existingPath, "# 仍然存在", "utf8");
    await fs.writeFile(
      recentPath,
      JSON.stringify([
        { path: existingPath, openedAt: 2 },
        { path: missingPath, openedAt: 1 },
      ]),
      "utf8",
    );

    await library.initialize();
    let snapshot = library.snapshot();
    assert.deepEqual(
      snapshot.recent.map((entry) => entry.status),
      ["available", "missing"],
    );

    await library.removeRecent(existingPath);
    snapshot = library.snapshot();
    assert.deepEqual(
      snapshot.recent.map((entry) => path.basename(entry.path)),
      ["已经失效.md"],
    );
    assert.equal(await fs.readFile(existingPath, "utf8"), "# 仍然存在");
  } finally {
    library.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
