const $ = (id) => document.getElementById(id);

function pillClass(state) {
  return ["healthy", "healed", "broken", "error", "awaiting_approval", "unknown"].includes(state)
    ? state
    : "unknown";
}

function setPill(state) {
  const pill = $("status-pill");
  pill.className = "pill " + pillClass(state);
  pill.textContent = state.replace(/_/g, " ");
}

function fmtPct(v) {
  if (v === null || v === undefined) return "-";
  return (v > 0 ? "+" : "") + Number(v).toFixed(2) + "%";
}

function fmtNum(v) {
  if (v === null || v === undefined) return "-";
  return Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function svgSparkline(values) {
  if (!values || values.length < 2) return "";
  const w = 200, h = 30, pad = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const color = values[values.length - 1] >= values[0] ? "#2ecc71" : "#e74c3c";
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="${color}" stroke-width="1.6" points="${pts.join(" ")}"/></svg>`;
}

async function loadAnalyst() {
  const data = await fetch("/api/analyst").then((r) => r.json());
  renderAnalyst(data.latest);
}

function renderAnalyst(latest) {
  const text = $("analyst-text");
  const meta = $("analyst-meta");
  if (latest && latest.text) {
    text.textContent = latest.text;
    meta.innerHTML = `
      <div class="status done">cached</div>
      <div>${new Date(latest.ts).toLocaleString()}</div>
      <div>${latest.tokens} tokens</div>`;
  } else {
    text.textContent = "Run an analysis to get a data-grounded take on the snapshot.";
    meta.innerHTML = '<div class="status">idle</div>';
  }
}

async function runAnalyst() {
  const btn = $("analyst-btn");
  const text = $("analyst-text");
  const meta = $("analyst-meta");
  const q = $("analyst-question").value.trim();
  btn.disabled = true;
  text.textContent = "Model is loading (first run ~30-60s) and analyzing…";
  meta.innerHTML = '<div class="status busy">generating…</div>';
  try {
    const data = await fetch(`/api/analyst?generate=1&question=${encodeURIComponent(q)}`).then((r) => r.json());
    if (data.result.ok) {
      renderAnalyst(data.result.record);
    } else {
      text.textContent = "Analysis failed: " + (data.result.error || "unknown error");
      meta.innerHTML = '<div class="status error">error</div>';
    }
  } catch (err) {
    text.textContent = "Analysis failed: " + err.message;
    meta.innerHTML = '<div class="status error">error</div>';
  } finally {
    btn.disabled = false;
  }
}

async function load() {
  const [status, history, health, snapshots] = await Promise.all([
    fetch("/api/status").then((r) => r.json()),
    fetch("/api/history").then((r) => r.json()),
    fetch("/api/health").then((r) => r.json()),
    fetch("/api/snapshots").then((r) => r.json()),
  ]);

  setPill(status.state || "unknown");

  $("lastState").textContent = (status.state || "unknown").replace(/_/g, " ");
  $("totalRows").textContent = status.totalRows ?? "-";
  $("healCount").textContent = health.healCount ?? 0;
  $("brokenCount").textContent = health.brokenCount ?? 0;

  // Timeline
  const bars = history.slice(-60).map((h) => `<div class="bar ${pillClass(h.state)}" title="${h.ts}: ${h.summary}"></div>`);
  $("timeline").innerHTML = bars.join("") || '<div style="color:var(--muted)">no history yet</div>';

  // Latest snapshot table
  const last = snapshots[0];
  if (last) {
    const rows = [...last.rows].sort((a, b) => (a.symbol || "").localeCompare(b.symbol || ""));
    $("prices").innerHTML = `
      <table>
        <thead><tr><th>Symbol</th><th>Name</th><th>Price</th><th>Change</th><th>Change %</th></tr></thead>
        <tbody>
          ${rows.map((r) => {
            const pct = r.regularMarketChangePercent;
            const cls = pct === null || pct === undefined ? "" : pct >= 0 ? "pos" : "neg";
            return `<tr>
              <td><b>${r.symbol || "-"}</b></td>
              <td>${r.longName || "-"}</td>
              <td>${fmtNum(r.regularMarketPrice)}</td>
              <td class="${cls}">${fmtNum(r.regularMarketChange)}</td>
              <td class="${cls}">${fmtPct(pct)}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`;
  } else {
    $("prices").innerHTML = '<div style="color:var(--muted)">no snapshot yet — run <code>npm run start</code></div>';
  }

  // Sparklines per symbol across snapshots
  const syms = [...new Set(snapshots.flatMap((s) => s.rows.map((r) => r.symbol).filter(Boolean)))];
  $("sparklines").innerHTML = syms
    .map((sym) => {
      const series = snapshots
        .slice(0, 6)
        .reverse()
        .map((s) => {
          const row = s.rows.find((r) => r.symbol === sym);
          return row && row.regularMarketPrice != null ? row.regularMarketPrice : null;
        })
        .filter((v) => v !== null);
      const latest = series[series.length - 1];
      const pct = series.length >= 2 ? ((latest - series[0]) / series[0]) * 100 : null;
      const cls = pct === null ? "" : pct >= 0 ? "pos" : "neg";
      return `<div class="spark">
        <span class="sym">${sym}</span>
        ${svgSparkline(series)}
        <span class="${cls}">${fmtPct(pct)}</span>
      </div>`;
    })
    .join("") || '<div style="color:var(--muted)">no price history yet</div>';

  // Gainers / losers from latest snapshot
  const withChange = last ? last.rows.filter((r) => r.regularMarketChangePercent != null) : [];
  const sorted = [...withChange].sort((a, b) => b.regularMarketChangePercent - a.regularMarketChangePercent);
  const renderList = (arr) =>
    arr.map((r) => {
      const pct = r.regularMarketChangePercent;
      const cls = pct >= 0 ? "pos" : "neg";
      return `<div class="row"><span><b>${r.symbol || "-"}</b> ${r.longName || ""}</span><span class="${cls}">${fmtPct(pct)}</span></div>`;
    }).join("");
  $("gainers").innerHTML = renderList(sorted.slice(0, 5)) || '<div style="color:var(--muted)">-</div>';
  $("losers").innerHTML = renderList(sorted.slice(-5).reverse()) || '<div style="color:var(--muted)">-</div>';

  // Checks
  const checks = status.checks || [];
  $("checks").innerHTML = `<div class="checks">${
    checks.map((c) => `<div class="check-row"><span class="dot ${c.pass ? "pass" : c.severity === "warning" ? "warn" : "fail"}"></span><span>${c.name}: ${c.detail}</span></div>`).join("")
  }</div>` || '<div style="color:var(--muted)">-</div>';
}

load().catch((err) => {
  $("status-pill").className = "pill error";
  $("status-pill").textContent = "dashboard error";
  console.error(err);
});

loadAnalyst().catch(() => {});

$("analyst-btn").addEventListener("click", runAnalyst);
$("analyst-question").addEventListener("keydown", (e) => {
  if (e.key === "Enter") runAnalyst();
});

setInterval(load, 15000);
