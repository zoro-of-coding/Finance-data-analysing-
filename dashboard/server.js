import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";
import { loadStatus, loadHistory, loadSnapshots } from "../src/state.js";
import { latestAnalysis, appendAnalysis, Analyst } from "../src/analyst.js";
import { logger } from "../src/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const analyst = new Analyst();
let generating = null; // in-flight analysis promise (single-flight)

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/status") {
    const status = loadStatus() || { state: "unknown", summary: "no runs yet", ts: null };
    return sendJson(res, status);
  }

  if (url.pathname === "/api/history") {
    return sendJson(res, loadHistory(100));
  }

  if (url.pathname === "/api/snapshots") {
    return sendJson(res, loadSnapshots());
  }

  if (url.pathname === "/api/health") {
    const history = loadHistory(100);
    return sendJson(res, {
      lastState: history[history.length - 1]?.state ?? "unknown",
      healCount: history.filter((h) => h.state === "healed").length,
      brokenCount: history.filter((h) => h.state === "broken").length,
    });
  }

  if (url.pathname === "/api/analyst") {
    const latest = latestAnalysis();
    if (url.searchParams.get("generate") === "1") {
      if (!generating) {
        const question =
          url.searchParams.get("question") ||
          "Which ticker looks strongest and which weakest today? Summarize the overall market tone with specific numbers.";
        generating = (async () => {
          try {
            const result = await analyst.analyze({ question });
            const record = { ts: new Date().toISOString(), question, ...result };
            appendAnalysis(record);
            return { ok: true, record };
          } catch (err) {
            logger.warn("Analyst generation failed", { error: err.message });
            return { ok: false, error: err.message };
          } finally {
            generating = null;
          }
        })();
      }
      return sendJson(res, {
        generating: true,
        result: await generating,
        latest: latest,
      });
    }
    return sendJson(res, { latest });
  }

  // Static assets
  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, "");
  const target = path.join(PUBLIC, file);
  if (!target.startsWith(PUBLIC)) return notFound(res);
  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    res.writeHead(200, { "Content-Type": MIME[path.extname(target)] || "application/octet-stream" });
    return res.end(fs.readFileSync(target));
  }
  notFound(res);
});

function sendJson(res, data) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}

function lanIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

server.listen(config.dashboardPort, config.dashboardHost, () => {
  const host = config.dashboardHost === "0.0.0.0" ? lanIP() : config.dashboardHost;
  console.log(`Dashboard: http://localhost:${config.dashboardPort}`);
  console.log(`LAN access: http://${host}:${config.dashboardPort}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    analyst.stop();
    process.exit(0);
  });
}
