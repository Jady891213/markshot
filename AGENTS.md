# MarkShot

## Repository and releases

- The canonical repository is `https://github.com/Jady891213/markshot.git`, with `main` as the default development branch.
- Commit source, tests, documentation, and lightweight assets only. Never commit the compiled `.app`, Forge `out/`, DMG, ZIP, or generated preview images.
- Keep standalone interface prototypes under `docs/prototype`, use numbered filenames to preserve their design evolution, and treat `03-unified-reading-share.html` as the current UI baseline until a newer prototype supersedes it.
- Publish downloadable macOS builds as versioned GitHub Release assets. Every release includes both an App ZIP and a DMG named with the version and `macOS-arm64`.
- The current public build target is macOS arm64. Do not imply Intel or Windows support until those builds are implemented and verified.

## Product invariants

- The app is a resident macOS app with both a Dock entry and a menu-bar entry. Closing the management window hides it; only Quit ends the process. Keep the Dock entry visible even when a third-party menu-bar organizer hides the tray item.
- Image generation is memory-first. Do not create image files unless the user explicitly chooses Export.
- Losslessly recompress captured PNG scanline data before clipboard copy or export. Keep the exact dimensions, pixels, alpha channel, and PNG format; do not trade image quality for file size.
- Preserve UTF-8 and UTF-16LE/BE decoding with and without BOM.
- The normal preview is selectable DOM rendered from the same complete HTML and theme CSS used by image capture. Create NativeImage objects only when the user chooses Copy, Export, or Quick Generate.
- Load preview documents from an in-memory Blob URL at their exact output width. The UI CSP must keep inline styles enabled for the sandboxed preview frame while scripts remain restricted to `self`; otherwise the shared theme CSS is silently blocked.
- Show the mobile profile inside a fixed phone-shaped preview with an independently scrollable screen. Device chrome is preview-only and must never appear in copied or exported images. The desktop profile remains a scaled document canvas without device chrome.
- Keep copy and export as one split action in the operation bar: the main button copies and its menu exports. For multi-page output, the compact page selector chooses the single page acted upon.
- Use the macOS tray title `MS` with the system monospaced font and an empty image. This is intentionally text-only so the status item follows macOS light/dark menu-bar contrast and cannot collapse into an unreadable template-image blob.
- Clicking the menu-bar status icon opens its context menu; it must not open the management window directly.
- Reopening MarkShot from its `.app` icon activates and shows the management window.
- Keep the workspace unified around two sidebar modes: `即时` for editable pasted content and `阅读` for read-only local Markdown documents. Do not add horizontal document tabs.
- Only the fixed immediate textarea is editable. Preview, Split, Source, and every local document view are read-only.
- Preserve separate mode and per-document view state, scroll position, and active heading. Opening a local file switches to `阅读`; switching back restores the previous immediate or reading position.
- The reading sidebar contains explicit Open Markdown, Opened, and Recent sections. Support multi-file selection, drag-and-drop, Command+O, second-instance file arguments, and macOS Open With.
- Watch opened local files with Node `fs.watch` and debounce refreshes. If a file disappears, keep its last content and mark it unavailable.
- Persist at most 20 deduplicated recent paths and timestamps. Do not persist document bodies, immediate content, rendered HTML, previews, or image history.
- Keep the document body and right outline/style panel in one scroll container with the scrollbar at the far right. Style replaces Outline in the same position.
- Use flat radio-card choices with compact icons for profile, theme, and background instead of selects.
- The optional image title is gated by a local switch and is never persisted. The MarkShot footer switch is a persisted render setting used by both managed preview/export and quick generation.
- Plain and soft backgrounds must be visibly distinct in the shared final render CSS; preview and exported/copied images must use that same render document.
- Keep theme, optional image title, and image footer in one continuous style group, in that order. Label the footer switch `图片页脚`.
- Keep Clear and Paste at the left of the transparent immediate footer. Keep the secondary text action Save Document at its right; saving writes UTF-8 Markdown through a native dialog, opens it in Reading, and clears Immediate only after success.
- Keep the top-left brand to a single `MarkShot` line without a status subtitle.
- The background choices are None, Plain, and Soft. None removes canvas padding plus card background decoration so the output is only the themed Markdown content surface.
- Show the current global shortcut in the app title bar immediately left of a settings icon. Configure it in an in-app modal opened by that icon; do not expose a separate Hide Window button.
- Keep `contextIsolation: true`, `nodeIntegration: false`, and expose only the narrow preload API.
- The default quick action is `Command+Option+T` with the mobile profile.
- Expose only two fixed output profiles: mobile at 1080 px with 36 px body text and 64 px canvas padding, and desktop at 1440 px with 32 px body text and 84 px canvas padding. Width, font size, and padding are profile-owned and are not user-editable.
- Use a neutral light-gray fenced-code container in the light theme and a medium charcoal container in the dark theme. Avoid near-black code blocks unless a future named theme explicitly requires them.
- A quick action must not overwrite the clipboard until a complete single-page image has been generated.
- Content above 14,000 px is paginated. The quick action opens the manager for page selection and keeps the source clipboard intact.
- Do not add remote CSS, fonts, analytics, uploads, or unrestricted navigation.
- Do not add a localhost debug server, Vite, React, Vue, or a browser-only build unless a later requirement explicitly changes this boundary.

## Local workflow

```bash
npm install
npm run check
npm test
npm start
```

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
- Test file selection, Command+O, multi-file drag-and-drop, Open With, repeated-path deduplication, recent ordering, file refresh, and missing-file recovery.
- Verify Immediate and Reading restore their own active document, view, scroll position, and heading; Preview, Split, and Source must remain read-only.
- Verify mobile 1080 px and desktop 1440 px; legacy or custom profile inputs must normalize to mobile.
- Verify the global shortcut while another app has focus, successful clipboard image paste, multi-page fallback, shortcut conflict handling, and no disk output.
- On every manual or automated Electron run, quit the app and verify that no Electron Helper process remains. If the user expects the resident process to be ready after handoff, relaunch the verified final `.app` intentionally and report that it was left running.
- Mark disposable files with `TMP to delete` and remove them before handoff.
