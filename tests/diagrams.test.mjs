import assert from "node:assert/strict";
import test from "node:test";
import {
  diagramCacheKey,
  diagramErrorFigure,
  diagramFigure,
  sanitizeDiagramSvg,
} from "../src/diagrams.mjs";

test("diagram SVG sanitization removes executable and external content", () => {
  const sanitized = sanitizeDiagramSvg(`
    before
    <svg viewBox="0 0 10 10" onload="alert(1)">
      <script>alert(2)</script>
      <foreignObject><iframe src="https://example.com"></iframe></foreignObject>
      <a href="https://example.com"><path d="M0 0L1 1"></path></a>
      <use href="#local"></use>
    </svg>
    after
  `);
  assert.match(sanitized, /^<svg/);
  assert.doesNotMatch(
    sanitized,
    /script|foreignObject|onload|https:\/\/example\.com/i,
  );
  assert.match(sanitized, /href="#local"/);
});

test("diagram figures remain static and error fallbacks escape source", () => {
  const figure = diagramFigure(
    "mermaid",
    '<svg viewBox="0 0 1 1"><path d="M0 0"></path></svg>',
  );
  assert.match(figure, /diagram-mermaid/);
  assert.doesNotMatch(figure, /<script/);

  const error = diagramErrorFigure(
    "zh-CN",
    {
      language: "mermaid",
      source: "<script>alert(1)</script>",
    },
    "<invalid>",
  );
  assert.doesNotMatch(error, /<script>/);
  assert.match(error, /&lt;script&gt;/);
});

test("diagram cache keys include theme and output width", () => {
  const block = { type: "graphviz", source: "digraph { A -> B }" };
  const light = diagramCacheKey(block, { theme: "light", width: 1080 });
  assert.notEqual(
    light,
    diagramCacheKey(block, { theme: "dark", width: 1080 }),
  );
  assert.notEqual(
    light,
    diagramCacheKey(block, { theme: "light", width: 1600 }),
  );
});
