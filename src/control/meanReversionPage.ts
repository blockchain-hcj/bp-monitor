export function renderMeanReversionPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Intraday Mean Reversion Desk</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg-a: #f5f2e9;
      --bg-b: #ecf8ff;
      --ink: #182735;
      --muted: #506577;
      --panel: rgba(255, 255, 255, 0.88);
      --border: #cfdee9;
      --ok: #118350;
      --warn: #cf5e33;
      --line: #1f80ff;
      --mean: #8f59d2;
      --z: #f05f29;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: Manrope, sans-serif;
      color: var(--ink);
      background: radial-gradient(circle at 10% -5%, #fff4d9 0%, transparent 45%), linear-gradient(145deg, var(--bg-a), var(--bg-b));
      min-height: 100vh;
    }

    .shell {
      width: min(1180px, 100vw - 24px);
      margin: 18px auto 32px;
      display: grid;
      gap: 12px;
      animation: in 360ms ease-out both;
    }

    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 12px;
      backdrop-filter: blur(7px);
      box-shadow: 0 15px 30px rgba(38, 71, 98, 0.11);
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: end;
      gap: 12px;
      flex-wrap: wrap;
    }

    h1 {
      margin: 0;
      font-size: clamp(20px, 3vw, 30px);
    }

    .meta {
      margin-top: 5px;
      color: var(--muted);
      font-size: 13px;
    }

    .tag {
      font-family: "JetBrains Mono", monospace;
      border: 1px dashed var(--border);
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      color: var(--muted);
    }

    .controls {
      display: grid;
      grid-template-columns: repeat(7, minmax(110px, 1fr));
      gap: 8px;
      align-items: end;
    }

    label {
      display: grid;
      gap: 5px;
      color: var(--muted);
      font-size: 12px;
    }

    input, select, button {
      height: 36px;
      border-radius: 10px;
      border: 1px solid var(--border);
      font-family: "JetBrains Mono", monospace;
      padding: 0 9px;
      font-size: 12px;
      color: var(--ink);
      background: #fff;
    }

    button {
      border: none;
      cursor: pointer;
      font-family: Manrope, sans-serif;
      color: white;
      font-weight: 800;
      background: linear-gradient(105deg, #1767da, #15ab87);
      transition: transform 120ms ease;
    }

    button:hover { transform: translateY(-1px); }

    .decision {
      display: grid;
      grid-template-columns: 260px 1fr;
      gap: 10px;
    }

    .signal {
      border-radius: 12px;
      border: 1px solid var(--border);
      background: #fff;
      padding: 10px;
      display: grid;
      gap: 6px;
    }

    .signal h3 {
      margin: 0;
      font-size: 13px;
      color: var(--muted);
    }

    .signal .v {
      font-family: "JetBrains Mono", monospace;
      font-size: 26px;
      font-weight: 700;
    }

    .signal .v.long { color: var(--ok); }
    .signal .v.short { color: var(--warn); }

    .metrics {
      display: grid;
      grid-template-columns: repeat(6, minmax(100px, 1fr));
      gap: 8px;
    }

    .metric {
      border-radius: 12px;
      border: 1px solid var(--border);
      background: #fff;
      padding: 8px;
    }

    .metric .k {
      font-size: 11px;
      color: var(--muted);
    }

    .metric .v {
      margin-top: 4px;
      font-size: 16px;
      font-family: "JetBrains Mono", monospace;
    }

    canvas {
      width: 100%;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: linear-gradient(180deg, #f8fcff, #fffdfa);
      display: block;
    }

    #spreadChart { height: min(45vh, 380px); }
    #zChart { height: min(27vh, 220px); margin-top: 8px; }

    .hint {
      margin-top: 8px;
      font-size: 12px;
      color: var(--muted);
    }

    @keyframes in {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 980px) {
      .controls { grid-template-columns: repeat(3, minmax(110px, 1fr)); }
      .decision { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: repeat(3, minmax(100px, 1fr)); }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="card header">
      <div>
        <h1>Intraday Mean Reversion Desk</h1>
        <div class="meta">Use live spread history to gate contrarian entries only during ranging micro-regimes.</div>
      </div>
      <div class="tag">/api/mean-reversion</div>
    </div>

    <div class="card controls">
      <label>Symbol<select id="symbol"></select></label>
      <label>Direction<select id="direction"><option value="a_to_b">A to B</option><option value="b_to_a">B to A</option></select></label>
      <label>Window Min<input id="windowMin" type="number" min="30" max="1440" value="240" /></label>
      <label>Lookback<input id="lookbackBars" type="number" min="10" max="400" value="30" /></label>
      <label>Entry Z<input id="entryZ" type="number" min="0.2" max="6" step="0.1" value="1.8" /></label>
      <label>Exit Z<input id="exitZ" type="number" min="0.05" max="3" step="0.05" value="0.35" /></label>
      <button id="refresh">Recalc</button>
    </div>

    <div class="card decision">
      <div class="signal">
        <h3>Latest Decision</h3>
        <div id="latestSignal" class="v">FLAT</div>
        <div id="latestExplain" class="meta">Awaiting data...</div>
      </div>
      <div class="metrics">
        <div class="metric"><div class="k">Latest Z</div><div class="v" id="latestZ">-</div></div>
        <div class="metric"><div class="k">Regime</div><div class="v" id="regime">-</div></div>
        <div class="metric"><div class="k">Trades</div><div class="v" id="trades">-</div></div>
        <div class="metric"><div class="k">Win Rate</div><div class="v" id="winRate">-</div></div>
        <div class="metric"><div class="k">Total PnL (bps)</div><div class="v" id="totalPnl">-</div></div>
        <div class="metric"><div class="k">Range Contribution</div><div class="v" id="rangeContrib">-</div></div>
      </div>
    </div>

    <div class="card">
      <canvas id="spreadChart"></canvas>
      <canvas id="zChart"></canvas>
      <div class="hint" id="hint">Tip: only trust LONG/SHORT when Regime=RANGING and |Z| exceeded your entry threshold.</div>
    </div>
  </div>

<script>
const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function setCanvasSize(canvas, ratioH) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = Math.max(180, Math.floor(window.innerHeight * ratioH));
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h, ctx };
}

function drawSeries(canvas, series, valueKey, extras) {
  const { w, h, ctx } = setCanvasSize(canvas, canvas.id === "spreadChart" ? 0.45 : 0.27);
  ctx.clearRect(0, 0, w, h);
  if (!series.length) return;

  let min = Infinity;
  let max = -Infinity;
  for (const p of series) {
    const v = p[valueKey];
    if (typeof v === "number" && Number.isFinite(v)) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return;
  if (Math.abs(max - min) < 1e-9) { max += 1; min -= 1; }

  const padX = 28;
  const padY = 18;
  const xAt = (i) => padX + (i / Math.max(1, series.length - 1)) * (w - padX * 2);
  const yAt = (v) => padY + (max - v) / (max - min) * (h - padY * 2);

  ctx.strokeStyle = "#d9e7f1";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let g = 0; g <= 4; g += 1) {
    const y = padY + (g / 4) * (h - padY * 2);
    ctx.moveTo(padX, y);
    ctx.lineTo(w - padX, y);
  }
  ctx.stroke();

  if (extras) extras({ ctx, xAt, yAt, w, h, min, max, padX, padY, series });

  ctx.strokeStyle = canvas.id === "spreadChart" ? "#1f80ff" : "#f05f29";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < series.length; i += 1) {
    const v = series[i][valueKey];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const x = xAt(i);
    const y = yAt(v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawSpread(series, entryZ) {
  drawSeries(document.getElementById("spreadChart"), series, "value", ({ ctx, xAt, yAt, series }) => {
    ctx.strokeStyle = "#8f59d2";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < series.length; i += 1) {
      const m = series[i].rollingMean;
      if (typeof m !== "number" || !Number.isFinite(m)) continue;
      const x = xAt(i);
      const y = yAt(m);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    const last = series[series.length - 1];
    const std = last?.rollingStd;
    const mean = last?.rollingMean;
    if (typeof std === "number" && typeof mean === "number" && Number.isFinite(std) && Number.isFinite(mean)) {
      const up = mean + entryZ * std;
      const dn = mean - entryZ * std;
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#98a8b7";
      ctx.beginPath();
      ctx.moveTo(xAt(0), yAt(up));
      ctx.lineTo(xAt(series.length - 1), yAt(up));
      ctx.moveTo(xAt(0), yAt(dn));
      ctx.lineTo(xAt(series.length - 1), yAt(dn));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });
}

function drawZ(series, entryZ) {
  drawSeries(document.getElementById("zChart"), series, "zScore", ({ ctx, xAt, yAt, series }) => {
    ctx.strokeStyle = "#9daec0";
    ctx.setLineDash([6, 4]);
    for (const level of [entryZ, -entryZ, 0]) {
      ctx.beginPath();
      ctx.moveTo(xAt(0), yAt(level));
      ctx.lineTo(xAt(series.length - 1), yAt(level));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(19, 132, 90, 0.12)";
    for (let i = 0; i < series.length; i += 1) {
      if (!series[i].isRanging) continue;
      const x = xAt(i);
      const nx = xAt(Math.min(i + 1, series.length - 1));
      ctx.fillRect(x, 0, Math.max(1, nx - x), yAt(-999));
    }
  });
}

function toSignalLabel(s) {
  if (s === "long") return "LONG";
  if (s === "short") return "SHORT";
  return "FLAT";
}

async function loadSymbols() {
  const res = await fetch("/api/symbols");
  const data = await res.json();
  const select = document.getElementById("symbol");
  select.innerHTML = "";
  for (const sym of data.symbols || []) {
    const opt = document.createElement("option");
    opt.value = sym;
    opt.textContent = sym;
    select.appendChild(opt);
  }
}

async function refresh() {
  const q = new URLSearchParams();
  q.set("symbol", document.getElementById("symbol").value || "BTCUSDT");
  q.set("direction", document.getElementById("direction").value);
  q.set("windowMin", document.getElementById("windowMin").value);
  q.set("lookbackBars", document.getElementById("lookbackBars").value);
  q.set("entryZ", document.getElementById("entryZ").value);
  q.set("exitZ", document.getElementById("exitZ").value);

  const res = await fetch("/api/mean-reversion?" + q.toString());
  const data = await res.json();
  const s = data.summary || {};

  const signalText = toSignalLabel(s.latestSignal);
  const signalNode = document.getElementById("latestSignal");
  signalNode.textContent = signalText;
  signalNode.className = "v " + (s.latestSignal || "flat");

  document.getElementById("latestExplain").textContent = s.latestIsRanging
    ? "RANGING regime active; contrarian entries are enabled."
    : "Not in ranging regime; force FLAT risk posture.";

  document.getElementById("latestZ").textContent = s.latestZ == null ? "-" : fmt.format(s.latestZ);
  document.getElementById("regime").textContent = s.latestIsRanging ? "RANGING" : "TREND";
  document.getElementById("trades").textContent = s.tradeCount ?? 0;
  document.getElementById("winRate").textContent = s.winRate == null ? "-" : (fmt.format(s.winRate * 100) + "%");
  document.getElementById("totalPnl").textContent = fmt.format(s.totalPnlBps ?? 0);
  document.getElementById("rangeContrib").textContent = s.rangeContributionPct == null ? "-" : (fmt.format(s.rangeContributionPct * 100) + "%");

  const series = data.points || [];
  const entryZ = Number(document.getElementById("entryZ").value) || 1.8;
  drawSpread(series, entryZ);
  drawZ(series, entryZ);
}

window.addEventListener("resize", () => { refresh().catch(console.error); });
document.getElementById("refresh").addEventListener("click", () => { refresh().catch(console.error); });

(async () => {
  try {
    await loadSymbols();
    await refresh();
  } catch (err) {
    document.getElementById("hint").textContent = "Load failed: " + (err?.message || err);
  }
})();
</script>
</body>
</html>`;
}
