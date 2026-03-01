# macOS Menu Bar Alert System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a unified alert pipeline (SDK + hub + menu bar receiver) so monitor/arb-engine and future services can push standardized alerts and view them in a macOS menu bar app.

**Architecture:** Introduce a shared TypeScript `alert-sdk` package as the alert schema/source-of-truth and fire-and-forget client. Build `apps/alert-hub` as a lightweight Node HTTP + WebSocket aggregator with in-memory ring buffer and optional NATS bridge. Build `apps/alert-bar` with Electron + menubar to subscribe via WebSocket, render unread state, and trigger native notifications for high-severity events.

**Tech Stack:** TypeScript, Node.js `http`, `ws`, Electron, menubar, optional NATS.

---

### Task 1: Shared Alert SDK package

**Files:**
- Create: `sdks/alert-sdk/package.json`
- Create: `sdks/alert-sdk/tsconfig.json`
- Create: `sdks/alert-sdk/src/types.ts`
- Create: `sdks/alert-sdk/src/client.ts`
- Create: `sdks/alert-sdk/src/index.ts`

**Steps:**
1. Define alert types (severity, alert payload, ack payload).
2. Implement `AlertClient` with auto-id generation, timestamps, `fire()` async send, timeout and non-throw behavior.
3. Export public SDK APIs from package entrypoint.
4. Build SDK with `npm run build`.

### Task 2: Alert Hub service

**Files:**
- Create: `apps/alert-hub/package.json`
- Create: `apps/alert-hub/tsconfig.json`
- Create: `apps/alert-hub/Dockerfile`
- Create: `apps/alert-hub/src/config.ts`
- Create: `apps/alert-hub/src/store/alertStore.ts`
- Create: `apps/alert-hub/src/broadcast/wsServer.ts`
- Create: `apps/alert-hub/src/ingest/httpIngest.ts`
- Create: `apps/alert-hub/src/ingest/natsIngest.ts`
- Create: `apps/alert-hub/src/control/httpServer.ts`
- Create: `apps/alert-hub/src/index.ts`

**Steps:**
1. Add runtime config parsing (port, CORS, ring size, NATS optional).
2. Implement ring-buffer store (max 500, dedupe by id, ack support).
3. Implement WebSocket broadcast manager.
4. Implement HTTP routes `POST /alerts`, `GET /alerts`, `PUT /alerts/:id/ack`, `GET /healthz`.
5. Add optional NATS subscription (`alerts.>`) and transform into store inserts.
6. Verify hub can ingest and stream alerts.



### Task 4: Menu Bar app

**Files:**
- Create: `apps/alert-bar/package.json`
- Create: `apps/alert-bar/tsconfig.json`
- Create: `apps/alert-bar/src/index.ts`
- Create: `apps/alert-bar/src/tray.ts`
- Create: `apps/alert-bar/src/wsClient.ts`
- Create: `apps/alert-bar/src/notifications.ts`
- Create: `apps/alert-bar/ui/index.html`
- Create: `apps/alert-bar/ui/style.css`
- Create: `apps/alert-bar/ui/renderer.ts`
- Create: `apps/alert-bar/assets/tray-idle.png`
- Create: `apps/alert-bar/assets/tray-warn.png`
- Create: `apps/alert-bar/assets/tray-crit.png`

**Steps:**
1. Set up Electron + menubar main process and tray window (360x480).
2. Implement WebSocket auto reconnect (3s) and event bus to UI.
3. Track unread count and highest severity for tray icon.
4. Show native notifications with sound for `error/critical`.
5. Implement dark UI list with latest alerts and ack action.



### Task 6: Compose, scripts, and verification

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `README.md`

**Steps:**
1. Add `alert-hub` service in compose and expose port `18280`.
2. Document run sequence for hub + alert-bar + curl smoke test.
3. Run build checks for changed packages and a smoke test for POST/GET/WS path.
