import { launch, PHONE, DESKTOP, DB_KEY } from "./lib.mjs";
import { writeFileSync } from "node:fs";
const { contrast, hexToRgb } = await import(new URL("../../src/lib/brand.js", import.meta.url).href);
const BASE = "http://localhost:4302"; const OUT = process.argv[2];
const b = await launch(); const report = { pills: {}, screens: {} };
for (const [k, fg, bg] of [["draft", "#48484a", "#f2f2f4"], ["sent/viewed", "#0062cc", "#e7f1ff"], ["accepted/paid", "#1a7a37", "#e6f6ea"], ["invoiced", "#a35200", "#fff4e0"], ["expired", "#c7001a", "#ffeaec"], ["demo", "#6e6e73", "#ffffff"]])
  report.pills[k] = Math.round(contrast(hexToRgb(fg), hexToRgb(bg)) * 100) / 100;
for (const [pname, profile] of [["phone", PHONE], ["desktop", DESKTOP]]) {
  const ctx = await b.newContext({ ...profile, reducedMotion: "reduce" }); const p = await ctx.newPage();
  await p.goto(BASE + "/login"); await p.getByLabel("Email").fill("t@example.com"); await p.getByLabel("Password").fill("x");
  await p.getByRole("button", { name: "Sign in" }).click(); await p.getByText("No quotes yet").waitFor();
  await p.getByRole("button", { name: "Load demo data" }).click(); await p.getByText("Ayesha D.").waitFor();
  const st = JSON.parse(await p.evaluate((k) => localStorage.getItem(k), DB_KEY));
  const tq = st.quotes.find((q) => q.customer_name === "Ayesha D.");
  const oq = st.quotes.find((q) => q.customer_name === "Johan B.");
  const screens = [["dashboard", "/"], ["builder", "/builder"], ["builder-existing", `/builder/${oq.id}`], ["detail", `/quotes/${tq.id}`], ["library", "/library"], ["settings", "/settings"]];
  const publicScreens = [["public-tiered", `/quote/${tq.id}`], ["public-optional", `/quote/${oq.id}`]];
  const audit = async (page) => page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden"; };
    const name = (e) => e.getAttribute("aria-label") || (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.textContent) || e.closest("label")?.textContent || e.getAttribute("title") || "";
    const unlabeled = [...document.querySelectorAll("input, select, textarea")].filter((e) => e.type !== "hidden" && !name(e).trim()).map((e) => e.outerHTML.slice(0, 80));
    const small = [...document.querySelectorAll("button, a[href], [role=radio], [role=tab], label:has(input[type=checkbox])")].filter(vis)
      .filter((e) => !e.closest("p") && !e.closest("[data-inline]"))
      .map((e) => { const r = e.getBoundingClientRect(); return { t: (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((x) => x.h < 44 || x.w < 44);
    return { unlabeled, small };
  });
  for (const [n, path] of screens) { await p.goto(BASE + path); await p.waitForTimeout(700); report.screens[`${n}-${pname}`] = await audit(p); }
  const c = await b.newContext({ ...profile, reducedMotion: "reduce" }); const cp = await c.newPage();
  await cp.goto(BASE + "/login"); await cp.evaluate(([k, v]) => localStorage.setItem(k, v), [DB_KEY, JSON.stringify(st)]);
  for (const [n, path] of publicScreens) { await cp.goto(BASE + path); await cp.waitForTimeout(700); report.screens[`${n}-${pname}`] = await audit(cp); }
  // focus visible: tab 6 times on the public page, each focused element must show an outline or ring
  await cp.goto(BASE + publicScreens[0][1]); await cp.waitForTimeout(500);
  const focus = [];
  for (let i = 0; i < 8; i++) { await cp.keyboard.press("Tab"); focus.push(await cp.evaluate(() => { const e = document.activeElement; if (e === document.body) return { t: "body (before first focusable)", visible: true }; const cs = getComputedStyle(e); const peer = e.matches(".peer") ? getComputedStyle(e.nextElementSibling ?? e) : null; return { t: (e.textContent || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 25), visible: cs.outlineStyle !== "none" && cs.outlineWidth !== "0px" || /rgb/.test(cs.boxShadow) || (peer && /rgb/.test(peer.boxShadow)) }; })); }
  report.screens[`focus-public-${pname}`] = focus;
  await c.close(); await ctx.close();
}
writeFileSync(`${OUT}/a11y.json`, JSON.stringify(report, null, 1));
console.log("pill contrast", JSON.stringify(report.pills));
for (const [k, v] of Object.entries(report.screens)) {
  if (k.startsWith("focus")) console.log(k, v.every((x) => x.visible) ? "all focus visible" : JSON.stringify(v.filter((x) => !x.visible)));
  else console.log(k, "unlabeled:", v.unlabeled.length, "small targets:", JSON.stringify(v.small));
}
await b.close();
