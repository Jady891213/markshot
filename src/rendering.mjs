import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import hljs from "highlight.js";
import { Marked } from "marked";
import markedFootnote from "marked-footnote";
import { markedHighlight } from "marked-highlight";
import sanitizeHtml from "sanitize-html";
import {
  createLocalizedError,
  formatLocalizedDate,
  normalizeLanguage,
} from "./i18n.mjs";

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(SOURCE_DIR, "..");
const THEME_CSS = await fs.readFile(
  path.join(PROJECT_DIR, "assets", "theme.css"),
  "utf8",
);
const BRAND_WORDMARK_DATA_URL = `data:image/png;base64,${(
  await fs.readFile(path.join(PROJECT_DIR, "assets", "brand-wordmark.png"))
).toString("base64")}`;

export const MAX_PAGE_HEIGHT = 14_000;
export const MAX_IMAGE_COLUMNS = 4;

const DIAGRAM_LANGUAGES = Object.freeze({
  mermaid: "mermaid",
  markmap: "markmap",
  dot: "graphviz",
  graphviz: "graphviz",
  "vega-lite": "vega-lite",
  vegalite: "vega-lite",
  echarts: "echarts",
});

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

export function extractDiagramBlocks(source, sourceFormat = "auto") {
  const original = String(source ?? "");
  const format = detectSourceFormat(original, sourceFormat);
  if (format === "html") return { source: original, diagrams: [] };

  const diagrams = [];
  const prepared = original.replace(
    /^ {0,3}(`{3,}|~{3,})[ \t]*([a-z0-9_-]+)[^\n]*\n([\s\S]*?)^ {0,3}\1[ \t]*$/gim,
    (block, _fence, language, body) => {
      const type = DIAGRAM_LANGUAGES[String(language).toLowerCase()];
      if (!type) return block;
      const index = diagrams.length;
      const token = `MARKSHOT_DIAGRAM_${String(index).padStart(4, "0")}`;
      diagrams.push({
        index,
        type,
        language: String(language).toLowerCase(),
        source: String(body).replace(/\n$/, ""),
        token,
      });
      return `\`\`\`markshot-diagram\n${token}\n\`\`\``;
    },
  );
  return { source: prepared, diagrams };
}

function replaceDiagramPlaceholders(html, diagramHtml = []) {
  return diagramHtml.reduce((result, replacement, index) => {
    const token = `MARKSHOT_DIAGRAM_${String(index).padStart(4, "0")}`;
    const pattern = new RegExp(
      `<pre><code class="hljs language-markshot-diagram">${token}\\n?</code></pre>`,
      "g",
    );
    return result.replace(pattern, replacement);
  }, html);
}

export function renderSource(
  source,
  sourceFormat = "auto",
  diagramHtml = [],
) {
  const format = detectSourceFormat(source, sourceFormat);
  if (format === "html") return sanitizeContent(source);
  const input = format === "plain" ? normalizePlainText(source) : source;
  const sanitized = sanitizeContent(
    markdown.parse(String(input), { gfm: true, breaks: false }),
  );
  return replaceDiagramPlaceholders(sanitized, diagramHtml);
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
    language: normalizeLanguage(input.language),
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
  if (!source.trim()) {
    throw createLocalizedError(input.language, "error.emptyContent");
  }

  const options = normalizeRenderOptions(input);
  const content = wrapTables(
    renderSource(
      input.preparedSource ?? source,
      input.sourceFormat,
      input.diagramHtml,
    ),
  );
  const title = String(input.title ?? "").trim();
  const titleBlock = title
    ? `<h1 class="document-title">${escapeHtml(title)}</h1>`
    : "";
  const generatedAt = formatLocalizedDate(options.language);
  const footerBlock = options.showFooter
    ? `<footer class="footer">
          <img class="footer-wordmark" src="${BRAND_WORDMARK_DATA_URL}" alt="MarkShot">
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
        diagramRevision: input.diagramRevision || "",
        ...options,
      }),
    )
    .digest("hex")
    .slice(0, 24);

  const html = `<!doctype html>
<html lang="${options.language}" data-theme="${options.theme}" data-background="${options.background}">
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

function normalizedBreakpoints(breakpoints, totalHeight) {
  const byPosition = new Map();
  for (const candidate of Array.isArray(breakpoints) ? breakpoints : []) {
    const value =
      typeof candidate === "number"
        ? { y: candidate, kind: "block", level: 7 }
        : candidate;
    const y = Math.round(Number(value?.y));
    if (!Number.isFinite(y) || y <= 0 || y >= totalHeight) continue;
    const kind = value?.kind === "heading" ? "heading" : "block";
    const level =
      kind === "heading"
        ? Math.min(6, Math.max(1, Math.round(Number(value?.level) || 6)))
        : 7;
    const previous = byPosition.get(y);
    if (
      !previous ||
      (kind === "heading" &&
        (previous.kind !== "heading" || level < previous.level))
    ) {
      byPosition.set(y, { y, kind, level });
    }
  }
  return [...byPosition.values()].sort((left, right) => left.y - right.y);
}

function nearestBreakpoint(
  candidates,
  ideal,
  minimum,
  maximum,
  kind,
  radius,
  targetHeight,
) {
  let selected;
  let selectedScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (
      candidate.kind !== kind ||
      candidate.y < minimum ||
      candidate.y > maximum
    ) {
      continue;
    }
    const distance = Math.abs(candidate.y - ideal);
    if (distance > radius) continue;
    const headingPenalty =
      kind === "heading" ? (candidate.level - 1) * targetHeight * 0.012 : 0;
    const score = distance + headingPenalty;
    if (score < selectedScore) {
      selected = candidate.y;
      selectedScore = score;
    }
  }
  return selected;
}

export function pageLayout(totalHeight, width, breakpoints = []) {
  const safeHeight = Math.max(1, Math.ceil(totalHeight));
  const columnCount = Math.ceil(safeHeight / MAX_PAGE_HEIGHT);
  const targetHeight = safeHeight / columnCount;
  const candidates = normalizedBreakpoints(breakpoints, safeHeight);
  const boundaries = [0];

  for (let index = 1; index < columnCount; index += 1) {
    const previous = boundaries.at(-1);
    const remainingColumns = columnCount - index;
    const ideal = Math.round((safeHeight * index) / columnCount);
    const minimum = Math.max(
      previous + 1,
      safeHeight - remainingColumns * MAX_PAGE_HEIGHT,
    );
    const maximum = Math.min(
      previous + MAX_PAGE_HEIGHT,
      safeHeight - remainingColumns,
    );
    const heading = nearestBreakpoint(
      candidates,
      ideal,
      minimum,
      maximum,
      "heading",
      Math.max(240, targetHeight * 0.2),
      targetHeight,
    );
    const block =
      heading ??
      nearestBreakpoint(
        candidates,
        ideal,
        minimum,
        maximum,
        "block",
        Math.max(160, targetHeight * 0.1),
        targetHeight,
      );
    boundaries.push(
      block ?? Math.min(maximum, Math.max(minimum, ideal)),
    );
  }
  boundaries.push(safeHeight);

  const pages = [];
  for (let index = 0; index < columnCount; index += 1) {
    const y = boundaries[index];
    pages.push({
      index,
      y,
      width,
      height: boundaries[index + 1] - y,
    });
  }
  return pages;
}

export function imageLayout(totalHeight, width, breakpoints = []) {
  const pages = pageLayout(totalHeight, width, breakpoints);
  const columnCount = pages.length;
  return {
    pages,
    columnCount,
    tooLong: columnCount > MAX_IMAGE_COLUMNS,
    outputWidth:
      columnCount <= MAX_IMAGE_COLUMNS ? width * columnCount : width,
    outputHeight:
      columnCount <= MAX_IMAGE_COLUMNS
        ? Math.max(...pages.map(({ height }) => height))
        : 0,
  };
}

export function suggestedFileName(title) {
  const base = String(title || "MarkShot")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${base || "MarkShot"}.png`;
}
