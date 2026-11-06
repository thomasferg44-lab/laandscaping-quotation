// Gate 3: second demo config. Shortest flow + rebrand completeness.
import { launch, PHONE, DESKTOP, DB_KEY, recorder, clean } from "./lib.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const BASE = "http://localhost:4303"; const OUT = process.argv[2];
const LEFTOVER = /Placeholder|placeholder-garden|27XXXXXXXXX|Powered by DropStack/;
const b = await launch(); const results = {};
for (const [pname, profile] of [["phone", PHONE], ["desktop", DESKTOP]]) {
  const R = recorder(); console.log(`\n===== config2 ${pname}`);
  const ctx = await b.newContext({ ...profile, reducedMotion: "reduce", timezoneId: "Africa/Johannesburg", permissions: ["clipboard-read", "clipboard-write"] });
  const p = await ctx.newPage();
  const dump = (x) => x.evaluate((k) => localStorage.getItem(k), DB_KEY);
  const shot = async (x, n) => { const vp = x.viewportSize(); const h = await x.evaluate(() => document.documentElement.scrollHeight); await x.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 7000) }); await x.screenshot({ path: `${OUT}/${n}-${pname}.png` }); await x.setViewportSize(vp); };
  await p.goto(BASE + "/login");
  await p.getByLabel("Email").waitFor();
  await R.check("login: business name + monogram (no logo configured)", async () => {
    const t = clean(await p.textContent("body"));
    if (!t.includes("Example Coastal Landscapes") || LEFTOVER.test(t)) throw new Error(t.slice(0, 200));
    if ((await p.getByRole("img", { name: "Example Coastal Landscapes" }).first().textContent()) !== "EC") throw new Error("monogram");
    if ((await p.title()) !== "Example Coastal Landscapes quotes") throw new Error(await p.title());
  });
  await shot(p, "c2-login");
  await p.getByLabel("Email").fill("test@example.com"); await p.getByLabel("Password").fill("pw");
  await p.getByRole("button", { name: "Sign in" }).click(); await p.getByText("No quotes yet").waitFor();
  await R.check("brand colour applied (#1F4E79) to primary button", async () => {
    const bg = await p.getByRole("link", { name: "Create a quote" }).evaluate((e) => getComputedStyle(e).backgroundColor);
    if (bg !== "rgb(31, 78, 121)") throw new Error(bg);
  });
  await p.goto(BASE + "/builder");
  await R.check("config defaults: fixed R 2 000 deposit, valid 14 days", async () => {
    if ((await p.getByLabel("Deposit amount").inputValue()) !== "2000") throw new Error("deposit");
    const v = await p.getByLabel("Valid until").inputValue();
    const days = Math.round((new Date(v) - new Date(new Date().toISOString().slice(0, 10))) / 86400000);
    if (days < 13 || days > 15) throw new Error(v);
  });
  await p.getByLabel("Customer name").fill("Test Customer"); await p.getByLabel("WhatsApp number").fill("+27000000000");
  const it = p.getByTestId("line-item").nth(0);
  await it.getByLabel("Description").fill("Instant lawn"); await it.getByLabel("Area (m²)", { exact: true }).fill("40"); await it.getByLabel("Rate per m²").fill("85");
  await shot(p, "c2-builder");
  await p.getByRole("button", { name: "Save draft" }).click(); await p.waitForURL(/\/builder\/[0-9a-f-]{36}$/);
  const id = p.url().split("/").pop();
  await R.check("WhatsApp send prefill uses the new business name", async () => {
    const t = new URL(await p.getByRole("link", { name: "WhatsApp" }).first().getAttribute("href")).searchParams.get("text");
    if (!t.includes("Here is your quote from Example Coastal Landscapes:") || LEFTOVER.test(t)) throw new Error(t);
  });
  await p.getByRole("button", { name: "Copy link" }).click(); await p.getByText("Quote marked as sent").waitFor();
  const c = await b.newContext({ ...profile, reducedMotion: "reduce", timezoneId: "Africa/Johannesburg" }); const cp = await c.newPage();
  await cp.goto(BASE + "/login"); await cp.evaluate(([k, v]) => localStorage.setItem(k, v), [DB_KEY, await dump(p)]);
  await cp.goto(`${BASE}/quote/${id}`); await cp.getByRole("button", { name: "Accept quote" }).waitFor();
  await shot(cp, "c2-public");
  await R.check("customer page: new name, deposit R 2 000,00, terms, no DropStack line (showPoweredBy false), no leftovers", async () => {
    const t = clean(await cp.textContent("body"));
    for (const s of ["Example Coastal Landscapes", "R 2 000,00", "Plant availability confirmed on acceptance.", "hello@example-coastal.invalid"]) if (!t.includes(s)) throw new Error(`missing ${s}`);
    if (LEFTOVER.test(t)) throw new Error(t.match(LEFTOVER)[0]);
  });
  await cp.getByRole("button", { name: "Accept quote" }).click();
  await cp.getByLabel("Your full name").fill("Test Customer"); await cp.getByRole("dialog").getByRole("checkbox").check();
  await R.check("consent wording names the new business", async () => { if (!clean(await cp.getByRole("dialog").textContent()).includes("I accept this quote from Example Coastal Landscapes")) throw new Error("consent"); });
  await cp.getByRole("button", { name: /^Accept for/ }).click(); await cp.getByText("Quote accepted").first().waitFor();
  await shot(cp, "c2-public-accepted");
  await R.check("payment instructions from the new config", async () => { if (!clean(await cp.textContent("body")).includes("EFT to Example Coastal Landscapes, Test Bank")) throw new Error("pay"); });
  const [dl] = await Promise.all([cp.waitForEvent("download"), cp.getByRole("button", { name: /Download your copy/ }).click()]);
  await dl.saveAs(`${OUT}/c2-quote-${pname}.pdf`);
  await R.check("PDF: new name, WhatsApp +27000000099, monogram, no leftovers", async () => {
    const raw = clean(readFileSync(`${OUT}/c2-quote-${pname}.pdf`, "latin1"));
    for (const s of ["Example Coastal Landscapes", "WhatsApp +27000000099", "EC", "R 3 400,00", "R 2 000,00"]) if (!raw.includes(s)) throw new Error(`missing ${s}`);
    if (/Placeholder|placeholder-garden/.test(raw)) throw new Error("leftover");
  });
  await cp.evaluate(() => localStorage.setItem("dropstack-mock-fail", "rpc")); await cp.goto(`${BASE}/quote/${id}`);
  await R.check("failure fallback uses the REAL configured number (wa.me/27000000099)", async () => {
    await cp.getByText("This quote didn't load").waitFor();
    const href = await cp.getByRole("link", { name: /WhatsApp/ }).getAttribute("href");
    if (!href.startsWith("https://wa.me/27000000099")) throw new Error(href);
  });
  await shot(cp, "c2-public-error");
  results[pname] = R.rows; await c.close(); await ctx.close();
}
writeFileSync(`${OUT}/gate3-results.json`, JSON.stringify(results, null, 2));
await b.close();
