// Read-only live verification. No sign-in, no real quote links (a first open
// would mark a quote viewed). Uses the all-zero token, which matches nothing.
import { launch, PHONE, DESKTOP, recorder, clean } from "./lib.mjs";
import { writeFileSync } from "node:fs";
const BASE = process.argv[2].replace(/\/$/, ""); const OUT = process.argv[3]; const TAG = process.argv[4] ?? "live";
const Z = "00000000-0000-4000-8000-000000000000";
const R = recorder();
const html = await (await fetch(BASE + "/")).text();
await R.check("index.html is the new build (brand title, Supabase preconnect, early quote fetch)", async () => {
  if (!/<title>[^<]+ quotes<\/title>/.test(html)) throw new Error("title");
  if (!/rel="preconnect" href="https:\/\/[a-z0-9]+\.supabase\.co"/.test(html)) throw new Error("preconnect");
  if (!html.includes("rest/v1/rpc/get_public_quote")) throw new Error("early fetch");
});
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
let js = "";
for (const a of assets) js += await (await fetch(BASE + a)).text();
// owner chunks are lazy and nested (entry -> OwnerApp -> pages): crawl until no new chunk names appear
const seen = new Set(assets.map((x) => x.split("/").pop()));
for (let grew = true; grew;) {
  grew = false;
  for (const m of js.matchAll(/([A-Za-z][\w.]*-[\w-]{6,}\.js)/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]); grew = true;
    const r = await fetch(`${BASE}/assets/${m[1]}`);
    if (r.ok) js += await r.text();
  }
}
await R.check("bundle carries the new features (tiers, add-ons, deposit, typed-name accept, demo data, library, suggestions, health)", async () => {
  for (const s of ["Choose an option", "Optional add-ons", "Deposit due on acceptance", "Your full name", "Load demo data", "Add from library", "Quick add", "accept_public_quote_v2", "/api/health"]) if (!js.includes(s)) throw new Error(`missing "${s}"`);
});
const hres = await fetch(BASE + "/api/health", { headers: { Accept: "application/json" } });
const htext = await hres.text(); let h = null; try { h = JSON.parse(htext); } catch { /* not json */ }
await R.check("/api/health responds: ok true, database reachable, booleans only, no-store", async () => {
  if (hres.status !== 200 || !h) throw new Error(`HTTP ${hres.status} ${htext.slice(0, 60)}`);
  if (h.ok !== true || h.database !== true || h.configComplete !== true) throw new Error(JSON.stringify({ ok: h.ok, database: h.database, configComplete: h.configComplete }));
  if (!Object.values(h.config).every((v) => typeof v === "boolean")) throw new Error("non-boolean config value");
  if (/supabase\.co|eyJ|@|\+27/.test(htext)) throw new Error("value leaked");
  if (!/no-store/.test(hres.headers.get("cache-control") ?? "")) throw new Error("cache-control");
});
const b = await launch();
for (const [pname, profile] of [["phone", PHONE], ["desktop", DESKTOP]]) {
  const ctx = await b.newContext({ ...profile, reducedMotion: "reduce" }); const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const writes = []; p.on("request", (r) => { const u = r.url(); if (/supabase\.co/.test(u) && !/get_public_quote|auth\/v1\/(user|token)/.test(u) && r.method() !== "GET") writes.push(`${r.method()} ${u.replace(/https:\/\/[^/]+/, "")}`); });
  await p.goto(`${BASE}/quote/${Z}`);
  await R.check(`${pname}: customer page renders the new designed 'not available' state`, async () => { await p.getByText("Quote not available").waitFor({ timeout: 15000 }); });
  await p.screenshot({ path: `${OUT}/${TAG}-public-notfound-${pname}.png` });
  await p.goto(`${BASE}/login`);
  await R.check(`${pname}: sign-in renders in the new design`, async () => { await p.getByRole("button", { name: "Sign in" }).waitFor({ timeout: 15000 }); await p.getByLabel("Email").waitFor(); });
  await p.screenshot({ path: `${OUT}/${TAG}-login-${pname}.png` });
  await R.check(`${pname}: no JS errors and no database writes during the checks`, async () => { if (errs.length || writes.length) throw new Error([...errs, ...writes].join("; ")); });
  await ctx.close();
}
await b.close();
writeFileSync(`${OUT}/${TAG}-results.json`, JSON.stringify({ base: BASE, health: h, rows: R.rows }, null, 2));
