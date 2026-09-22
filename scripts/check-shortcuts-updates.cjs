// Focused smoke: real Electron UI/capture, isolated settings, in-memory clipboard.
const { app, BrowserWindow, clipboard, globalShortcut, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(root, 'TMP to delete MarkShot shortcuts-'));
app.setPath('userData', path.join(temporary, 'user-data'));
app.getVersion = () => require(path.join(root, 'package.json')).version;
const bindings = new Map();
globalShortcut.register = (key, callback) => {
  if (bindings.has(key)) return false;
  bindings.set(key, callback);
  return true;
};
globalShortcut.unregister = (key) => bindings.delete(key);
globalShortcut.unregisterAll = () => bindings.clear();
clipboard.readHTML = () => '';
clipboard.readText = () => '# MarkShot 快捷截图\n\n同一段内容，PC 与移动端使用独立排版。\n\n- 清晰度保持当前设置\n- 不切换预览场景';
let copied;
clipboard.writeImage = (image) => { copied = image.getSize(); };
const links = [];
shell.openExternal = async (url) => { links.push(url); };
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await check()) return; await pause(80); }
  throw Error('UI condition timed out');
}
let win;
(async () => {
  try {
    await import(path.join(root, 'src/main.mjs'));
    await until(() => {
      win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/src/ui/index.html'));
      return !!win;
    });
    const js = (source) => win.webContents.executeJavaScript(source);
    await until(() => js(`document.getElementById('profile-shortcut-desktop').textContent === '⌘⌥T' && document.getElementById('shortcut-summary').textContent.includes('移动端')`));
    assert.equal(bindings.size, 2);
    await js(`window.replyImage.updateSettings({profile:'mobile', imageScale:1})`);
    copied = null;
    await bindings.get('Command+Option+T')();
    assert.equal(copied.width, 800);
    assert.equal((await js('window.replyImage.getSettings()')).profile, 'mobile');
    await js(`window.replyImage.updateSettings({profile:'desktop'})`);
    copied = null;
    await bindings.get('Command+Option+M')();
    assert.equal(copied.width, 390);
    assert.equal((await js('window.replyImage.getSettings()')).profile, 'desktop');
    console.log('PC=800 / Mobile=390; preview profile unchanged');
    await js(`window.replyImage.registerShortcut('Command+Shift+M', 'mobile')`);
    await until(() => js(`document.getElementById('profile-shortcut-mobile').textContent === '⌘⇧M'`));
    const conflict = await js(`window.replyImage.registerShortcut('Command+Option+T', 'mobile')`);
    assert.equal(conflict.ok, false);
    await js(`window.replyImage.updateSettings({mobileShortcutEnabled:false})`);
    await until(() => js(`document.getElementById('profile-shortcut-mobile').textContent === '未启用'`));
    await js(`window.replyImage.registerShortcut('Command+Option+M','mobile')`);
    const liveUpdate = await js('window.replyImage.checkUpdates()');
    console.log('Live release check:', JSON.stringify(liveUpdate));
    await js(`document.getElementById('open-github').click()`);
    await until(() => links.length > 0);
    assert.equal(links[0], 'https://github.com/Jady891213/markshot');
    win.webContents.send('updates:changed', {status:'available',currentVersion:'0.6.0',latestVersion:'0.7.0',hasUpdate:true,errorCode:null});
    await until(() => js(`document.getElementById('open-settings').classList.contains('has-update')`));
    win.setSize(1120,650);
    await js(`if (!document.getElementById('app').classList.contains('style-open')) document.getElementById('toggle-style').click()`);
    for (const language of ['en', 'zh-CN']) {
      await js(`window.replyImage.updateSettings({language:${JSON.stringify(language)}})`);
      await js(`document.getElementById('open-settings').click()`);
      await pause(120);
      const measurements = await js(`(() => {
        const rows = [...document.querySelectorAll('.shortcut-setting-row')].map(row => ({width:row.clientWidth,scroll:row.scrollWidth, label:row.querySelector('b').textContent}));
        const cards = [...document.querySelectorAll('.profile-card > span')].map(el => ({height:el.getBoundingClientRect().height, width:el.clientWidth,scroll:el.scrollWidth}));
        return {rows,cards};
      })()`);
      for (const row of measurements.rows) assert.ok(row.scroll <= row.width, JSON.stringify(row));
      for (const card of measurements.cards) assert.equal(card.height,50);
      console.log(language, JSON.stringify(measurements));
      fs.writeFileSync(path.join(temporary, `${language}-settings.png`), (await win.webContents.capturePage()).toPNG());
      await js(`document.getElementById('close-settings').click()`);
      await pause(120);
      if (language === 'zh-CN') fs.writeFileSync(path.join(temporary, 'style.png'), (await win.webContents.capturePage()).toPNG());
    }
    console.log('SMOKE OK; screenshots:', temporary);
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.destroy();
    app.quit();
  }
})();
