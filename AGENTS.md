# MarkShot

## Repository and releases

- The canonical repository is `https://github.com/Jady891213/markshot.git`, with `main` as the default development branch.
- Commit source, tests, documentation, and lightweight assets only. Never commit the compiled `.app`, Forge `out/`, DMG, ZIP, or generated preview images.
- Keep standalone interface prototypes under `docs/prototype`, use numbered filenames to preserve their design evolution, and treat `03-unified-reading-share.html` as the current UI baseline until a newer prototype supersedes it.
- Publish downloadable macOS builds as versioned GitHub Release assets. Every release includes both an App ZIP and a DMG named with the version and `macOS-arm64`.
- The current public build target is macOS arm64. Do not imply Intel or Windows support until those builds are implemented and verified.

## Product invariants

- The app is a resident macOS app with both a Dock entry and a menu-bar entry. Closing the management window hides it and removes the Dock entry while keeping the process and menu-bar entry alive; minimizing uses normal macOS behavior and keeps the Dock entry visible. Reopening the window restores the Dock entry, and only Quit ends the process.
- Image generation is memory-first. Do not create image files unless the user explicitly chooses Export.
- Losslessly recompress captured PNG scanline data before clipboard copy or export. Keep the exact dimensions, pixels, alpha channel, and PNG format; do not trade image quality for file size.
- Preserve UTF-8 and UTF-16LE/BE decoding with and without BOM.
- The normal preview is selectable DOM rendered from the same complete HTML and theme CSS used by image capture. Create NativeImage objects only when the user chooses Copy, Export, or Quick Generate.
- Keep every managed Preview and Split preview as one continuous single-column document, even when the final image requires multiple columns. Apply the 2–4 column layout only while copying or exporting the one combined PNG.
- Load preview documents from an in-memory Blob URL at their exact output width. The UI CSP must keep inline styles enabled for the sandboxed preview frame while scripts remain restricted to `self`; otherwise the shared theme CSS is silently blocked.
- Show the mobile profile inside a fixed phone-shaped preview with an independently scrollable screen. Device chrome is preview-only and must never appear in copied or exported images. The desktop profile remains a scaled document canvas without device chrome.
- Keep copy and export as one split action in the operation bar: the main button copies and its menu exports. Copy and export always act on the complete one-image output, including a 2–4 column composition when needed.
- Keep both halves of the copy/export split action exactly 32 px high with one continuous primary background and no visible internal divider.
- Use the macOS tray title `MS` with the system monospaced font and an empty image. This is intentionally text-only so the status item follows macOS light/dark menu-bar contrast and cannot collapse into an unreadable template-image blob.
- Single-clicking the menu-bar status icon opens its context menu. Double-clicking it opens the management window directly and cancels the pending single-click menu.
- Render quick-generation feedback as one non-activating macOS `hud` vibrancy panel with native rounded corners and shadow. Do not combine a transparent padded BrowserWindow with a second CSS shadow or backdrop layer.
- Reopening MarkShot from its `.app` icon activates and shows the management window.
- Keep the workspace unified around two sidebar modes: `即时` for editable pasted content and `阅读` for read-only local Markdown documents. Do not add horizontal document tabs.
- Only the fixed immediate textarea is editable. Preview, Split, Source, and every local document view are read-only.
- Preserve separate mode and per-document view state, scroll position, and active heading. Opening a local file switches to `阅读`; switching back restores the previous immediate or reading position.
- The reading sidebar contains explicit Open Markdown, Open, and Recent stacks. Open and Recent are mutually exclusive: opening a recent file appends it to Open, while closing an open file moves it to the front of Recent. Open cards have a quick close action; Recent cards have a quick remove-record action that never deletes the local file.
- Show a clear full-window affordance only while external Markdown files are hovering over the app. Open valid dropped files on release, and keep internal sidebar drag-out from triggering that affordance.
- Make every available Opened and Recent document card a native file drag source. Dragging a card into Finder, chat, mail, or another macOS app must transfer the original Markdown file, never plain text or a MarkShot-only payload.
- Watch opened local files with Node `fs.watch` and debounce refreshes. If a file disappears, keep its last content and mark it unavailable.
- Persist at most 20 deduplicated recent paths and timestamps. Check recent paths on startup and mark unavailable records in the sidebar; users can remove stale records without touching local files. Do not persist document bodies, immediate content, rendered HTML, previews, or image history.
- Keep the document body and right outline/style panel in one scroll container with the scrollbar at the far right. Style replaces Outline in the same position.
- Command+F opens a preview-only search bar for the current rendered document. Highlight every match without changing the Markdown or exported image, support previous/next navigation plus Enter/Shift+Enter, and close with Escape.
- Use flat radio-card choices with compact icons for profile, theme, and background instead of selects.
- The optional image title is gated by a local switch and is never persisted. The MarkShot footer switch is a persisted render setting used by both managed preview/export and quick generation.
- Plain and soft backgrounds must be visibly distinct in the shared final render CSS; preview and exported/copied images must use that same render document.
- Keep theme, optional image title, and image footer in one continuous style group, in that order. Label the footer switch `图片页脚`.
- Render image title, image footer, and shortcut enablement as custom sliding switches rather than native checkbox squares.
- When the dark theme is selected, make the desktop document stage and the outline/style panel one continuous dark reader surface with no light outer ring. Keep the fixed desktop reading width and font scale unchanged.
- Keep the Immediate input and read-only Source views on the same monospace font size and line height.
- Keep Clear and Paste at the left of the transparent immediate footer. Keep the secondary text action Save Document at its right; saving writes UTF-8 Markdown through a native dialog, opens it in Reading, and clears Immediate only after success.
- Default saved Markdown filenames to the first level-one title after removing Markdown decorations. If no level-one title exists, use `markshot_YYYYMMDD_HHMMSS.md`.
- In the Reading sidebar, show only the parent folder below available open documents; do not display a Watching suffix. Use the linear Markdown file glyph on document cards. Open cards expose a quick close icon plus the three-dot menu; both the three-dot action and context-click open the same document menu, currently containing only Show in Finder.
- Use the selected B wordmark as a lightweight replacement for the top-left App icon plus plain `MarkShot` text, and reuse the same wordmark in the optional image footer. Do not change the app icon, title-bar height, workspace structure, or add a brand subtitle.
- The background choices are None, Plain, and Soft. None removes canvas padding plus card background decoration so the output is only the themed Markdown content surface.
- Show the current global shortcut in the app title bar immediately left of a settings icon. Configure it in an in-app modal opened by that icon; do not expose a separate Hide Window button.
- Label the global shortcut setting `快速截图 / Quick Capture`. Keep it as a compact left/right settings row: current shortcut or Off on the right, an edit action, and a disable action only while enabled. Do not add a settings subtitle, header divider, apply button, or redundant shortcut instructions.
- Keep `contextIsolation: true`, `nodeIntegration: false`, and expose only the narrow preload API.
- Keep all MarkShot-owned user-facing copy in the shared `src/i18n.mjs` layer. Supported interface languages are `zh-CN` and `en`, with Simplified Chinese as the default and fallback for legacy or invalid settings.
- Language changes must apply immediately without reloading the renderer or resetting the active document, view, scroll position, or heading. Rebuild Tray, Dock, and application menus after a language change, and include language in render revisions so preview HTML, footer dates, and `lang` attributes cannot reuse stale output.
- Never translate user Markdown, filenames, paths, shortcut tokens, or system-owned macOS dialog controls. English layout adjustments may widen or reflow containers, but must not reduce the established interface font sizes.
- The default quick action is `Command+Option+T` with the mobile profile.
- Expose only two fixed output profiles: mobile at 1080 px with 32 px body text and 40 px canvas padding, and desktop at 1600 px with 32 output pixels (a visual 16 px at the fixed 0.5 preview scale) and 48 px canvas padding. Show desktop at a fixed 0.5 preview scale, producing an A4-like 800 px reading surface; larger windows add side whitespace instead of enlarging the document. Only shrink further when the available viewport is narrower than 800 px. Treat desktop as a wide reading layout instead of a stretched mobile card. Width, font size, and padding are profile-owned and are not user-editable.
- Use a neutral light-gray fenced-code container in the light theme and a medium charcoal container in the dark theme. Avoid near-black code blocks unless a future named theme explicitly requires them.
- Recognize fenced Mermaid, Markmap, Graphviz/DOT, Vega-Lite, and ECharts blocks and render them locally as sanitized static SVG. Keep diagram rendering offline, reject external resources, and parse ECharts/Vega-Lite as JSON5 configuration only; never execute arbitrary user JavaScript.
- Keep both root-level and flowchart-level Mermaid `htmlLabels` disabled and locked so labels render as native SVG text. The SVG sanitizer intentionally removes `foreignObject`; allowing Mermaid HTML labels makes node text disappear.
- A quick action must not overwrite the clipboard until the complete one-image output has been generated and validated.
- Content above 14,000 px flows into 2–4 top-aligned columns in one PNG. Balance column heights around the equal-height target, preferring a nearby heading boundary and then a top-level content-block boundary instead of hard-cutting at every 14,000 px. Every column keeps the selected mobile or desktop profile's original width, font size, and padding. Refuse content that would require more than four columns and keep the source clipboard intact.
- On Retina displays, render the hidden capture window at the inverse display zoom so its physical bitmap already matches the selected profile's target pixels. Do not render a 2x ultra-tall texture and then resize it down; that can exceed Chromium's texture limit, fail on the first attempt, and soften text.
- Capture multi-column slices by document-coordinate clip through the hidden page's debugging protocol, not by scrolling the offscreen window. Electron can report the correct scroll offset while still capturing the document origin when the `none` background is selected, which duplicates the first column.
- Do not add remote CSS, fonts, analytics, uploads, or unrestricted navigation.
- Do not add a localhost debug server, Vite, React, Vue, or a browser-only build unless a later requirement explicitly changes this boundary.

## Local workflow

```bash
npm install
npm run check
npm test
npm start
```

For small CSS, copy, spacing, or alignment-only changes, rebuild the local `.app` and perform focused launch/UI smoke validation instead of repeatedly running the full unit suite. Run targeted or full automated tests when the change affects rendering output, clipboard behavior, file handling, state, data structures, or other functional paths.

Build only the Apple Silicon `.app`:

```bash
npm run package:app
codesign --force --deep --sign - "out/MarkShot-darwin-arm64/MarkShot.app"
codesign --verify --deep --strict --verbose=2 "out/MarkShot-darwin-arm64/MarkShot.app"
```

After validation, replace the sibling `MarkShot.app` and remove the Forge `out/` directory. Release ZIP and DMG files may be created in a clearly marked temporary release directory, uploaded to GitHub Releases, and then deleted locally. Do not create plugin bundles, sample images, or permanent test output.

## Validation

- Test Chinese UTF-8, UTF-16LE, and UTF-16BE payloads, including BOM-less samples.
- Test headings, nested lists, tasks, tables, blockquotes, footnotes, code highlighting, links, images, and unsafe HTML removal.
- Test file selection, Command+O, multi-file drag-and-drop, native sidebar file drag-out, Open With, repeated-path deduplication, recent ordering, file refresh, and missing-file recovery.
- Verify Immediate and Reading restore their own active document, view, scroll position, and heading; Preview, Split, and Source must remain read-only.
- Verify Command+F from both the app chrome and focused preview iframe, including Chinese/English queries, no-result state, Enter/Shift+Enter navigation, long single-column previews, and Escape cleanup.
- Verify mobile 1080 px and desktop 1600 px; desktop preview stays at 800 px and does not grow with the window, while legacy or custom profile inputs normalize to mobile.
- Verify the global shortcut while another app has focus, successful clipboard image paste, 2–4 column composition, over-four-column refusal, shortcut conflict handling, and no disk output.
- Verify Mermaid, Markmap, Graphviz/DOT, Vega-Lite, and ECharts fences in both themes, including safe fallback output for invalid or externally linked specifications.
- Verify both languages at the minimum, default, and maximized window sizes. English toolbar controls, mode/view switches, column status, style cards, settings dialog, native menus, and HUD must not wrap, overlap, or clip; restart once in each language to verify persistence.
- On every manual or automated Electron run, quit the app and verify that no Electron Helper process remains. If the user expects the resident process to be ready after handoff, relaunch the verified final `.app` intentionally and report that it was left running.
- Mark disposable files with `TMP to delete` and remove them before handoff.
