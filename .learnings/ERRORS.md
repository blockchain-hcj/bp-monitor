# Error Log

## [ERR-20260301-001] alert-bar-tray-icon-load

**Logged**: 2026-03-01T07:26:39Z
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
`npm run dev` for `apps/alert-bar` failed at startup because menubar could not load tray icon image.

### Error
```
menubar: Error: Failed to load image from path '/Users/haochenjing/monitors/apps/alert-bar/assets/tray-idle.png'
```

### Context
- Command attempted: `cd apps/alert-bar && npm run dev`
- Existing tray assets were 1x1 PNG placeholder files.
- Electron/menubar rejected the image during app initialization.

### Suggested Fix
Replace tray PNG assets with valid 16x16+ icons and add runtime fallback when icon decode fails.

### Metadata
- Reproducible: yes
- Related Files: apps/alert-bar/assets/tray-idle.png, apps/alert-bar/src/index.ts, apps/alert-bar/src/tray.ts

### Resolution
- **Resolved**: 2026-03-01T07:28:40Z
- **Commit/PR**: n/a
- **Notes**: Replaced invalid 1x1 placeholder PNGs with valid tray icons and added defensive `isEmpty()` icon fallback in tray rendering.

---
## [ERR-20260301-002] alert-bar-electron-headless-abort

**Logged**: 2026-03-01T07:29:12Z
**Priority**: medium
**Status**: pending
**Area**: frontend

### Summary
`electron .` aborts with `SIGABRT` in sandboxed/headless execution environment, preventing full UI runtime verification.

### Error
```
Electron ... exited with signal SIGABRT
```

### Context
- Command attempted: `cd apps/alert-bar && npm run dev`
- Build step succeeded.
- Failure occurs after launching Electron binary in tool runtime.

### Suggested Fix
Verify behavior on local macOS desktop session (non-headless); treat CI/sandbox as build-only check for Electron app.

### Metadata
- Reproducible: yes
- Related Files: apps/alert-bar/package.json

---
