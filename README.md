# MarkShot

MarkShot 是一款常驻 macOS 的 Markdown 阅读与分享工具。

MarkShot 把 Markdown 阅读和图片分享放在同一个工作台中：既可以粘贴一段内容即时预览、复制为长图，也可以打开本地 Markdown 文件进行只读阅读。预览是可选择文字的真实文档，只有复制或导出时才会生成图片。

当前版本：`v0.1.0`，仅提供 macOS Apple Silicon 构建。

## 界面原型

阅读与分享工作台的方案演进保存在 [`docs/prototype`](docs/prototype/README.md)。其中 `03-unified-reading-share.html` 是当前界面基线，其他编号文件用于追踪早期设计决策。

## 当前功能

- Markdown、纯文本和富文本预览
- 标题、列表、任务列表、表格、引用、代码高亮、脚注和安全 HTML
- 本地 Markdown 多文件打开、拖放打开、`Command+O` 与 Finder“打开方式”
- 已打开文档、最近打开记录和外部修改实时刷新
- “即时 / 阅读”独立状态，以及预览、双栏、源码三种只读视图
- 可选择文字的真实 DOM 预览，与最终图片共用渲染 HTML 和主题 CSS
- 即时内容可通过原生保存对话框暂存为 UTF-8 Markdown
- 移动端与 PC 两种固定输出规格
- 浅色、深色主题与多种图片背景
- 图片标题和 MarkShot 页脚
- 图片复制、手动导出与超长内容分页
- 全局快捷键快速读取剪贴板并生成图片
- Dock 与菜单栏常驻
- UTF-8、UTF-16LE 和 UTF-16BE 文本识别

## 开发环境

- macOS
- Apple Silicon
- Node.js 20
- Electron 39
- Electron Forge 7

安装依赖并启动：

```bash
npm install
npm start
```

运行检查和测试：

```bash
npm run check
npm test
```

构建 Apple Silicon App：

```bash
npm run package:app
codesign --force --deep --sign - "out/MarkShot-darwin-arm64/MarkShot.app"
codesign --verify --deep --strict --verbose=2 "out/MarkShot-darwin-arm64/MarkShot.app"
```

## 发布

源码由 `main` 分支维护。编译后的 `.app`、ZIP 和 DMG 不提交到 Git 仓库；正式版本在对应的 GitHub Release 中提供：

- `MarkShot-v0.1.0-macOS-arm64.zip`：解压后直接获得 MarkShot.app
- `MarkShot-v0.1.0-macOS-arm64.dmg`：标准 macOS 磁盘映像

当前构建使用临时签名，尚未进行 Apple Developer ID 签名和公证。其他用户首次运行公开下载版本时，可能遇到 macOS Gatekeeper 提示。

## 数据与隐私

MarkShot 默认在本地完成读取和渲染，不上传正文，不持久化即时内容、已打开文档正文、渲染 HTML、预览图片或图片历史。最近记录只保存最多 20 条文件路径和打开时间。只有用户主动保存即时文档或选择“导出图片”时才会写入文件。
