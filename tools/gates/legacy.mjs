// The new frontend against the CURRENT (unpatched) schema, emulated by the
// test backend's legacy mode: no new columns, no library table, no v2 accept.
import { launch, PHONE, DESKTOP, DB_KEY, recorder, clean } from "./lib.mjs";
import { writeFileSync, readFileSync } from "node:fs";
const BASE = "http://localhost:4302"; const OUT = process.argv[2];
const b = await launch(); const results = {};
for (const [pname, profile] of [["phone", PHONE], ["desktop", DESKTOP]]) {
  const R = recorder(); console.log(`\n===== legacy ${pname}`);
  const mk = async () => { const c = await b.newContext({ ...profile, reducedMotion: "reduce", timezoneId: "Africa/Johannesburg", permissions: ["clipboard-read", "clipboard-write"] });
    await c.addInitScript(() => localStorage.setItem("dropstack-mock-schema", "legacy")); return c; };
  const ctx = await mk(); const p = await ctx.newPage();
  const dump = (x) => x.evaluate((k) => localStorage.getItem(k), DB_KEY);
  await p.goto(BASE + "/login"); await p.getByLabel("Email").fill("test@example.com"); await p.getByLabel("Password").fill("pw");
  await p.getByRole("button", { name: "Sign in" }).click(); await p.getByText("No quotes yet").waitFor();
  await p.goto(BASE + "/builder");
  await p.getByLabel("Customer name").fill("Test Customer"); await p.getByLabel("WhatsApp number").fill("+27000000000");
  const it = (i) => p.getByTestId("line-item").nth(i);
  await it(0).getByLabel("Description").fill("Instant lawn"); await it(0).getByLabel("Area (m²)", { exact: true }).fill("40"); await it(0).getByLabel("Rate per m²").fill("85");
  await p.getByRole("button", { name: "Save draft" }).click();
  await R.check("L1 with deposit/valid-until defaults on: clear 'needs the database update' message, work kept", async () => {
    await p.getByText(/need the November database update/).waitFor({ timeout: 3000 });
    if ((await p.getByLabel("Customer name").inputValue()) !== "Test Customer") throw new Error("lost input");
  });
  await p.screenshot({ path: `${OUT}/legacy-builder-needs-patch-${pname}.png` });
  await p.getByRole("switch", { name: /Ask for a deposit/ }).uncheck({ force: true });
  await p.getByRole("button", { name: "Clear" }).click();
  await p.getByRole("button", { name: "Save draft" }).click();
  await R.check("L2 plain quote saves on the unpatched schema", async () => { await p.waitForURL(/\/builder\/[0-9a-f-]{36}$/, { timeout: 4000 }); });
  const id = p.url().split("/").pop();
  await p.getByRole("button", { name: "Copy link" }).click();
  await R.check("L3 send works (status sent)", async () => { await p.getByText("Quote marked as sent").waitFor({ timeout: 3000 }); });
  const cc = await mk(); const cp = await cc.newPage();
  await cp.goto(BASE + "/login"); await cp.evaluate(([k, v]) => localStorage.setItem(k, v), [DB_KEY, await dump(p)]);
  await cp.goto(`${BASE}/quote/${id}`);
  await R.check("L4 customer page renders a pre-patch row", async () => { await cp.getByRole("button", { name: "Accept quote" }).waitFor({ timeout: 4000 }); if (clean(await cp.getByTestId("doc-total").textContent()) !== "R 3 400,00") throw new Error("total"); });
  await cp.getByRole("button", { name: "Accept quote" }).click();
  await cp.getByLabel("Your full name").fill("Test Customer"); await cp.getByRole("dialog").getByRole("checkbox").check();
  await cp.getByRole("button", { name: /^Accept for/ }).click();
  await R.check("L5 accept falls back to the existing accept_public_quote (name not stored until patch)", async () => {
    await cp.getByText("Quote accepted").first().waitFor({ timeout: 4000 });
    const q = JSON.parse(await dump(cp)).quotes.find((x) => x.id === id);
    if (q.status !== "accepted" || "accepted_name" in q) throw new Error(JSON.stringify(q.status));
  });
  await p.evaluate(([k, v]) => localStorage.setItem(k, v), [DB_KEY, await dump(cp)]);
  await p.goto(`${BASE}/quotes/${id}`);
  await R.check("L6 detail: honest legacy acceptance text + timeline 'Time not recorded' for sent", async () => {
    await p.getByText(/with the one-tap button/).waitFor({ timeout: 4000 });
    await p.getByText("Time not recorded").first().waitFor();
  });
  await p.getByRole("button", { name: "Convert to invoice" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Convert to invoice" }).click();
  await p.getByText("Converted to an invoice").waitFor();
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Download invoice PDF" }).click()]);
  await dl.saveAs(`${OUT}/legacy-invoice-${pname}.pdf`);
  await R.check("L7 convert + PDF on unpatched schema", async () => { const raw = clean(readFileSync(`${OUT}/legacy-invoice-${pname}.pdf`, "latin1")); for (const t of ["INVOICE", "R 3 400,00"]) if (!raw.includes(t)) throw new Error(t); });
  await p.goto(BASE + "/library");
  await R.check("L8 library shows a designed 'almost ready' state", async () => { await p.getByText("Item library is almost ready").waitFor({ timeout: 4000 }); });
  await p.screenshot({ path: `${OUT}/legacy-library-${pname}.png` });
  await p.goto(BASE + "/settings"); await p.getByRole("button", { name: "Load demo data" }).click();
  await R.check("L9 demo data explains it needs the update (no crash, no partial seed)", async () => {
    await p.getByText("Demo data needs the November database update first.").waitFor({ timeout: 4000 });
    if (JSON.parse(await dump(p)).quotes.some((q) => q.is_demo)) throw new Error("partial seed");
  });
  results[pname] = R.rows; await cc.close(); await ctx.close();
}
writeFileSync(`${OUT}/legacy-results.json`, JSON.stringify(results, null, 2));
await b.close();
