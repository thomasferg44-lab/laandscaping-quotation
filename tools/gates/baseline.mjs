// Gate 0: the quote flow on the CURRENT (main) UI, against the local test backend.
import { launch, newContext, PHONE, DESKTOP, dumpDb, loadDb, recorder, clean } from "./lib.mjs";
import { writeFileSync, readFileSync } from "node:fs";
const BASE = "http://localhost:4301";
const OUT = process.argv[2];
const browser = await launch();
const results = {};

for (const [pname, profile] of [["phone", PHONE], ["desktop", DESKTOP]]) {
  console.log(`\n=== baseline ${pname}`);
  const r = recorder();
  const ctx = await newContext(browser, profile, BASE);
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  const shot = (n) => page.screenshot({ path: `${OUT}/${n}-${pname}.png`, fullPage: true });

  await page.goto(BASE + "/login");
  await shot("login");
  await page.fill('input[type=email]', "test@example.com");
  await page.fill('input[type=password]', "test-password");
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('text=No quotes yet');
  await shot("dashboard-empty");

  await page.click('a:has-text("New quote")');
  await page.waitForSelector('text=Line items');
  await shot("builder-empty");
  await page.click('button:has-text("Save draft")');
  await page.waitForTimeout(200);
  await shot("builder-error");
  await r.check("save without a customer name is refused", async () => { await page.waitForSelector("text=Customer name is required", { timeout: 2000 }); });

  await page.fill('label:has-text("Customer name") input', "Test Customer");
  await page.fill('input[type=tel]', "+27000000000");
  await page.fill('label:has-text("Email") input', "test@example.com");
  const editors = () => page.locator("div.rounded-xl.bg-white.border.border-gray-200.p-4");
  // item 1: area (default)
  await editors().nth(0).locator('input[type=text]').fill("Instant lawn (Kikuyu)");
  await editors().nth(0).locator('input[type=number]').nth(0).fill("12.5");
  await editors().nth(0).locator('input[type=number]').nth(1).fill("85");
  await page.click('button:has-text("+ Per unit")');
  await editors().nth(1).locator('input[type=text]').fill("Agapanthus (4 L)");
  await editors().nth(1).locator('input[type=number]').nth(0).fill("20");
  await editors().nth(1).locator('input[type=number]').nth(1).fill("75");
  await page.click('button:has-text("+ Per load")');
  await editors().nth(2).locator('input[type=text]').fill("Compost delivery");
  await editors().nth(2).locator('input[type=number]').nth(0).fill("2");
  await editors().nth(2).locator('input[type=number]').nth(1).fill("1250.50");
  await r.check("line totals on screen (12.5 m² × R85, 20 × R75, 2 × R1 250,50)", async () => {
    const body = clean(await page.textContent("body"));
    for (const t of ["R 1 062,50", "R 1 500,00", "R 2 501,00"]) if (!body.includes(t)) throw new Error(`missing ${t}`);
  });
  await r.check("sticky footer total R 5 063,50", async () => {
    const t = clean(await page.locator("div.fixed.bottom-0").textContent());
    if (!t.includes("R 5 063,50")) throw new Error(t);
  });
  await shot("builder-filled");
  await page.click('button:has-text("Save draft")');
  await page.waitForURL(/\/builder\/[0-9a-f-]{36}/);
  const id = page.url().split("/").pop();
  r.step("saved as draft", true, id.slice(0, 8));
  await page.click('button:has-text("Copy link")');
  await page.waitForTimeout(500);
  await r.check("copy link -> status sent", async () => { await page.waitForSelector("text=Sent · sharing again", { timeout: 3000 }); });
  await r.check("WhatsApp link prefill", async () => {
    const href = await page.locator('a:has-text("WhatsApp")').getAttribute("href");
    const u = new URL(href); const text = u.searchParams.get("text");
    if (u.pathname !== "/27000000000" || !text.includes("Test Customer") || !text.includes(`/quote/${id}`)) throw new Error(href);
  });

  // customer: separate context = no owner session, shared "server" via db sync
  const cctx = await newContext(browser, profile, BASE);
  const cpage = await cctx.newPage();
  await cpage.goto(BASE + "/");
  await loadDb(cpage, await dumpDb(page));
  await cpage.goto(`${BASE}/quote/${id}`);
  await cpage.waitForSelector('text=Accept this quote');
  await cpage.waitForTimeout(400);
  await cpage.screenshot({ path: `${OUT}/public-single-${pname}.png`, fullPage: true });
  await r.check("customer page shows total R 5 063,50", async () => { if (!clean(await cpage.textContent("body")).includes("R 5 063,50")) throw new Error("total missing"); });
  await r.check("first open marks viewed", async () => { const db = JSON.parse(await dumpDb(cpage)); if (db.quotes[0].status !== "viewed") throw new Error(db.quotes[0].status); });
  await cpage.click('button:has-text("Accept this quote")');
  await cpage.waitForSelector("text=Quote accepted");
  await cpage.screenshot({ path: `${OUT}/public-accepted-${pname}.png`, fullPage: true });
  r.step("customer accepts", true);

  // back to owner
  await loadDb(page, await dumpDb(cpage));
  await page.goto(BASE + "/");
  await page.waitForSelector("text=Test Customer");
  await shot("dashboard-populated");
  await r.check("dashboard shows accepted", async () => { const t = await page.textContent("ul"); if (!/accepted/i.test(t)) throw new Error(t); });
  await page.click("text=Test Customer");
  await page.waitForSelector('button:has-text("Convert to Invoice")');
  await shot("builder-accepted");
  await page.click('button:has-text("Convert to Invoice")');
  await r.check("convert to invoice", async () => { await page.waitForSelector("text=This is now an invoice", { timeout: 3000 }); });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('button:has-text("Download Invoice PDF")')]);
  const pdfPath = `${OUT}/invoice-${pname}.pdf`;
  await dl.saveAs(pdfPath);
  await r.check("PDF figures match the quote", async () => {
    const raw = clean(readFileSync(pdfPath, "latin1"));
    for (const t of ["INVOICE", "Test Customer", "R 1 062,50", "R 1 500,00", "R 2 501,00", "R 5 063,50"]) if (!raw.includes(t)) throw new Error(`PDF missing ${t}`);
  });
  r.step("no request left the local server", ctx.blocked.length + cctx.blocked.length === 0, [...ctx.blocked, ...cctx.blocked].join(", "));
  results[pname] = r.rows;
  await cctx.close(); await ctx.close();
}
writeFileSync(`${OUT}/baseline-results.json`, JSON.stringify(results, null, 2));
await browser.close();
