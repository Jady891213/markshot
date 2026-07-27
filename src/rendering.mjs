import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import hljs from "highlight.js";
import { Marked } from "marked";
import markedFootnote from "marked-footnote";
import { markedHighlight } from "marked-highlight";
import sanitizeHtml from "sanitize-html";

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(SOURCE_DIR, "..");
const THEME_CSS = await fs.readFile(
  path.join(PROJECT_DIR, "assets", "theme.css"),
  "utf8",
);

export const MAX_PAGE_HEIGHT = 14_000;

export const OUTPUT_PROFILES = Object.freeze({
  mobile: Object.freeze({
    label: "移动端",
    width: 1080,
    fontSize: 32,
    padding: 40,
  }),
  desktop: Object.freeze({
    label: "PC",
    width: 1600,
    fontSize: 32,
    padding: 48,
  }),
});

const markdown = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, language) {
      const selectedLanguage = hljs.getLanguage(language)
        ? language
        : "plaintext";
      return hljs.highlight(code, { language: selectedLanguage }).value;
    },
  }),
  markedFootnote(),
);

function stripBom(value) {
  return value.replace(/^\uFEFF/, "");
}

export function decodeText(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return stripBom(new TextDecoder("utf-16le").decode(buffer.subarray(2)));
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return stripBom(new TextDecoder("utf-16be").decode(buffer.subarray(2)));
  }

  try {
    return stripBom(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
  } catch {
    // Some macOS rich-text pasteboard payloads are UTF-16 without a BOM.
  }

  const sampleLength = Math.min(buffer.length, 8192);
  let evenNulls = 0;
  let oddNulls = 0;
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] !== 0) continue;
    if (index % 2 === 0) evenNulls += 1;
    else oddNulls += 1;
  }

  const encoding = evenNulls > oddNulls ? "utf-16be" : "utf-16le";
  return stripBom(new TextDecoder(encoding).decode(buffer));
}

export function detectSourceFormat(source, requested = "auto") {
  if (requested && requested !== "auto") return requested;
  const sample = String(source).trimStart().slice(0, 1000);
  return /<(?:!doctype|html|body|main|article|section|div|h[1-6]|p|ul|ol|pre|table|blockquote|img)\b/i.test(
    sample,
  )
    ? "html"
    : "markdown";
}

function normalizePlainText(source) {
  const lines = String(source).replaceAll("\r\n", "\n").split("\n");
  let headingCount = 0;
  return lines
    .map((original, index) => {
      const line = original.trim();
      if (!line) return "";
      if (/^[•●○]\s+/.test(line)) {
        return line.replace(/^[•●○]\s+/, "- ");
      }

      const previousBlank = index === 0 || !lines[index - 1].trim();
      const nextBlank = index === lines.length - 1 || !lines[index + 1].trim();
      const length = [...line].length;
      const isShortStandalone =
        previousBlank &&
        nextBlank &&
        length <= 24 &&
        !/[。！？；，,.!?;]$/.test(line) &&
        !/^(?:[-*+>]|```|\d+[.)、])\s*/.test(line) &&
        !/https?:\/\//i.test(line);

      if (!isShortStandalone) return original;
      headingCount += 1;
      return `${headingCount === 1 ? "#" : "##"} ${line.replace(/[:：]$/, "")}`;
    })
    .join("\n");
}

export function sanitizeContent(html) {
  return sanitizeHtml(html, {
    allowedTags: [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "del",
      "s",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "hr",
      "a",
      "img",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "th",
      "td",
      "input",
      "details",
      "summary",
      "span",
      "div",
      "section",
      "sup",
    ],
    allowedAttributes: {
      a: [
        "href",
        "title",
        "id",
        "aria-label",
        "aria-describedby",
        "data-footnote-ref",
        "data-footnote-backref",
      ],
      img: ["src", "alt", "title", "width", "height", "loading"],
      code: ["class"],
      span: ["class"],
      input: ["type", "checked", "disabled"],
      section: ["class", "id", "data-footnotes"],
      li: ["class", "id"],
      h2: ["class", "id"],
      th: ["align"],
      td: ["align"],
      div: ["class"],
      ul: ["class"],
      ol: ["class"],
    },
    allowedClasses: {
      code: ["hljs", /^language-[a-z0-9_+-]+$/i],
      span: [/^hljs(?:-[a-z0-9_-]+)?$/i],
      section: ["footnotes"],
      h2: ["sr-only"],
      li: ["task-list-item"],
      ul: ["contains-task-list"],
      ol: ["contains-task-list"],
      div: ["table-wrap"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
      a: ["http", "https", "mailto"],
    },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
  });
}

export function renderSource(source, sourceFormat = "auto") {
  const format = detectSourceFormat(source, sourceFormat);
  if (format === "html") return sanitizeContent(source);
  const input = format === "plain" ? normalizePlainText(source) : source;
  return sanitizeContent(
    markdown.parse(String(input), { gfm: true, breaks: false }),
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function wrapTables(html) {
  return html
    .replaceAll("<table>", '<div class="table-wrap"><table>')
    .replaceAll("</table>", "</table></div>");
}

export function normalizeRenderOptions(input = {}) {
  const profile = input.profile === "desktop" ? "desktop" : "mobile";
  const preset = OUTPUT_PROFILES[profile];

  return {
    profile,
    theme: input.theme === "dark" ? "dark" : "light",
    background:
      input.background === "soft"
        ? "soft"
        : input.background === "none"
          ? "none"
          : "plain",
    showFooter:
      typeof input.showFooter === "boolean" ? input.showFooter : true,
    width: preset.width,
    fontSize: preset.fontSize,
    padding: preset.padding,
  };
}

export function buildDocument(input) {
  const source = String(input.source ?? "");
  if (!source.trim()) throw new Error("内容不能为空");

  const options = normalizeRenderOptions(input);
  const content = wrapTables(renderSource(source, input.sourceFormat));
  const title = String(input.title ?? "").trim();
  const titleBlock = title
    ? `<h1 class="document-title">${escapeHtml(title)}</h1>`
    : "";
  const generatedAt = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  const footerBlock = options.showFooter
    ? `<footer class="footer">
          <span>MarkShot</span>
          <span>${escapeHtml(generatedAt)}</span>
        </footer>`
    : "";

  const revision = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        source,
        sourceFormat: input.sourceFormat,
        title,
        ...options,
      }),
    )
    .digest("hex")
    .slice(0, 24);

  const html = `<!doctype html>
<html lang="zh-CN" data-theme="${options.theme}" data-background="${options.background}">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline';">
    <meta name="viewport" content="width=${options.width}, initial-scale=1">
    <style>
      :root {
        --canvas-width: ${options.width}px;
        --body-font-size: ${options.fontSize}px;
        --canvas-padding: ${options.padding}px;
        --card-padding-x: ${Math.round(options.padding * 1.18)}px;
        --card-padding-y: ${Math.round(options.padding * 1.12)}px;
      }
      ${THEME_CSS}
    </style>
  </head>
  <body>
    <main class="canvas">
      <article class="card">
        ${titleBlock}
        <section class="content">${content}</section>
        ${footerBlock}
      </article>
    </main>
  </body>
</html>`;

  return {
    revision,
    html,
    options,
    title,
  };
}

export function pageLayout(totalHeight, width) {
  const safeHeight = Math.max(1, Math.ceil(totalHeight));
  const pages = [];
  for (let y = 0, index = 0; y < safeHeight; y += MAX_PAGE_HEIGHT, index += 1) {
    pages.push({
      index,
      y,
      width,
      height: Math.min(MAX_PAGE_HEIGHT, safeHeight - y),
    });
  }
  return pages;
}

export function suggestedFileName(title, pageIndex, pageCount) {
  const base = String(title || "MarkShot")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const suffix =
    pageCount > 1 ? `-${String(pageIndex + 1).padStart(2, "0")}` : "";
  return `${base || "MarkShot"}${suffix}.png`;
}
