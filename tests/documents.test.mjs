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
