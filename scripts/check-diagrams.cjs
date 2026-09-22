const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
app.whenReady().then(async () => {
  let win;
  try {
    const root = path.resolve(__dirname, '..');
    const { extractDiagramBlocks } = await import(path.join(root, 'src/rendering.mjs'));
    const { sanitizeDiagramSvg } = await import(path.join(root, 'src/diagrams.mjs'));
    win = new BrowserWindow({ show: false, webPreferences: {
      preload: path.join(root, 'src/diagram-preload.cjs'), sandbox: false,
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    }});
    await win.loadFile(path.join(root, 'src/diagram-host.html'));
    const wrapperOnly = process.argv.includes('--g2-wrapper');
    const spec = { type: 'interval', data: [{item: '负数科目甲', value: -508841776}, {item: '负数科目乙', value: -168307806}], encode: {x: 'item', y: 'value'} };
    const blocks = wrapperOnly
      ? [spec, {type: 'g2', config: spec}, {type: 'antv-g2', config: spec}].map(spec => ({type: 'g2', source: JSON.stringify(spec)}))
      : extractDiagramBlocks(fs.readFileSync(path.join(root, 'docs/MarkShot-渲染验收.md'), 'utf8')).diagrams;
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ftp://*/*'] }, (_, callback) => callback({ cancel: true }));
    for (const theme of (wrapperOnly ? ['light'] : ['light', 'dark'])) for (const [index, block] of blocks.entries()) {
      const payload = { ...block, id: `${theme}-${index}`, width: 680, theme };
      const svg = await win.webContents.executeJavaScript(`window.markshotDiagramHost.render(${JSON.stringify(payload)})`);
      const clean = sanitizeDiagramSvg(svg);
      if (!clean.includes('<svg') || !clean.includes('<text')) throw Error(`Missing SVG text: ${block.type}`);
      if (['g2', 'markmap'].includes(block.type) && !clean.includes('viewBox=')) throw Error(`Missing responsive SVG viewBox: ${block.type}`);
      console.log(JSON.stringify({ theme, type: block.type, bytes: clean.length, texts: (clean.match(/<text/g) || []).length }));
    }
    for (const source of ["{type:'interval',data:{type:'fetch',value:'local.csv'}}", "{type:'g2',config:{type:'interval',data:{type:'fetch',value:'local.csv'}}}", "{type:'g2',config:null}", "{type:'interval',data:{url:'https://example.com/data.json'}}", 'new Chart()']) {
      let rejected = false;
      try {
        await win.webContents.executeJavaScript(`window.markshotDiagramHost.render(${JSON.stringify({ type: 'g2', source, width: 680, theme: 'light' })})`);
      } catch { rejected = true; }
      if (!rejected) throw Error('Unsafe G2 input was accepted');
    }
    console.log('Unsafe G2 configurations rejected');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { if (win && !win.isDestroyed()) win.destroy(); app.quit(); }
});
