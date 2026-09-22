const { contextBridge } = require("electron");

let mermaidModule;
let markmapModules;
let vizInstance;
let vegaModules;
let echartsModule;
let json5Module;
let g2Modules;

const DIAGRAM_FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif';

function diagramTheme(payload) {
  const dark = payload.theme === "dark";
  return {
    dark, font: DIAGRAM_FONT,
    text: dark ? "#e2e8f0" : "#263244",
    muted: dark ? "#acb8c9" : "#627084",
    grid: dark ? "#303c4c" : "#e6ebf1",
    line: dark ? "#8797ad" : "#8b99ab",
    fill: dark ? "#1d2939" : "#f4f6f9",
    border: dark ? "#62748c" : "#b8c3d1",
    colors: dark
      ? ["#8caff0", "#79b9b2", "#c7aa7c", "#a99ac7", "#bb8f9c", "#91a5b7"]
      : ["#476fa8", "#498d87", "#b18c53", "#82749f", "#a46e80", "#70889a"],
  };
}

// Theme defaults must not erase explicitly authored chart styles.
function mergeTheme(base, overrides) {
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (["__proto__", "prototype", "constructor"].includes(key)) continue;
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergeTheme(base?.[key] || {}, value) : value;
  }
  return result;
}

async function parseJson5(source) {
  json5Module ||= import("json5");
  const module = await json5Module;
  return (module.default || module).parse(source);
}

function sizeOptions(payload, specification = {}) {
  const metadata = specification.$markshot || {};
  const width = Math.max(
    240,
    Math.min(Number(metadata.width || specification.width) || payload.width, payload.width),
  );
  const height = Math.max(
    240,
    Math.min(Number(metadata.height || specification.height) || Math.round(width * 0.58), 2400),
  );
  delete specification.$markshot;
  return { width: Math.round(width), height: Math.round(height) };
}

function assertInlineResources(value, path = "specification") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (
      key.toLowerCase() === "url" &&
      typeof child === "string" &&
      !child.startsWith("data:")
    ) {
      throw new Error(`External resources are not allowed (${nextPath})`);
    }
    if (
      typeof child === "string" &&
      /^(?:image:\/\/)?(?:https?:|file:|ftp:|\/\/)/i.test(child)
    ) {
      throw new Error(`External resources are not allowed (${nextPath})`);
    }
    assertInlineResources(child, nextPath);
  }
}

async function renderMermaid(payload) {
  mermaidModule ||= import("mermaid");
  const mermaid = (await mermaidModule).default;
  const theme = diagramTheme(payload);
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: "base",
    themeVariables: {
      darkMode: theme.dark, fontFamily: theme.font, fontSize: "14px",
      primaryColor: theme.fill, primaryTextColor: theme.text,
      primaryBorderColor: theme.border, lineColor: theme.line,
      secondaryColor: theme.fill, tertiaryColor: theme.fill,
      secondaryTextColor: theme.text, tertiaryTextColor: theme.text,
      textColor: theme.text, mainBkg: theme.fill,
      nodeBorder: theme.border, clusterBkg: theme.fill, clusterBorder: theme.grid,
      edgeLabelBackground: theme.dark ? "#141b26" : "#ffffff",
      actorBkg: theme.fill, actorBorder: theme.border, actorTextColor: theme.text,
      signalColor: theme.line, signalTextColor: theme.text,
      noteBkgColor: theme.fill, noteTextColor: theme.text, noteBorderColor: theme.border,
    },
    htmlLabels: false,
    flowchart: { htmlLabels: false, useMaxWidth: true, padding: 14, nodeSpacing: 30, rankSpacing: 38, curve: "linear" },
    secure: [
      "secure",
      "securityLevel",
      "startOnLoad",
      "maxTextSize",
      "htmlLabels",
    ],
  });
  await mermaid.parse(payload.source);
  const id = `markshot-${payload.id}`;
  const { svg } = await mermaid.render(id, payload.source);
  document.querySelector(`#d${id}`)?.remove();
  return svg;
}

async function renderMarkmap(payload) {
  markmapModules ||= Promise.all([
    import("markmap-lib"),
    import("markmap-view"),
  ]);
  const [lib, view] = await markmapModules;
  const theme = diagramTheme(payload);
  const transformer = new lib.Transformer([]);
  const { root } = transformer.transform(payload.source);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const nodeCount = Math.max(1, countMarkmapNodes(root));
  const height = Math.min(2400, Math.max(520, 220 + nodeCount * 54));
  svg.setAttribute("width", String(payload.width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${payload.width} ${height}`);
  document.body.replaceChildren(svg);
  const markmap = view.Markmap.create(
    svg,
    {
      autoFit: true,
      duration: 0,
      fitRatio: 0.94,
      maxWidth: 360,
      spacingHorizontal: 90,
      spacingVertical: 16,
      color: (node) => theme.colors[(node.state?.path?.split(".")[1] || 0) % theme.colors.length],
      lineWidth: () => 1.5,
      style: (id) => `.${id} { --markmap-font: 400 14px/20px ${theme.font}; --markmap-circle-open-bg: ${theme.dark ? "#141b26" : "#ffffff"}; }`,
    },
    root,
  );
  await markmap.fit();
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  // Convert measured HTML labels to inert SVG text before sanitization.
  // Range rectangles retain line wrapping and emphasis without foreignObject.
  for (const foreign of svg.querySelectorAll("foreignObject")) {
    const group = document.createElementNS(svg.namespaceURI, "g");
    const base = foreign.getBoundingClientRect();
    const scale = base.width / Number(foreign.getAttribute("width")) || 1;
    const walker = document.createTreeWalker(foreign, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const style = getComputedStyle(node.parentElement);
      for (let offset = 0; offset < node.length;) {
        const character = String.fromCodePoint(node.textContent.codePointAt(offset));
        const range = document.createRange();
        range.setStart(node, offset);
        offset += character.length;
        range.setEnd(node, offset);
        const rect = range.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const text = document.createElementNS(svg.namespaceURI, "text");
        text.setAttribute("x", String(Number(foreign.getAttribute("x")) + (rect.left - base.left) / scale));
        text.setAttribute("y", String(Number(foreign.getAttribute("y")) + (rect.top - base.top) / scale));
        text.setAttribute("dominant-baseline", "text-before-edge");
        text.setAttribute("font-size", style.fontSize);
        text.setAttribute("font-family", style.fontFamily);
        text.setAttribute("font-weight", style.fontWeight);
        text.setAttribute("font-style", style.fontStyle);
        text.setAttribute("fill", theme.text);
        text.textContent = character;
        group.append(text);
      }
    }
    foreign.replaceWith(group);
  }
  const content = svg.querySelector("g");
  if (content) {
    const box = content.getBBox();
    if (box.width > 0 && box.height > 0) {
      content.removeAttribute("transform");
      const naturalWidth = box.width + 32;
      const naturalHeight = box.height + 32;
      const scale = Math.min(1, payload.width / naturalWidth);
      svg.setAttribute("viewBox", `${box.x - 16} ${box.y - 16} ${naturalWidth} ${naturalHeight}`);
      svg.setAttribute("width", String(naturalWidth * scale));
      svg.setAttribute("height", String(naturalHeight * scale));
    }
  }
  const output = svg.outerHTML;
  markmap.destroy();
  document.body.replaceChildren();
  return output;
}

function countMarkmapNodes(node) {
  return 1 + (node.children || []).reduce(
    (count, child) => count + countMarkmapNodes(child),
    0,
  );
}

async function renderGraphviz(payload) {
  if (!vizInstance) {
    const { instance } = await import("@viz-js/viz");
    vizInstance = instance();
  }
  const viz = await vizInstance;
  const theme = diagramTheme(payload);
  return viz.renderString(payload.source, {
    format: "svg",
    engine: "dot",
    graphAttributes: { bgcolor: "transparent", pad: "0.15", nodesep: "0.35", ranksep: "0.45", fontname: "Helvetica", fontcolor: theme.text },
    nodeAttributes: { shape: "box", style: "rounded,filled", fillcolor: theme.fill, color: theme.border, fontcolor: theme.text, fontname: "Helvetica", fontsize: "13", penwidth: "1", margin: "0.18,0.12" },
    edgeAttributes: { color: theme.line, fontcolor: theme.muted, fontname: "Helvetica", fontsize: "12", arrowsize: "0.65", penwidth: "1.2" },
  });
}

async function renderVegaLite(payload) {
  vegaModules ||= Promise.all([
    import("vega"),
    import("vega-lite"),
    import("vega-interpreter"),
  ]);
  const [vega, vegaLite, interpreter] = await vegaModules;
  const specification = await parseJson5(payload.source);
  assertInlineResources(specification);
  const { width, height } = sizeOptions(payload, specification);
  const theme = diagramTheme(payload);
  specification.config = mergeTheme({
    background: "transparent", font: theme.font,
    view: { stroke: null },
    range: { category: theme.colors },
    mark: { color: theme.colors[0] },
    axis: { labelColor: theme.muted, titleColor: theme.text, labelFontSize: 12, titleFontSize: 12, titleFontWeight: 500, domain: false, ticks: false, gridColor: theme.grid, gridDash: [3, 3], labelPadding: 8, titlePadding: 12 },
    legend: { labelColor: theme.text, titleColor: theme.text, labelFontSize: 12 },
    title: { color: theme.text, fontSize: 15, fontWeight: 600 },
    line: { strokeWidth: 2 },
  }, specification.config);
  specification.width ??= width;
  specification.height ??= height;
  const compiled = vegaLite.compile(specification).spec;
  const loader = {
    load: async () => {
      throw new Error("External data is not allowed");
    },
    sanitize: async () => {
      throw new Error("External data is not allowed");
    },
  };
  const view = new vega.View(vega.parse(compiled, null, { ast: true }), {
    expr: interpreter.expressionInterpreter,
    renderer: "none",
    loader,
    logLevel: vega.Warn,
  });
  try {
    await view.runAsync();
    return await view.toSVG();
  } finally {
    view.finalize();
  }
}

function normalizeEchartsSource(source) {
  return String(source)
    .trim()
    .replace(/^(?:(?:const|let|var)\s+)?option\s*=\s*/i, "")
    .replace(/;\s*$/, "");
}

async function renderEcharts(payload) {
  echartsModule ||= import("echarts");
  const echarts = await echartsModule;
  const option = await parseJson5(normalizeEchartsSource(payload.source));
  assertInlineResources(option);
  const { width, height } = sizeOptions(payload, option);
  const theme = diagramTheme(payload);
  const axisTheme = {
    axisLine: { show: false, lineStyle: { color: theme.grid } },
    axisTick: { show: false },
    axisLabel: { color: theme.muted, fontSize: 12, margin: 10 },
    nameTextStyle: { color: theme.text, fontSize: 12 },
    splitLine: { lineStyle: { color: theme.grid, type: "dashed" } },
  };
  option.animation = false;
  const chart = echarts.init(
    null,
    {
      color: theme.colors, backgroundColor: "transparent",
      textStyle: { fontFamily: theme.font, color: theme.text, fontSize: 12 },
      title: { textStyle: { color: theme.text, fontSize: 15, fontWeight: 600 } },
      legend: { textStyle: { color: theme.muted } },
      categoryAxis: { ...axisTheme, splitLine: { show: false } },
      valueAxis: axisTheme, timeAxis: axisTheme, logAxis: axisTheme,
      line: { symbol: "circle", symbolSize: 5, lineStyle: { width: 2 }, itemStyle: { borderWidth: 1 } },
      grid: { left: 12, right: 16, top: 28, bottom: 12, containLabel: true },
    },
    {
      renderer: "svg",
      ssr: true,
      width,
      height,
    },
  );
  try {
    chart.setOption(option, { notMerge: true, lazyUpdate: false });
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}

async function renderG2(payload) {
  // G2's ESM build uses bundler-only directory imports; use its Node CJS entry.
  g2Modules ||= [require("@antv/g2"), require("@antv/g-svg")];
  const [g2, svgRenderer] = await g2Modules;
  const input = await parseJson5(payload.source);
  // Some Markdown producers wrap the v5 specification in a renderer envelope.
  const wrapped = input?.type === "g2" || input?.type === "antv-g2";
  const specification = wrapped ? input.config : input;
  if (!specification || Array.isArray(specification) || typeof specification !== "object") {
    throw new Error(wrapped
      ? "G2 wrapper requires a config object"
      : "G2 requires a JSON5 chart specification object");
  }
  assertInlineResources(specification);
  const { width, height } = sizeOptions(payload, specification);
  const theme = diagramTheme(payload);
  function makeStatic(node) {
    if (!node || typeof node !== "object") return;
    if (node.data?.type === "fetch" || node.type === "image") {
      throw new Error("G2 external data and image marks are not supported");
    }
    node.animate = false;
    node.interaction = {};
    for (const child of node.children || []) makeStatic(child);
  }
  makeStatic(specification);
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  const chart = new g2.Chart({ container, renderer: new svgRenderer.Renderer(), width, height });
  try {
    chart.options({ ...specification, width, height, autoFit: false,
      theme: typeof specification.theme === "string" ? specification.theme : mergeTheme({
        type: theme.dark ? "classicDark" : "classic",
        color: theme.colors[0], category10: theme.colors, category20: [...theme.colors, ...theme.colors],
        fontFamily: theme.font,
        axis: { labelFill: theme.muted, labelOpacity: 1, labelFontSize: 12, titleFill: theme.text, titleFontSize: 12, titleFontWeight: 500, gridStroke: theme.grid, gridStrokeOpacity: 1, gridLineDash: [3, 3], tick: false, line: false },
        line: { line: { lineWidth: 2 } },
      }, specification.theme) });
    await chart.render();
    const svg = container.querySelector("svg");
    if (!svg) throw new Error("G2 did not produce an SVG");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    return svg.outerHTML;
  } finally {
    chart.destroy();
    container.remove();
  }
}

async function render(payload) {
  document.body.replaceChildren();
  switch (payload.type) {
    case "mermaid":
      return renderMermaid(payload);
    case "markmap":
      return renderMarkmap(payload);
    case "graphviz":
      return renderGraphviz(payload);
    case "vega-lite":
      return renderVegaLite(payload);
    case "echarts":
      return renderEcharts(payload);
    case "g2":
      return renderG2(payload);
    default:
      throw new Error(`Unsupported diagram type: ${payload.type}`);
  }
}

contextBridge.exposeInMainWorld("markshotDiagramHost", { render });
