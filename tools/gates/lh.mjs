// Gate 5: Lighthouse (mobile) on the local production build, 3 runs per
// page, lowest score kept; plus a Fast-3G (devtools-throttled) LCP check on
// the public quote page. Test data seeded into the local test backend over
// CDP; every non-localhost host is unresolvable.
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire(process.env.PLAYWRIGHT_FROM ?? `${process.env.HOME}/dropstack-outreachv2/package.json`);
const { chromium } = require("playwright-core");
const { buildDemoQuotes } = await import(new URL("../../src/lib/demoData.js", import.meta.url).href);
const OUT = process.argv[2]; const BASE = "http://localhost:4310"; const PORT = 9333;
const LH = process.env.LIGHTHOUSE_CLI; // path to lighthouse/cli/index.js (e.g. from `npx lighthouse@12.8` cache)

// Persistent profile: Lighthouse drives the default context, so seeded
// localStorage must live there (a launch() context is separate storage).
const ctx = await chromium.launchPersistentContext(OUT + "/profile", { headless: true, args: [`--remote-debugging-port=${PORT}`, "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost"] });
const browser = { close: () => ctx.close() };
let page;
async function openSeeder() { page = await ctx.newPage(); await page.goto(BASE + "/login"); }
async function closeSeeder() {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.clearBrowserCache"); // cold load every run; localStorage (test data) kept
  await page.close();
}
const quotes = buildDemoQuotes(new Date()).map((q, i) => ({ ...q, id: `3f2a9c0${i}-0000-4000-8000-000000000000`, owner_id: "00000000-0000-4000-8000-00000000a11c", updated_at: q.created_at, status: q.status === "draft" ? "draft" : q.status }));
const single = quotes.find((q) => q.customer_name === "Pieter V."); // sent, deposit
const tiered = quotes.find((q) => q.customer_name === "Ayesha D.");
async function seed(latency) {
  await page.evaluate(([qs, lat]) => {
    localStorage.setItem("dropstack-mock-db-v1", JSON.stringify({ quotes: qs, quote_library_items: [], business_users: ["00000000-0000-4000-8000-00000000a11c"], files: {} }));
    localStorage.setItem("dropstack-mock-latency", String(lat));
  }, [quotes, latency]);
}
const session = () => page.evaluate(() => localStorage.setItem("dropstack-mock-session-v1", JSON.stringify({ access_token: "mock", user: { id: "00000000-0000-4000-8000-00000000a11c", email: "test@example.com" } })));
const noSession = () => page.evaluate(() => localStorage.removeItem("dropstack-mock-session-v1"));

async function lighthouse(url, name, extra = []) {
  const out = `${OUT}/${name}.json`;
  await run("node", [LH, url, `--port=${PORT}`, "--disable-storage-reset", "--only-categories=performance,accessibility,best-practices",
    "--output=json", `--output-path=${out}`, "--quiet", "--chrome-flags=--headless", ...extra], { timeout: 240000, maxBuffer: 1 << 26 });
  const r = JSON.parse(readFileSync(out, "utf8"));
  const a = r.audits;
  return {
    perf: Math.round(r.categories.performance.score * 100),
    a11y: Math.round(r.categories.accessibility.score * 100),
    bp: Math.round(r.categories["best-practices"].score * 100),
    lcp: Math.round(a["largest-contentful-paint"].numericValue),
    fcp: Math.round(a["first-contentful-paint"].numericValue),
    tbt: Math.round(a["total-blocking-time"].numericValue),
    cls: a["cumulative-layout-shift"].numericValue,
    weightKB: Math.round(a["total-byte-weight"].numericValue / 1024),
    finalText: (r.audits["final-screenshot"] ? "" : ""),
    lcpEl: a["largest-contentful-paint-element"]?.details?.items?.[0]?.items?.[0]?.node?.snippet ?? a["largest-contentful-paint-element"]?.details?.items?.[0]?.node?.snippet ?? "",
    failedA11y: Object.values(a).filter((x) => x.score === 0 && r.categories.accessibility.auditRefs.some((ref) => ref.id === x.id)).map((x) => x.id),
  };
}
await openSeeder(); await seed(120); await noSession();
await page.goto(`${BASE}/quote/${single.id}`); await page.getByText("For Pieter V.").waitFor({ timeout: 10000 });
console.log("sanity: seeded quote renders in the Lighthouse profile");
await closeSeeder();
const summary = {};
for (const [name, path, needsSession] of [["public-single", `/quote/${single.id}`, false], ["public-tiered", `/quote/${tiered.id}`, false], ["dashboard", "/", true]]) {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    await openSeeder(); await seed(120); if (needsSession) await session(); else await noSession(); await closeSeeder();
    runs.push(await lighthouse(BASE + path, `${name}-run${i + 1}`));
  }
  summary[name] = { runs, lowestPerf: Math.min(...runs.map((r) => r.perf)) };
  console.log(name, JSON.stringify(summary[name].runs.map((r) => [r.perf, r.lcp, r.weightKB])), "lowest", summary[name].lowestPerf, "| a11y", runs[0].a11y, runs[0].failedA11y.join(","), "| LCP el:", runs[0].lcpEl.slice(0, 90));
}
// Fast 3G (classic DevTools preset: 1.6 Mbps down / 750 Kbps up / 562.5 ms RTT, 4x CPU), applied for real (devtools).
// The test backend's data call isn't network, so the throttle can't see it.
// Its in-page latency stands in for the Supabase round trip:
//   1700 ms = pessimistic cold DNS+TCP+TLS+request at 562 ms RTT
//    700 ms = connection already warmed by the preconnect (1 RTT + server)
for (const lat of [1700, 700]) {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    await openSeeder(); await seed(lat); await noSession(); await closeSeeder();
    runs.push(await lighthouse(`${BASE}/quote/${single.id}`, `public-fast3g-${lat}-run${i + 1}`, ["--throttling-method=devtools",
      "--throttling.requestLatencyMs=562.5", "--throttling.downloadThroughputKbps=1600", "--throttling.uploadThroughputKbps=750", "--throttling.cpuSlowdownMultiplier=4"]));
  }
  summary[`fast3g_${lat}`] = { runs, worstLcp: Math.max(...runs.map((r) => r.lcp)) };
  console.log(`fast3g (data ${lat} ms) LCP`, runs.map((r) => r.lcp), "worst", summary[`fast3g_${lat}`].worstLcp, "weight KB", runs[0].weightKB, "| LCP el:", runs[0].lcpEl.slice(0, 80));
}
writeFileSync(`${OUT}/gate5-summary.json`, JSON.stringify(summary, null, 2));
await browser.close();
