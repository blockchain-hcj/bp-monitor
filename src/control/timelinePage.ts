export function renderTimelinePage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BPS Spread Timeline</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg-top: #f6fbff;
      --bg-mid: #fff8ef;
      --bg-bottom: #f0fff8;
      --card: rgba(255, 255, 255, 0.82);
      --text: #123243;
      --muted: #5f7985;
      --line-a: #0085ff;
      --line-b: #ff6a3d;
      --line-zero: #87a1af;
      --border: #d9e8ef;
      --ok: #0f9960;
      --warn: #db5d3f;
      --shadow: 0 16px 40px rgba(25, 79, 98, 0.13);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: "Space Grotesk", sans-serif;
      color: var(--text);
      background: linear-gradient(145deg, var(--bg-top) 0%, var(--bg-mid) 48%, var(--bg-bottom) 100%);
      min-height: 100vh;
    }

    .shell {
      width: min(1160px, 100vw - 24px);
      margin: 24px auto 36px;
      display: grid;
      gap: 12px;
      animation: float-in 420ms ease-out both;
    }

    .title-card {
      background: var(--card);
      backdrop-filter: blur(7px);
      border: 1px solid var(--border);
      border-radius: 18px;
      box-shadow: var(--shadow);
      padding: 18px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .title {
      margin: 0;
      font-size: clamp(20px, 4vw, 30px);
      letter-spacing: 0.3px;
    }

    .subtitle {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 14px;
    }

    .tag {
      font-family: "IBM Plex Mono", monospace;
      font-size: 12px;
      letter-spacing: 0.2px;
      color: var(--muted);
      border: 1px dashed var(--border);
      border-radius: 999px;
      padding: 6px 10px;
    }

    .controls {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 18px;
      box-shadow: var(--shadow);
      padding: 14px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: end;
    }

    label {
      display: grid;
      gap: 6px;
      font-size: 12px;
      color: var(--muted);
      min-width: 140px;
    }

    select,
    button {
      height: 36px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: #fff;
      font-family: "IBM Plex Mono", monospace;
      font-size: 13px;
      color: var(--text);
      padding: 0 10px;
    }

    button {
      cursor: pointer;
      font-family: "Space Grotesk", sans-serif;
      font-weight: 700;
      background: linear-gradient(95deg, #0e89e8, #1cc7aa);
      color: #fff;
      border: none;
      transition: transform 120ms ease, filter 120ms ease;
    }

    button:hover {
      transform: translateY(-1px);
      filter: brightness(1.03);
    }

    .chart-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 18px;
      box-shadow: var(--shadow);
      padding: 8px;
      overflow: hidden;
    }

    #chart {
      width: 100%;
      height: min(62vh, 520px);
      display: block;
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(229, 246, 255, 0.58), rgba(255, 255, 255, 0.65));
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(130px, 1fr));
      gap: 10px;
    }

    .metric {
      background: rgba(255, 255, 255, 0.84);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 10px;
      min-height: 74px;
    }

    .metric .k {
      color: var(--muted);
      font-size: 12px;
    }

    .metric .v {
      font-family: "IBM Plex Mono", monospace;
      font-size: 17px;
      margin-top: 6px;
      display: inline-block;
      font-weight: 600;
    }

    .metric .pos {
      color: var(--ok);
    }

    .metric .neg {
      color: var(--warn);
    }

    .foot {
      font-size: 12px;
      color: var(--muted);
      text-align: right;
      font-family: "IBM Plex Mono", monospace;
      padding-right: 4px;
    }

    .tooltip {
      position: fixed;
      z-index: 9999;
      pointer-events: none;
      min-width: 260px;
      max-width: min(420px, 92vw);
      border: 1px solid var(--border);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.96);
      box-shadow: 0 12px 30px rgba(13, 53, 70, 0.2);
      backdrop-filter: blur(4px);
      font-family: "IBM Plex Mono", monospace;
      font-size: 12px;
      line-height: 1.38;
      color: #173f4f;
      padding: 10px;
      max-height: min(62vh, 380px);
      overflow: auto;
      opacity: 0;
      display: none;
      visibility: hidden;
      left: -9999px;
      top: -9999px;
      transition: opacity 90ms ease-out;
    }

    .tooltip .t-head {
      color: #3f5e6a;
      margin-bottom: 6px;
    }

    .tooltip .t-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      white-space: nowrap;
    }

    @keyframes float-in {
      from {
        opacity: 0;
        transform: translateY(10px) scale(0.995);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @media (max-width: 900px) {
      .meta-grid {
        grid-template-columns: repeat(2, minmax(120px, 1fr));
      }
      #chart {
        height: min(52vh, 430px);
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="title-card">
      <div>
        <h1 class="title">BPS Spread Timeline</h1>
        <p class="subtitle">Binance & OKX bid-ask spread in basis points along a rolling time window.</p>
      </div>
      <div class="tag" id="refresh-tag">auto refresh: 5s</div>
    </section>

    <section class="controls">
      <label>
        Symbol
        <select id="symbol"></select>
      </label>
      <label>
        Window
        <select id="window">
          <option value="15">15m</option>
          <option value="60" selected>1h</option>
          <option value="240">4h</option>
          <option value="1440">24h</option>
        </select>
      </label>
      <label>
        Target Points
        <select id="limit">
          <option value="180">180</option>
          <option value="360" selected>360</option>
          <option value="720">720</option>
          <option value="1440">1440</option>
        </select>
      </label>
      <button id="refresh">Refresh Now</button>
    </section>

    <section class="chart-card">
      <canvas id="chart"></canvas>
    </section>

    <section class="meta-grid">
      <article class="metric"><div class="k">Latest A→B</div><div class="v" id="latest-a">-</div></article>
      <article class="metric"><div class="k">Latest B→A</div><div class="v" id="latest-b">-</div></article>
      <article class="metric"><div class="k">Binance Mid</div><div class="v" id="latest-mid-a">-</div></article>
      <article class="metric"><div class="k">OKX Mid</div><div class="v" id="latest-mid-b">-</div></article>
      <article class="metric"><div class="k">Max |BPS|</div><div class="v" id="max-abs">-</div></article>
      <article class="metric"><div class="k">Samples</div><div class="v" id="count">-</div></article>
    </section>

    <div class="foot" id="foot">loading...</div>
    <div class="tooltip" id="tooltip"></div>
  </main>

  <script>
    const chart = document.getElementById("chart");
    const ctx = chart.getContext("2d");
    const symbolEl = document.getElementById("symbol");
    const windowEl = document.getElementById("window");
    const limitEl = document.getElementById("limit");
    const refreshBtn = document.getElementById("refresh");
    const foot = document.getElementById("foot");
    const latestAEl = document.getElementById("latest-a");
    const latestBEl = document.getElementById("latest-b");
    const latestMidAEl = document.getElementById("latest-mid-a");
    const latestMidBEl = document.getElementById("latest-mid-b");
    const maxAbsEl = document.getElementById("max-abs");
    const countEl = document.getElementById("count");
    const tooltipEl = document.getElementById("tooltip");

    let lastPoints = [];
    let poller = null;
    let hoverIndex = -1;
    let lastChartGeometry = { width: 0, height: 0, padding: 58, minY: -1, maxY: 1 };

    function bpsText(value) {
      if (!Number.isFinite(value)) {
        return "-";
      }
      return value.toFixed(3) + " bps";
    }

    function priceText(value) {
      if (!Number.isFinite(value)) {
        return "-";
      }
      if (Math.abs(value) >= 1000) {
        return value.toFixed(2);
      }
      if (Math.abs(value) >= 1) {
        return value.toFixed(4);
      }
      return value.toFixed(6);
    }

    function toFiniteOrNaN(value) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : NaN;
    }

    function midPrice(bid, ask) {
      if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
        return NaN;
      }
      return (bid + ask) / 2;
    }

    function tsText(ms) {
      const d = new Date(ms);
      return d.toLocaleString();
    }

    function setPolarity(el, value) {
      el.classList.remove("pos", "neg");
      if (value > 0) {
        el.classList.add("pos");
      } else if (value < 0) {
        el.classList.add("neg");
      }
    }

    function resizeCanvas() {
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      const rect = chart.getBoundingClientRect();
      chart.width = Math.floor(rect.width * ratio);
      chart.height = Math.floor(rect.height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawTimeline(lastPoints);
    }

    function hideTooltip() {
      tooltipEl.style.opacity = "0";
      tooltipEl.style.visibility = "hidden";
      tooltipEl.style.display = "none";
      tooltipEl.style.left = "-9999px";
      tooltipEl.style.top = "-9999px";
    }

    function showTooltip(point, clientX, clientY) {
      const bidA = toFiniteOrNaN(point.bestBidA);
      const askA = toFiniteOrNaN(point.bestAskA);
      const bidB = toFiniteOrNaN(point.bestBidB);
      const askB = toFiniteOrNaN(point.bestAskB);
      const midA = midPrice(bidA, askA);
      const midB = midPrice(bidB, askB);
      tooltipEl.innerHTML =
        '<div class="t-head">' +
        tsText(point.tsIngest) +
        "</div>" +
        '<div class="t-row"><span>BPS A→B</span><span>' +
        bpsText(toFiniteOrNaN(point.bpsAToB)) +
        "</span></div>" +
        '<div class="t-row"><span>BPS B→A</span><span>' +
        bpsText(toFiniteOrNaN(point.bpsBToA)) +
        "</span></div>" +
        '<div class="t-row"><span>Binance Bid/Ask</span><span>' +
        priceText(bidA) +
        " / " +
        priceText(askA) +
        "</span></div>" +
        '<div class="t-row"><span>Binance Mid</span><span>' +
        priceText(midA) +
        "</span></div>" +
        '<div class="t-row"><span>OKX Bid/Ask</span><span>' +
        priceText(bidB) +
        " / " +
        priceText(askB) +
        "</span></div>" +
        '<div class="t-row"><span>OKX Mid</span><span>' +
        priceText(midB) +
        "</span></div>";

      tooltipEl.style.display = "block";
      tooltipEl.style.visibility = "hidden";
      tooltipEl.style.left = "0px";
      tooltipEl.style.top = "0px";
      const offset = 14;
      const margin = 8;
      const tooltipW = Math.max(260, tooltipEl.offsetWidth || 260);
      const tooltipH = Math.max(120, tooltipEl.offsetHeight || 120);

      const candidates = [
        { left: clientX + offset, top: clientY + offset },
        { left: clientX - tooltipW - offset, top: clientY + offset },
        { left: clientX + offset, top: clientY - tooltipH - offset },
        { left: clientX - tooltipW - offset, top: clientY - tooltipH - offset }
      ];

      let picked = null;
      for (const c of candidates) {
        const fitsX = c.left >= margin && c.left + tooltipW <= window.innerWidth - margin;
        const fitsY = c.top >= margin && c.top + tooltipH <= window.innerHeight - margin;
        if (fitsX && fitsY) {
          picked = c;
          break;
        }
      }

      const fallback = candidates[0];
      const leftRaw = picked ? picked.left : fallback.left;
      const topRaw = picked ? picked.top : fallback.top;
      const left = Math.min(window.innerWidth - tooltipW - margin, Math.max(margin, leftRaw));
      const top = Math.min(window.innerHeight - tooltipH - margin, Math.max(margin, topRaw));
      tooltipEl.style.left = left + "px";
      tooltipEl.style.top = top + "px";
      tooltipEl.style.visibility = "visible";
      tooltipEl.style.opacity = "1";
    }

    function drawGrid(width, height, padding) {
      ctx.strokeStyle = "rgba(130, 165, 180, 0.3)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i += 1) {
        const y = padding + ((height - padding * 2) / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
      }
      for (let i = 0; i <= 4; i += 1) {
        const x = padding + ((width - padding * 2) / 4) * i;
        ctx.beginPath();
        ctx.moveTo(x, padding);
        ctx.lineTo(x, height - padding);
        ctx.stroke();
      }
    }

    function collectPriceRange(points) {
      let minPrice = Number.POSITIVE_INFINITY;
      let maxPrice = Number.NEGATIVE_INFINITY;
      for (const p of points) {
        const bidA = toFiniteOrNaN(p.bestBidA);
        const askA = toFiniteOrNaN(p.bestAskA);
        const bidB = toFiniteOrNaN(p.bestBidB);
        const askB = toFiniteOrNaN(p.bestAskB);
        const midA = midPrice(bidA, askA);
        const midB = midPrice(bidB, askB);
        if (Number.isFinite(midA)) {
          minPrice = Math.min(minPrice, midA);
          maxPrice = Math.max(maxPrice, midA);
        }
        if (Number.isFinite(midB)) {
          minPrice = Math.min(minPrice, midB);
          maxPrice = Math.max(maxPrice, midB);
        }
      }
      if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice)) {
        return null;
      }
      const pad = Math.max(1e-6, (maxPrice - minPrice) * 0.08);
      return {
        min: minPrice - pad,
        max: maxPrice + pad
      };
    }

    function drawLine(points, getValue, color, minY, maxY, width, height, padding) {
      if (points.length === 0) {
        return;
      }
      const spanX = Math.max(1, points.length - 1);
      const spanY = Math.max(1e-9, maxY - minY);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < points.length; i += 1) {
        const x = padding + ((width - padding * 2) * i) / spanX;
        const yVal = getValue(points[i]);
        const y = padding + ((maxY - yVal) * (height - padding * 2)) / spanY;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    function drawPriceLine(points, getValue, color, minPrice, maxPrice, width, height, padding) {
      if (points.length === 0) {
        return;
      }
      const spanX = Math.max(1, points.length - 1);
      const spanPrice = Math.max(1e-9, maxPrice - minPrice);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < points.length; i += 1) {
        const x = padding + ((width - padding * 2) * i) / spanX;
        const value = getValue(points[i]);
        if (!Number.isFinite(value)) {
          started = false;
          continue;
        }
        const y = padding + ((maxPrice - value) * (height - padding * 2)) / spanPrice;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    function drawLabels(points, minY, maxY, priceRange, width, height, padding) {
      ctx.fillStyle = "#4f6a77";
      ctx.font = '12px "IBM Plex Mono", monospace';
      for (let i = 0; i <= 4; i += 1) {
        const ratio = i / 4;
        const y = padding + ((height - padding * 2) / 4) * i;
        const value = maxY - (maxY - minY) * ratio;
        const text = value.toFixed(2) + " bps";
        ctx.fillText(text, 8, y + 4);
        if (priceRange) {
          const pValue = priceRange.max - (priceRange.max - priceRange.min) * ratio;
          const pText = priceText(pValue);
          const pWidth = ctx.measureText(pText).width;
          ctx.fillText(pText, width - pWidth - 8, y + 4);
        }
      }
      ctx.fillStyle = "#3d5e6c";
      ctx.fillText("BPS", 8, padding - 12);
      if (priceRange) {
        const t = "PRICE";
        const tW = ctx.measureText(t).width;
        ctx.fillText(t, width - tW - 8, padding - 12);
      }
      if (points.length > 0) {
        const start = new Date(points[0].tsIngest).toLocaleTimeString();
        const mid = new Date(points[Math.floor((points.length - 1) / 2)].tsIngest).toLocaleTimeString();
        const end = new Date(points[points.length - 1].tsIngest).toLocaleTimeString();
        const baselineY = height - 10;
        ctx.fillText(start, padding, baselineY);
        const midW = ctx.measureText(mid).width;
        ctx.fillText(mid, width / 2 - midW / 2, baselineY);
        const endW = ctx.measureText(end).width;
        ctx.fillText(end, width - padding - endW, baselineY);
      }
    }

    function pointY(value, minY, maxY, height, padding) {
      const spanY = Math.max(1e-9, maxY - minY);
      return padding + ((maxY - value) * (height - padding * 2)) / spanY;
    }

    function priceY(value, minPrice, maxPrice, height, padding) {
      const span = Math.max(1e-9, maxPrice - minPrice);
      return padding + ((maxPrice - value) * (height - padding * 2)) / span;
    }

    function drawHoverCursor(points, width, height, padding, minY, maxY, priceRange) {
      if (hoverIndex < 0 || hoverIndex >= points.length) {
        return;
      }
      const spanX = Math.max(1, points.length - 1);
      const x = padding + ((width - padding * 2) * hoverIndex) / spanX;
      const point = points[hoverIndex];
      const aVal = toFiniteOrNaN(point.bpsAToB);
      const bVal = toFiniteOrNaN(point.bpsBToA);
      const yA = pointY(aVal, minY, maxY, height, padding);
      const yB = pointY(bVal, minY, maxY, height, padding);

      ctx.strokeStyle = "rgba(27, 71, 88, 0.45)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, height - padding);
      ctx.stroke();
      ctx.setLineDash([]);

      if (Number.isFinite(yA)) {
        ctx.fillStyle = "#0085ff";
        ctx.beginPath();
        ctx.arc(x, yA, 3.6, 0, Math.PI * 2);
        ctx.fill();
      }

      if (Number.isFinite(yB)) {
        ctx.fillStyle = "#ff6a3d";
        ctx.beginPath();
        ctx.arc(x, yB, 3.6, 0, Math.PI * 2);
        ctx.fill();
      }

      if (priceRange) {
        const bidA = toFiniteOrNaN(point.bestBidA);
        const askA = toFiniteOrNaN(point.bestAskA);
        const bidB = toFiniteOrNaN(point.bestBidB);
        const askB = toFiniteOrNaN(point.bestAskB);
        const midA = midPrice(bidA, askA);
        const midB = midPrice(bidB, askB);
        if (Number.isFinite(midA)) {
          const yMidA = priceY(midA, priceRange.min, priceRange.max, height, padding);
          ctx.fillStyle = "#17a764";
          ctx.beginPath();
          ctx.arc(x, yMidA, 2.8, 0, Math.PI * 2);
          ctx.fill();
        }
        if (Number.isFinite(midB)) {
          const yMidB = priceY(midB, priceRange.min, priceRange.max, height, padding);
          ctx.fillStyle = "#f59b42";
          ctx.beginPath();
          ctx.arc(x, yMidB, 2.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    function drawTimeline(points) {
      const rect = chart.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const padding = 58;
      lastChartGeometry = { width, height, padding, minY: -1, maxY: 1 };
      ctx.clearRect(0, 0, width, height);
      drawGrid(width, height, padding);

      if (points.length === 0) {
        ctx.fillStyle = "#4f6a77";
        ctx.font = '14px "IBM Plex Mono", monospace';
        ctx.fillText("No data in selected range.", padding, height / 2);
        return;
      }

      let minVal = 0;
      let maxVal = 0;
      for (const p of points) {
        minVal = Math.min(minVal, p.bpsAToB, p.bpsBToA);
        maxVal = Math.max(maxVal, p.bpsAToB, p.bpsBToA);
      }
      const pad = Math.max(0.5, (maxVal - minVal) * 0.08);
      const minY = minVal - pad;
      const maxY = maxVal + pad;
      const priceRange = collectPriceRange(points);
      lastChartGeometry = { width, height, padding, minY, maxY };

      const zeroSpan = Math.max(1e-9, maxY - minY);
      const zeroY = padding + ((maxY - 0) * (height - padding * 2)) / zeroSpan;
      ctx.strokeStyle = "#87a1af";
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(padding, zeroY);
      ctx.lineTo(width - padding, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);

      drawLine(points, (p) => p.bpsAToB, "#0085ff", minY, maxY, width, height, padding);
      drawLine(points, (p) => p.bpsBToA, "#ff6a3d", minY, maxY, width, height, padding);
      if (priceRange) {
        drawPriceLine(
          points,
          (p) => midPrice(toFiniteOrNaN(p.bestBidA), toFiniteOrNaN(p.bestAskA)),
          "rgba(23, 167, 100, 0.85)",
          priceRange.min,
          priceRange.max,
          width,
          height,
          padding
        );
        drawPriceLine(
          points,
          (p) => midPrice(toFiniteOrNaN(p.bestBidB), toFiniteOrNaN(p.bestAskB)),
          "rgba(245, 155, 66, 0.85)",
          priceRange.min,
          priceRange.max,
          width,
          height,
          padding
        );
      }
      drawHoverCursor(points, width, height, padding, minY, maxY, priceRange);
      drawLabels(points, minY, maxY, priceRange, width, height, padding);
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function findHoverIndex(clientX) {
      if (lastPoints.length === 0) {
        return -1;
      }
      const rect = chart.getBoundingClientRect();
      const localX = clientX - rect.left;
      const width = lastChartGeometry.width;
      const padding = lastChartGeometry.padding;
      if (localX < padding || localX > width - padding) {
        return -1;
      }
      const spanX = Math.max(1, lastPoints.length - 1);
      const ratio = (localX - padding) / Math.max(1e-9, width - padding * 2);
      return clamp(Math.round(ratio * spanX), 0, lastPoints.length - 1);
    }

    function onChartMove(event) {
      const nextIndex = findHoverIndex(event.clientX);
      hoverIndex = nextIndex;
      drawTimeline(lastPoints);
      if (nextIndex < 0 || nextIndex >= lastPoints.length) {
        hideTooltip();
        return;
      }
      showTooltip(lastPoints[nextIndex], event.clientX, event.clientY);
    }

    function onChartLeave() {
      hoverIndex = -1;
      hideTooltip();
      drawTimeline(lastPoints);
    }

    async function fetchSymbols() {
      const res = await fetch("/api/symbols");
      if (!res.ok) {
        throw new Error("Failed to load symbols");
      }
      const data = await res.json();
      return Array.isArray(data.symbols) ? data.symbols : [];
    }

    async function fetchTimeline() {
      const symbol = symbolEl.value;
      const windowMin = Number(windowEl.value);
      const limit = Number(limitEl.value);
      const query = new URLSearchParams({
        symbol,
        windowMin: String(windowMin),
        limit: String(limit)
      });
      const res = await fetch("/api/spreads?" + query.toString());
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "Failed to load timeline");
      }
      return res.json();
    }

    async function refresh() {
      try {
        const payload = await fetchTimeline();
        const points = Array.isArray(payload.points) ? payload.points : [];
        lastPoints = points;
        if (hoverIndex >= points.length) {
          hoverIndex = -1;
          hideTooltip();
        }
        drawTimeline(points);

        const latest = points.length > 0 ? points[points.length - 1] : null;
        const latestA = latest ? Number(latest.bpsAToB) : NaN;
        const latestB = latest ? Number(latest.bpsBToA) : NaN;
        const latestBidA = latest ? toFiniteOrNaN(latest.bestBidA) : NaN;
        const latestAskA = latest ? toFiniteOrNaN(latest.bestAskA) : NaN;
        const latestBidB = latest ? toFiniteOrNaN(latest.bestBidB) : NaN;
        const latestAskB = latest ? toFiniteOrNaN(latest.bestAskB) : NaN;
        const latestMidA = midPrice(latestBidA, latestAskA);
        const latestMidB = midPrice(latestBidB, latestAskB);
        const maxAbs = Number(payload.stats && payload.stats.maxAbs);
        latestAEl.textContent = bpsText(latestA);
        latestBEl.textContent = bpsText(latestB);
        latestMidAEl.textContent = priceText(latestMidA);
        latestMidBEl.textContent = priceText(latestMidB);
        maxAbsEl.textContent = bpsText(maxAbs);
        countEl.textContent = String(points.length);
        setPolarity(latestAEl, latestA);
        setPolarity(latestBEl, latestB);
        setPolarity(maxAbsEl, maxAbs);
        const bucketMs = Number(payload.sampling && payload.sampling.bucketMs);
        const resolutionText = Number.isFinite(bucketMs) ? (bucketMs / 1000).toFixed(1) + "s/pt" : "-";
        foot.textContent =
          "updated at " +
          tsText(Date.now()) +
          " | range: " +
          tsText(payload.fromMs) +
          " ~ " +
          tsText(payload.toMs) +
          " | resolution: " +
          resolutionText;
      } catch (err) {
        foot.textContent = err instanceof Error ? err.message : String(err);
      }
    }

    async function bootstrap() {
      const symbols = await fetchSymbols();
      for (const s of symbols) {
        const option = document.createElement("option");
        option.value = s;
        option.textContent = s;
        symbolEl.appendChild(option);
      }
      if (symbols.length === 0) {
        throw new Error("No symbols available");
      }
      symbolEl.value = symbols[0];
      await refresh();
      if (poller) {
        clearInterval(poller);
      }
      poller = setInterval(refresh, 5000);
    }

    refreshBtn.addEventListener("click", refresh);
    symbolEl.addEventListener("change", refresh);
    windowEl.addEventListener("change", refresh);
    limitEl.addEventListener("change", refresh);
    chart.addEventListener("mousemove", onChartMove);
    chart.addEventListener("mouseleave", onChartLeave);
    window.addEventListener("resize", resizeCanvas);

    if (tooltipEl.parentElement !== document.body) {
      document.body.appendChild(tooltipEl);
    }
    hideTooltip();
    resizeCanvas();
    bootstrap().catch((err) => {
      foot.textContent = err instanceof Error ? err.message : String(err);
    });
  </script>
</body>
</html>`;
}
