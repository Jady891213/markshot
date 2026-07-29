const { contextBridge } = require("electron");

let mermaidModule;
let markmapModules;
let vizInstance;
let vegaModules;
let echartsModule;
let json5Module;

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
    Math.min(Number(metadata.height || specification.height) || 600, 2400),
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
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: payload.theme === "dark" ? "dark" : "default",
    flowchart: { htmlLabels: false, useMaxWidth: true },
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
  const transformer = new lib.Transformer([]);
  const { root } = transformer.transform(payload.source);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const nodeCount = Math.max(1, countMarkmapNodes(root));
  const height = Math.min(2400, Math.max(520, 220 + nodeCount * 54));
  svg.setAttribute("width", String(payload.width));
  svg.setAttribute("height", String(height));
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
    },
    root,
  );
  await markmap.fit();
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
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
  return viz.renderString(payload.source, {
    format: "svg",
    engine: "dot",
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
  option.animation = false;
  const chart = echarts.init(
    null,
    payload.theme === "dark" ? "dark" : null,
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
    default:
      throw new Error(`Unsupported diagram type: ${payload.type}`);
  }
}

contextBridge.exposeInMainWorld("markshotDiagramHost", { render });
