export function renderBasisCandidatesPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Basis Candidates</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@500;700&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg1: #eefaf3;
      --bg2: #eff6ff;
      --ink: #153042;
      --muted: #5d7687;
      --card: rgba(255, 255, 255, 0.9);
      --line: #cde0ec;
      --good: #0b8e5f;
      --warn: #d36b2b;
      --hot: #d64747;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Sora, sans-serif;
      color: var(--ink);
      background: radial-gradient(circle at 0% 0%, #fff8dd 0%, transparent 35%), linear-gradient(145deg, var(--bg1), var(--bg2));
      min-height: 100vh;
    }
    .shell { width: min(1200px, 100vw - 24px); margin: 20px auto; display: grid; gap: 12px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 12px; }
    .head { display: flex; justify-content: space-between; align-items: end; gap: 10px; flex-wrap: wrap; }
    h1 { margin: 0; font-size: clamp(20px, 3vw, 30px); }
    .sub { color: var(--muted); margin-top: 5px; font-size: 13px; }
    .tag { font-family: "IBM Plex Mono", monospace; border: 1px dashed var(--line); border-radius: 999px; padding: 6px 10px; font-size: 12px; color: var(--muted); }
    .controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: end; }
    .view-switch {
      display: grid;
      grid-template-columns: 1fr 1fr;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: #fff;
      padding: 3px;
      min-width: 300px;
      gap: 3px;
    }
    .view-btn {
      height: 42px;
      border: none;
      border-radius: 11px;
      background: transparent;
      color: var(--muted);
      font-family: Sora, sans-serif;
      font-weight: 700;
      letter-spacing: .01em;
      cursor: pointer;
    }
    .view-btn.active {
      color: #fff;
      background: linear-gradient(95deg, #1286ea, #0eaf85);
      box-shadow: 0 6px 16px rgba(16, 128, 166, 0.22);
    }
    label { display: grid; gap: 5px; font-size: 12px; color: var(--muted); }
    select, input, button { height: 34px; border: 1px solid var(--line); border-radius: 9px; background: #fff; color: var(--ink); padding: 0 10px; font-family: "IBM Plex Mono", monospace; font-size: 12px; }
    button { border: none; cursor: pointer; color: #fff; background: linear-gradient(95deg, #1286ea, #0eaf85); font-family: Sora, sans-serif; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid var(--line); padding: 8px; text-align: left; font-size: 12px; }
    th { font-size: 11px; text-transform: uppercase; color: var(--muted); letter-spacing: .04em; }
    .mono { font-family: "IBM Plex Mono", monospace; }
    .stable { color: var(--good); }
    .spike { color: var(--hot); }
    .watch { color: var(--warn); }
    @media (max-width: 860px) { .table-wrap { overflow: auto; } }
  </style>
</head>
<body>
  <main class="shell">
    <section class="card head">
      <div>
        <h1>Basis Candidates</h1>
        <div class="sub">Adaptive stable band + spike expansion watchlist (auto refresh every 5s).</div>
      </div>
      <div class="tag">/api/basis-candidates</div>
    </section>

    <section class="card controls">
      <div class="view-switch">
        <button class="view-btn active" id="viewAll" data-view="all">全部候选</button>
        <button class="view-btn" id="viewRecommended" data-view="recommended">推荐 (双边低费率)</button>
      </div>
      <label>Mode<select id="mode"><option value="all" selected>all</option><option value="stable">stable</option><option value="spike">spike</option></select></label>
      <label>Min Score<input id="minScore" type="number" min="0" max="100" value="60" /></label>
      <label>Only CORE<select id="onlyCore"><option value="false" selected>false</option><option value="true">true</option></select></label>
      <label>Profitable<select id="profitable"><option value="all" selected>all</option><option value="true">true</option><option value="false">false</option></select></label>
      <label>Sort<select id="sort"><option value="score" selected>score</option><option value="netBps">netBps</option><option value="entryToTp">entryToTp</option><option value="updatedAt">updatedAt</option></select></label>
      <label>Limit<input id="limit" type="number" min="1" max="500" value="100" /></label>
      <button id="refresh">Refresh</button>
    </section>

    <section class="card table-wrap">
      <table>
        <thead>
          <tr><th>Symbol</th><th>Pool</th><th>Direction</th><th>Net bps</th><th>Profitable</th><th>Entry->TP bps</th><th>Realized PnL</th><th>Stable Band</th><th>Arb Range</th><th>Spike</th><th>Score</th><th>Tags</th><th>Funding</th><th>Updated</th></tr>
        </thead>
        <tbody id="rows"><tr><td colspan="14">loading...</td></tr></tbody>
      </table>
    </section>
  </main>
  <script>
    const rows = document.getElementById("rows");
    const viewButtons = Array.from(document.querySelectorAll(".view-btn"));
    const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
    let currentView = "all";

    function readQuery() {
      return new URLSearchParams({
        mode: document.getElementById("mode").value,
        minScore: document.getElementById("minScore").value,
        onlyCore: document.getElementById("onlyCore").value,
        profitable: document.getElementById("profitable").value,
        sort: document.getElementById("sort").value,
        limit: document.getElementById("limit").value,
        view: currentView
      });
    }

    function cls(tags) {
      if (tags.includes("spike")) return "spike";
      if (tags.includes("stable")) return "stable";
      return "watch";
    }

    function fmtFundingRate(value) {
      return Number.isFinite(value) ? value.toFixed(4) + "%" : "-";
    }

    function fmtFundingIntervalHours(value) {
      if (!Number.isFinite(value)) {
        return "-";
      }
      const rounded = Math.round(value);
      return (Math.abs(value - rounded) < 1e-6 ? rounded : value.toFixed(2)) + "h";
    }

    function formatFunding(item) {
      const bn = item && item.binance ? item.binance : {};
      const okx = item && item.okx ? item.okx : {};
      const bnRate = typeof bn.ratePct === "number" ? bn.ratePct : NaN;
      const bnInterval = typeof bn.intervalHours === "number" ? bn.intervalHours : NaN;
      const okxRate = typeof okx.ratePct === "number" ? okx.ratePct : NaN;
      const okxInterval = typeof okx.intervalHours === "number" ? okx.intervalHours : NaN;
      return (
        "Binance: " +
        fmtFundingRate(bnRate) +
        " / " +
        fmtFundingIntervalHours(bnInterval) +
        " | OKX: " +
        fmtFundingRate(okxRate) +
        " / " +
        fmtFundingIntervalHours(okxInterval)
      );
    }

    async function fetchFundingBySymbols(symbols) {
      const normalized = [...new Set((symbols || []).map((s) => String(s || "").trim().toUpperCase()).filter(Boolean))];
      if (normalized.length === 0) {
        return {};
      }
      const q = new URLSearchParams({ symbols: normalized.join(",") });
      const res = await fetch("/api/funding-rates?" + q.toString());
      if (!res.ok) {
        throw new Error("funding query failed");
      }
      const data = await res.json();
      return data && data.items ? data.items : {};
    }

    async function refresh() {
      const qs = readQuery();
      const res = await fetch(\`/api/basis-candidates?\${qs.toString()}\`);
      const data = await res.json();
      const items = data.items || [];
      if (items.length === 0) {
        rows.innerHTML = \`<tr><td colspan="14">\${currentView === "recommended" ? "no recommended candidates" : "no candidates"}</td></tr>\`;
        return;
      }
      let fundingBySymbol = {};
      try {
        fundingBySymbol = await fetchFundingBySymbols(items.map((it) => it.symbol));
      } catch {
        fundingBySymbol = {};
      }
      rows.innerHTML = items.map((it) => {
        const updated = new Date(it.updatedAtMs).toLocaleTimeString();
        const band = \`[\${fmt.format(it.stableBand.lowerBps)}, \${fmt.format(it.stableBand.upperBps)}] / w=\${fmt.format(it.stableBand.bandWidth)}\`;
        const arb = \`entry[\${fmt.format(it.arbRange.entryLowerBps)}, \${fmt.format(it.arbRange.entryUpperBps)}] tp=\${fmt.format(it.arbRange.takeProfitBps)} sl=\${fmt.format(it.arbRange.stopLossBps)}\`;
        const realized = it.realizedPnl.inEntryZone
          ? \`tp=\${fmt.format(it.realizedPnl.expectedTakeProfitBps)} risk=\${fmt.format(it.realizedPnl.riskToStopBps)} rr=\${fmt.format(it.realizedPnl.rrRatio)}\`
          : it.realizedPnl.explain;
        const spike = \`\${it.spike.isSpike ? "yes" : "no"} d1m=\${fmt.format(it.spike.delta1mBps)}\`;
        return \`<tr>
          <td class="mono">\${it.symbol}</td>
          <td>\${it.pool}</td>
          <td>\${it.bestDirection}</td>
          <td class="mono">\${fmt.format(it.netBps)}</td>
          <td class="mono">\${it.profitableNow ? "true" : "false"}</td>
          <td class="mono">\${fmt.format(it.entryToTakeProfitBps)}</td>
          <td class="mono">\${realized}</td>
          <td class="mono">\${band}</td>
          <td class="mono">\${arb}</td>
          <td class="mono">\${spike}</td>
          <td class="mono">\${it.score}</td>
          <td class="\${cls(it.tags)}">\${it.tags.join(",")}</td>
          <td class="mono">\${formatFunding(fundingBySymbol[it.symbol])}</td>
          <td class="mono">\${updated}</td>
        </tr>\`;
      }).join("");
    }

    document.getElementById("refresh").addEventListener("click", refresh);
    viewButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        currentView = btn.dataset.view === "recommended" ? "recommended" : "all";
        viewButtons.forEach((item) => item.classList.toggle("active", item === btn));
        void refresh();
      });
    });
    setInterval(refresh, 5000);
    void refresh();
  </script>
</body>
</html>`;
}
