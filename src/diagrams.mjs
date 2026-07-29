import crypto from "node:crypto";

export const DIAGRAM_RENDERER_REVISION = "diagram-runtime-v1";
export const MAX_DIAGRAM_SOURCE_LENGTH = 200_000;
export const MAX_DIAGRAMS_PER_DOCUMENT = 50;
export const DIAGRAM_RENDER_TIMEOUT_MS = 10_000;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function removeExternalReferences(svg) {
  return svg
    .replace(
      /\s(?:href|xlink:href)\s*=\s*(["'])(?!#)[\s\S]*?\1/gi,
      "",
    )
    .replace(/\s(?:src)\s*=\s*(["'])[\s\S]*?\1/gi, "")
    .replace(/url\(\s*(?!["']?#)[^)]+\)/gi, "none");
}

export function sanitizeDiagramSvg(input) {
  const original = String(input ?? "").trim();
  const start = original.search(/<svg\b/i);
  const end = original.toLowerCase().lastIndexOf("</svg>");
  if (start < 0 || end < start) {
    throw new Error("Renderer did not return a valid SVG");
  }

  let svg = original.slice(start, end + 6);
  svg = svg
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/\s+on[a-z0-9:_-]+\s*=\s*(["'])[\s\S]*?\1/gi, "")
    .replace(/\s+on[a-z0-9:_-]+\s*=\s*[^\s>]+/gi, "")
    .replace(/@import[^;]+;?/gi, "");
  svg = removeExternalReferences(svg);
  return svg;
}

export function diagramCacheKey(block, options) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        revision: DIAGRAM_RENDERER_REVISION,
        type: block.type,
        source: block.source,
        theme: options.theme,
        width: options.width,
      }),
    )
    .digest("hex");
}

export function diagramFigure(type, svg) {
  return `<figure class="diagram-block diagram-${escapeHtml(type)}">
    <div class="diagram-surface">${sanitizeDiagramSvg(svg)}</div>
  </figure>`;
}

export function diagramErrorFigure(language, block, message) {
  const title =
    language === "en"
      ? `${block.language} diagram could not be rendered`
      : `${block.language} 图表渲染失败`;
  return `<figure class="diagram-block diagram-error">
    <figcaption>${escapeHtml(title)}</figcaption>
    <p>${escapeHtml(message)}</p>
    <pre><code>${escapeHtml(block.source)}</code></pre>
  </figure>`;
}
