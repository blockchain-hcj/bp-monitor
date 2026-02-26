# Funding Rate Display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show Binance and OKX funding rate plus settlement interval in both token display (`/timeline`) and recommended symbols (`/basis-candidates`).

**Architecture:** Add a backend funding aggregation service that fetches Binance+OKX funding metadata per symbol with short TTL cache, expose a batched HTTP endpoint, then have both pages consume and render the same compact format string (`Binance: x% / yh | OKX: x% / yh`).

**Tech Stack:** TypeScript, Node fetch API, uWebSockets HTTP routing, existing server-rendered frontend pages.

---

### Task 1: Funding aggregation service
- Add `src/control/fundingRatesService.ts` with unified output shape for both exchanges.
- Fetch Binance latest rate + interval and OKX rate + interval.
- Add short in-memory TTL cache to reduce repeated remote calls.

### Task 2: HTTP API exposure
- Extend `ControlPlaneState` with funding lookup method.
- Add `GET /api/funding-rates` endpoint supporting `symbol` and `symbols` query params.
- Return `{ symbols: string[], items: Record<string, FundingPairInfo> }`.

### Task 3: Wire service in runtime
- Instantiate service in `src/index.ts`.
- Expose `getFundingRates(symbols)` through control-plane state.

### Task 4: Timeline page display
- Add funding summary line in `/timeline` UI.
- Fetch funding data for selected symbol and render compact text.
- Keep graceful fallback when API fails.

### Task 5: Basis candidates page display
- Add `Funding` column in the table.
- Batch request funding info for currently displayed symbols.
- Render compact text for each row, fallback to `-` when unavailable.

### Task 6: Verify
- Run build and relevant tests to ensure no regressions.
