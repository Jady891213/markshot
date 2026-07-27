import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDocument,
  decodeText,
  normalizeRenderOptions,
  pageLayout,
  renderSource,
  sanitizeContent,
  suggestedFileName,
} from "../src/rendering.mjs";

function utf16be(value, withBom = false) {
  const littleEndian = Buffer.from(value, "utf16le");
  const bigEndian = Buffer.alloc(littleEndian.length + (withBom ? 2 : 0));
  let offset = 0;
  if (withBom) {
    bigEndian[0] = 0xfe;
    bigEndian[1] = 0xff;
    offset = 2;
  }
  for (let index = 0; index < littleEndian.length; index += 2) {
    bigEndian[offset + index] = littleEndian[index + 1];
    bigEndian[offset + index + 1] = littleEndian[index];
  }
  return bigEndian;
}

test("decodeText supports UTF-8 and UTF-16 clipboard payloads", () => {
  const source = "Markdown 中文内容：标题、列表和路径 /Users/测试";
  assert.equal(decodeText(Buffer.from(source, "utf8")), source);
  assert.equal(decodeText(Buffer.from(source, "utf16le")), source);
  assert.equal(
    decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(source, "utf16le")])),
    source,
  );
  assert.equal(decodeText(utf16be(source)), source);
  assert.equal(decodeText(utf16be(source, true)), source);
});

test("enhanced Markdown includes GFM, highlighting, footnotes and images", () => {
  const html = renderSource(`# 标题

**粗体**、~~删除线~~ 和自动链接：https://example.com

- [x] 已完成
- [ ] 待处理

| 列一 | 列二 |
| --- | --- |
| A | B |

\`\`\`javascript
const answer = 42;
\`\`\`

脚注引用[^1]。

[^1]: 脚注内容。

![示例](https://example.com/example.png)
`);
  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /<input checked disabled type="checkbox"/);
  assert.match(html, /<table>/);
  assert.match(html, /hljs-keyword/);
  assert.match(html, /class="footnotes"/);
  assert.match(html, /<img src="https:\/\/example.com\/example.png"/);
});

test("sanitizer removes executable HTML and unsafe image URLs", () => {
  const html = sanitizeContent(`
    <script>alert(1)</script>
    <img src="javascript:alert(1)" onerror="alert(2)" alt="危险">
    <a href="javascript:alert(3)">链接</a>
    <iframe src="https://example.com"></iframe>
    <p onclick="alert(4)">安全正文</p>
  `);
  assert.doesNotMatch(html, /script|onerror|onclick|iframe|javascript:/i);
  assert.match(html, /安全正文/);
});

test("the two output profiles enforce their own layout", () => {
  assert.deepEqual(normalizeRenderOptions({ profile: "mobile" }), {
    profile: "mobile",
    theme: "light",
    background: "plain",
    showFooter: true,
    width: 1080,
    fontSize: 32,
    padding: 40,
  });
  assert.deepEqual(normalizeRenderOptions({ profile: "desktop" }), {
    profile: "desktop",
    theme: "light",
    background: "plain",
    showFooter: true,
    width: 1600,
    fontSize: 32,
    padding: 48,
  });
  assert.deepEqual(
    normalizeRenderOptions({
      profile: "custom",
      width: 9999,
      fontSize: 4,
      padding: 999,
      theme: "dark",
      background: "soft",
    }),
    {
      profile: "mobile",
      theme: "dark",
      background: "soft",
      showFooter: true,
      width: 1080,
      fontSize: 32,
      padding: 40,
    },
  );
  assert.deepEqual(normalizeRenderOptions({ background: "none" }), {
    profile: "mobile",
    theme: "light",
    background: "none",
    showFooter: true,
    width: 1080,
    fontSize: 32,
    padding: 40,
  });
});

test("document generation and page splitting remain deterministic", () => {
  const result = buildDocument({
    source: "# 中文标题\n\n正文",
    sourceFormat: "markdown",
    profile: "mobile",
    title: "",
  });
  assert.match(result.html, /charset="utf-8"/);
  assert.match(result.html, /--canvas-width: 1080px/);
  assert.match(result.html, /<h1>中文标题<\/h1>/);
  assert.match(result.html, /<footer class="footer">/);
  assert.equal(result.revision.length, 24);

  const withoutFooter = buildDocument({
    source: "正文",
    sourceFormat: "markdown",
    showFooter: false,
  });
  assert.doesNotMatch(withoutFooter.html, /<footer class="footer">/);

  const withoutBackground = buildDocument({
    source: "仅 Markdown 内容",
    sourceFormat: "markdown",
    background: "none",
  });
  assert.match(withoutBackground.html, /data-background="none"/);
  assert.match(
    withoutBackground.html,
    /html\[data-background="none"\] \.canvas \{\s+padding: 0;/,
  );

  assert.deepEqual(pageLayout(28_001, 1080), [
    { index: 0, y: 0, width: 1080, height: 14_000 },
    { index: 1, y: 14_000, width: 1080, height: 14_000 },
    { index: 2, y: 28_000, width: 1080, height: 1 },
  ]);
  assert.equal(suggestedFileName("项目/进展", 1, 3), "项目 进展-02.png");
});
