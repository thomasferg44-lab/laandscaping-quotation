import { createRequire } from "node:module";
// playwright-core is borrowed from another local project (not a dependency of
// this app). Point PLAYWRIGHT_FROM at any package.json whose node_modules has it.
const require = createRequire(process.env.PLAYWRIGHT_FROM ?? `${process.env.HOME}/dropstack-outreachv2/package.json`);
export const { chromium } = require("playwright-core");

export const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
export const DESKTOP = { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 };
export const DB_KEY = "dropstack-mock-db-v1";

export async function launch() { return chromium.launch({ headless: true }); }

// Block every request that isn't the local server: proves no live DB/network.
export async function newContext(browser, profile, base) {
  const ctx = await browser.newContext({ ...profile, permissions: ["clipboard-read", "clipboard-write"], timezoneId: "Africa/Johannesburg", locale: "en-ZA" });
  const blocked = [];
  await ctx.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith(base) || u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
    blocked.push(u);
    return route.abort();
  });
  ctx.blocked = blocked;
  return ctx;
}

export async function dumpDb(page) { return page.evaluate((k) => localStorage.getItem(k), DB_KEY); }
export async function loadDb(page, raw) { await page.evaluate(([k, v]) => localStorage.setItem(k, v), [DB_KEY, raw]); }

export function recorder() {
  const rows = [];
  return {
    rows,
    step(name, ok, detail = "") { rows.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); },
    async check(name, fn) {
      try { const d = await fn(); rows.push({ name, ok: true, detail: d ?? "" }); console.log(`PASS  ${name}${d ? "  — " + d : ""}`); }
      catch (e) { rows.push({ name, ok: false, detail: String(e.message).split("\n")[0] }); console.log(`FAIL  ${name}  — ${String(e.message).split("\n")[0]}`); }
    },
  };
}
export const clean = (s) => String(s).replace(/[  ]/g, " ");
