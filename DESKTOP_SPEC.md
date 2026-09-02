# Desktop App Spec

## Goal

Package the existing WeChat article/comment exporter as a desktop app that can run on:

- macOS Apple Silicon (`arm64`)
- macOS Intel (`x64`)
- Windows (`x64`)

The first desktop milestone should preserve the current Nuxt/Nitro architecture and avoid rewriting the WeChat proxy, download, export, or IndexedDB logic.

## Non-goals for the first milestone

- Rewriting the Nitro API layer in Rust or another backend.
- Replacing IndexedDB/Dexie storage.
- Implementing auto-update, code signing, notarization, or installer branding.
- Changing the existing web deployment behavior.

## Recommended architecture

Use Electron as the desktop shell:

```text
Electron main process
  ├─ starts the bundled Nitro node server on 127.0.0.1
  ├─ opens a BrowserWindow
  └─ loads the local Nitro URL

Nuxt/Nitro build output
  ├─ serves the SPA assets
  └─ keeps existing /api/* proxy endpoints
```

## Runtime behavior

### Development

- `yarn electron:dev` starts `nuxt dev`.
- Electron waits for the dev server and loads `http://127.0.0.1:3000`.
- The Nitro server is provided by Nuxt dev mode.

### Production/package preview

- `yarn electron:build:*` first runs `yarn build`.
- Electron packages the `.output` directory with the app.
- On launch, the Electron main process starts `.output/server/index.mjs` as a child Node process using Electron's embedded Node runtime.
- The renderer loads the local server URL.

## Port handling

- Prefer `127.0.0.1` only; never bind to `0.0.0.0`.
- Default port: `17891`.
- If the port is unavailable, retry within a small bounded range.
- The selected URL is only used internally by the app window.

## Security baseline

- Disable Node integration in the renderer.
- Enable context isolation.
- Do not expose privileged Electron APIs to the page until there is a concrete need.
- Block new-window navigation except normal external browser opening.
- Keep the existing Nitro API contract unchanged.

## Packaging targets

Use `electron-builder`:

- `mac-arm64`: `dmg` + `zip`
- `mac-x64`: `dmg` + `zip`
- `mac-universal`: optional later
- `win-x64`: `nsis` + `zip`

## Validation checklist

- `yarn build` succeeds.
- `yarn electron:pack` creates an unpacked local app.
- Launching the unpacked app starts the local Nitro server.
- The app window opens the dashboard.
- Existing API routes are reachable from the desktop app.
- Existing web scripts still work.

## Risks and follow-up work

- WeChat login/Cookie behavior should be tested in a real desktop session.
- Windows firewall/antivirus behavior may need tuning.
- macOS production distribution requires signing and notarization.
- Windows distribution should eventually use a code-signing certificate.
- Native file/folder pickers can be added later for better export UX.
