# MarkShot

## Repository and releases

- The canonical repository is `https://github.com/Jady891213/markshot.git`, with `main` as the default development branch.
- Commit source, tests, documentation, and lightweight assets only. Never commit the compiled `.app`, Forge `out/`, DMG, ZIP, or generated preview images.
- Publish downloadable macOS builds as versioned GitHub Release assets. Every release includes both an App ZIP and a DMG named with the version and `macOS-arm64`.
- The current public build target is macOS arm64. Do not imply Intel or Windows support until those builds are implemented and verified.

## Product invariants

- The app is a resident macOS app with both a Dock entry and a menu-bar entry. Closing the management window hides it; only Quit ends the process. Keep the Dock entry visible even when a third-party menu-bar organizer hides the tray item.
- Image generation is memory-first. Do not create image files unless the user explicitly chooses Export.
- Preserve UTF-8 and UTF-16LE/BE decoding with and without BOM.
- Preview pages must be downscaled from the same in-memory NativeImage objects used by copy/export, rather than independently scaling an iframe.
- Keep copy and export as persistent right-aligned actions in the preview heading. For multi-page output, the heading page selector chooses the single page shown and acted upon.
- Use the macOS tray title `MS` with the system monospaced font and an empty image. This is intentionally text-only so the status item follows macOS light/dark menu-bar contrast and cannot collapse into an unreadable template-image blob.
- Clicking the menu-bar status icon opens its context menu; it must not open the management window directly.
- Reopening MarkShot from its `.app` icon activates and shows the management window.
- Keep the management UI as three full-height columns: plain-text input, final-image preview, and a single vertical configuration sidebar.
- Use flat radio-card choices with compact icons for profile, theme, and background instead of selects.
- The optional image title is gated by a local switch and is never persisted. The MarkShot footer switch is a persisted render setting used by both managed preview/export and quick generation.
- Plain and soft backgrounds must be visibly distinct in the shared final render CSS; preview and exported/copied images must use that same render document.
- Keep theme, optional image title, and image footer in one continuous sidebar group, in that order. Label the footer switch `图片页脚`.
- Keep Paste, Generate Preview, and Clear together in the text-column heading; do not add a second action row below the editor.
- Keep the text-heading actions ordered Clear, Paste, Preview, and label the primary action `预览`.
- Keep the top-left brand to a single `MarkShot` line without a status subtitle.
- The background choices are None, Plain, and Soft. None removes canvas padding plus card background decoration so the output is only the themed Markdown content surface.
- Show the current global shortcut in the app title bar immediately left of a settings icon. Configure it in an in-app modal opened by that icon; do not expose a separate Hide Window button.
- Keep `contextIsolation: true`, `nodeIntegration: false`, and expose only the narrow preload API.
- The default quick action is `Command+Option+T` with the mobile profile.
- Expose only two fixed output profiles: mobile at 1080 px with 28 px body text, and desktop at 1440 px with 26 px body text. Width, font size, and padding are profile-owned and are not user-editable.
- A quick action must not overwrite the clipboard until a complete single-page image has been generated.
- Content above 14,000 px is paginated. The quick action opens the manager for page selection and keeps the source clipboard intact.
- Do not add remote CSS, fonts, analytics, uploads, or unrestricted navigation.

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
- Verify mobile 1080 px and desktop 1440 px; legacy or custom profile inputs must normalize to mobile.
- Verify the global shortcut while another app has focus, successful clipboard image paste, multi-page fallback, shortcut conflict handling, and no disk output.
- On every manual or automated Electron run, quit the app and verify that no Electron Helper process remains. If the user expects the resident process to be ready after handoff, relaunch the verified final `.app` intentionally and report that it was left running.
- Mark disposable files with `TMP to delete` and remove them before handoff.
