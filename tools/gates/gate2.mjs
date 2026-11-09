// Gate 2 on the reskinned build, local test backend, no network.
import { launch, chromium, PHONE, DESKTOP, DB_KEY, recorder, clean } from "./lib.mjs";
import { writeFileSync, readFileSync } from "node:fs";
const BASE = process.argv[3] ?? "http://localhost:4302";
const OUT = process.argv[2];
const ONLY = process.argv[4]; // optional profile filter
const browser = await launch();
const results = {};

async function ctxFor(profile) {
  const ctx = await browser.newContext({ ...profile, reducedMotion: "reduce", permissions: ["clipboard-read", "clipboard-write"], timezoneId: "Africa/Johannesburg", locale: "en-ZA" });
  ctx.blocked = [];
  await ctx.route("**/*", (r) => { const u = r.request().url(); if (u.startsWith(BASE) || u.startsWith("data:") || u.startsWith("blob:")) return r.continue(); ctx.blocked.push(u); return r.abort(); });
  return ctx;
}
const dump = (p) => p.evaluate((k) => localStorage.getItem(k), DB_KEY);
const put = (p, v) => p.evaluate(([k, x]) => localStorage.setItem(k, x), [DB_KEY, v]);
const db = async (p) => JSON.parse(await dump(p));
const overflow = [];
async function shot(page, name, pname) {
  const ow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (ow > 0) overflow.push(`${name}-${pname} (+${ow}px)`);
  const vp = page.viewportSize();
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 7000) });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/${name}-${pname}.png` });
  await page.setViewportSize(vp);
}
const fold = (page, name, pname) => page.screenshot({ path: `${OUT}/${name}-fold-${pname}.png` });
const body = async (p) => clean(await p.textContent("body"));
const expectText = async (p, list, where = "page") => { const t = await body(p); for (const s of list) if (!t.includes(s)) throw new Error(`${where} missing "${s}"`); };
async function login(page) {
  await page.goto(BASE + "/login");
  await page.getByLabel("Email").fill("test@example.com");
  await page.getByLabel("Password").fill("test-password");
  await page.getByRole("button", { name: "Sign in" }).click();
}
async function customer(profile, ownerPage, path) {
  const c = await ctxFor(profile); const p = await c.newPage();
  p.errors = []; p.on("pageerror", (e) => p.errors.push(e.message));
  await p.goto(BASE + "/login"); await put(p, await dump(ownerPage));
  await p.goto(BASE + path);
  return { c, p };
}
const item = (page, i) => page.getByTestId("line-item").nth(i);

for (const [pname, profile] of [["phone", PHONE], ["desktop", DESKTOP]]) {
  if (ONLY && ONLY !== pname) continue;
  console.log(`\n===== ${pname}`);
  const R = recorder();
  const ctx = await ctxFor(profile);
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));

  // ---------------- Flow A: the brief's quote flow -------------------------
  await page.goto(BASE + "/login");
  await page.getByLabel("Email").fill("test@example.com");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await R.check("A0 login: wrong password shows inline plain-language error", async () => { await page.getByText("Email or password is incorrect.").waitFor({ timeout: 3000 }); });
  await shot(page, "login-error", pname);
  await login(page);
  await page.getByText("No quotes yet").waitFor();
  await shot(page, "dashboard-empty", pname);
  R.step("A1 dashboard empty state (designed, with Load demo data)", await page.getByRole("button", { name: "Load demo data" }).isVisible());

  await page.goto(BASE + "/builder");
  await page.getByLabel("Customer name").waitFor();
  await shot(page, "builder-empty", pname);
  await page.getByRole("button", { name: "Save draft" }).click();
  await R.check("A2 save empty: inline errors under the fields, no top banner", async () => {
    await page.getByText("Enter the customer's name").waitFor({ timeout: 2000 });
    await page.getByText("Add at least one line item").waitFor({ timeout: 2000 });
  });
  await shot(page, "builder-error", pname);

  await page.getByLabel("Customer name").fill("Test Customer");
  await page.getByLabel("WhatsApp number").fill("+27000000000");
  await page.getByLabel("Email").fill("test@example.com");
  await item(page, 0).getByLabel("Description").fill("Instant lawn (Kikuyu)");
  await item(page, 0).getByLabel("Area (m²)", { exact: true }).fill("12.5");
  await item(page, 0).getByLabel("Rate per m²").fill("85");
  await page.getByRole("button", { name: "Per unit", exact: true }).click();
  await item(page, 1).getByLabel("Description").fill("Agapanthus (4 L)");
  await item(page, 1).getByLabel("Quantity", { exact: true }).fill("19");
  await item(page, 1).getByRole("button", { name: "Increase Quantity" }).click();
  await item(page, 1).getByLabel("Rate per unit").fill("75");
  await page.getByRole("button", { name: "Per load", exact: true }).click();
  await item(page, 2).getByLabel("Description").fill("Compost delivery");
  await item(page, 2).getByLabel("Loads", { exact: true }).fill("2");
  await item(page, 2).getByLabel("Rate per load").fill("1250,50");
  await R.check("A3 stepper: 19 + 1 = 20", async () => { const v = await item(page, 1).getByLabel("Quantity", { exact: true }).inputValue(); if (v !== "20") throw new Error(v); });
  await R.check("A3 line totals (12.5 m² × R85; 20 × R75; 2 × R1 250,50)", async () => {
    const t = await page.getByTestId("line-total").allTextContents();
    const want = ["R 1 062,50", "R 1 500,00", "R 2 501,00"];
    if (JSON.stringify(t.map(clean)) !== JSON.stringify(want)) throw new Error(t.map(clean).join(" | "));
  });
  await R.check("A3 sticky bar total R 5 063,50", async () => { const t = clean(await page.getByTestId("sticky-total").textContent()); if (t !== "R 5 063,50") throw new Error(t); });
  await R.check("A3 default 50% deposit shown as split", async () => { await expectText(page, ["R 2 531,75 now, R 2 531,75 on completion"]); });
  await fold(page, "builder-filled", pname);
  await shot(page, "builder-filled", pname);
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL(/\/builder\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop();
  R.step("A4 saved as draft", true, id.slice(0, 8));

  // autosave + restore
  await page.getByLabel("Customer name").fill("Test Customer Edited");
  await page.waitForTimeout(700);
  await page.reload();
  await R.check("A5 local autosave: reload restores unsaved edit, Discard reverts", async () => {
    await page.getByText("Restored your unsaved changes").waitFor({ timeout: 4000 });
    if ((await page.getByLabel("Customer name").inputValue()) !== "Test Customer Edited") throw new Error("not restored");
    await page.getByRole("button", { name: "Discard" }).click();
    await page.waitForTimeout(200);
    if ((await page.getByLabel("Customer name").inputValue()) !== "Test Customer") throw new Error("discard failed");
  });

  await R.check("A6 WhatsApp share prefill unchanged from v1 (name, business, link)", async () => {
    const href = await page.getByRole("link", { name: "WhatsApp" }).first().getAttribute("href");
    const u = new URL(href); const t = u.searchParams.get("text");
    if (u.pathname !== "/27000000000") throw new Error(u.pathname);
    for (const s of ["Hi Test Customer,", "Here is your quote from Placeholder Garden Services:", `/quote/${id}`, "You can view it and accept it online from that link."]) if (!t.includes(s)) throw new Error(`missing ${s}`);
  });
  await R.check("A6 email share is a mailto with subject", async () => {
    const href = await page.getByRole("link", { name: "Email" }).getAttribute("href");
    if (!href.startsWith("mailto:test@example.com?subject=Quote%20from%20Placeholder")) throw new Error(href);
  });
  await page.getByRole("button", { name: "Copy link" }).click();
  await R.check("A6 copy link -> status sent, sent_at stamped", async () => {
    await page.getByText("Quote marked as sent").waitFor({ timeout: 3000 });
    const q = (await db(page)).quotes.find((x) => x.id === id);
    if (q.status !== "sent" || !q.sent_at) throw new Error(q.status);
  });

  // customer
  let { c: cctx, p: cp } = await customer(profile, page, `/quote/${id}`);
  await cp.getByRole("button", { name: "Accept quote" }).waitFor();
  await shot(cp, "public-single", pname);
  await fold(cp, "public-single", pname);
  await R.check("A7 customer page: total, deposit and balance", async () => {
    if (clean(await cp.getByTestId("doc-total").textContent()) !== "R 5 063,50") throw new Error("total");
    if (clean(await cp.getByTestId("deposit").textContent()) !== "R 2 531,75") throw new Error("deposit");
    if (clean(await cp.getByTestId("balance").textContent()) !== "R 2 531,75") throw new Error("balance");
  });
  await R.check("A7 first open marks viewed (once)", async () => { await cp.waitForTimeout(500); const q = (await db(cp)).quotes.find((x) => x.id === id); if (q.status !== "viewed" || !q.viewed_at) throw new Error(q.status); });
  await cp.getByRole("button", { name: "Accept quote" }).click();
  await cp.getByRole("button", { name: /^Accept for/ }).click();
  await R.check("A8 accept sheet: name + consent required, inline", async () => {
    await cp.getByText("Type your full name to accept").waitFor({ timeout: 2000 });
    await cp.getByText("Tick the box to confirm you accept").waitFor({ timeout: 2000 });
  });
  await shot(cp, "public-accept-error", pname);
  await cp.getByLabel("Your full name").fill("Test Customer");
  await cp.getByRole("dialog").getByRole("checkbox").check();
  await shot(cp, "public-accept-sheet", pname);
  await cp.getByRole("button", { name: /^Accept for/ }).click();
  await cp.getByText("Quote accepted").first().waitFor();
  await shot(cp, "public-accepted", pname);
  await R.check("A8 acceptance stored: typed name, consent, snapshot, total", async () => {
    const q = (await db(cp)).quotes.find((x) => x.id === id);
    if (q.status !== "accepted" || q.accepted_name !== "Test Customer" || !q.accepted_consent || !q.accepted_selection || q.total !== 5063.5) throw new Error(JSON.stringify({ s: q.status, n: q.accepted_name, t: q.total }));
  });
  R.step("A8 customer page has no JS errors", cp.errors.length === 0, cp.errors.join("; "));

  // back to owner
  await put(page, await dump(cp));
  await page.goto(BASE + "/");
  await page.getByText("Test Customer").first().waitFor();
  await R.check("A9 dashboard shows accepted + badge + hero amount", async () => {
    await expectText(page, ["Accepted, to invoice", "R 5 063,50", "1 accepted, ready to invoice"]);
  });
  await shot(page, "dashboard-populated", pname);
  await page.goto(`${BASE}/quotes/${id}`);
  await page.getByText("Acceptance").first().waitFor();
  await R.check("A10 detail: typed name + timestamp + timeline", async () => {
    await expectText(page, ["Accepted by Test Customer", "Created", "Sent", "Viewed by customer", "Accepted"]);
    const states = await page.locator("ol[aria-label='Quote history'] li").evaluateAll((ls) => ls.map((l) => l.dataset.state));
    if (states.join(",") !== "done,done,done,current") throw new Error(states.join(","));
  });
  await shot(page, "detail-accepted", pname);
  await page.getByRole("button", { name: "Convert to invoice" }).click();
  await shot(page, "detail-convert-sheet", pname);
  await page.getByRole("dialog").getByRole("button", { name: "Convert to invoice" }).click();
  await R.check("A11 convert to invoice (sheet, not confirm())", async () => { await page.getByText("Converted to an invoice").waitFor({ timeout: 3000 }); const q = (await db(page)).quotes.find((x) => x.id === id); if (q.status !== "invoiced") throw new Error(q.status); });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download invoice PDF" }).click()]);
  const pdfPath = `${OUT}/invoice-${pname}.pdf`; await dl.saveAs(pdfPath);
  await R.check("A12 PDF figures match the quote exactly", async () => {
    const raw = clean(readFileSync(pdfPath, "latin1"));
    for (const t of ["INVOICE", "Test Customer", "R 1 062,50", "R 1 500,00", "R 2 501,00", "R 5 063,50", "R 2 531,75", "typed their full name", "How to pay"]) if (!raw.includes(t)) throw new Error(`PDF missing ${t}`);
  });
  await page.goto(`${BASE}/quote/${id}`);
  await page.getByText("is now an invoice").waitFor();
  await shot(page, "public-invoice", pname);

  // ---------------- Flow B: demo data + every new feature --------------------
  // a neighbour's demo row that must survive "Remove demo data"
  const state = await db(page);
  state.quotes.push({ id: "99999999-9999-4999-8999-999999999999", owner_id: "other-owner", customer_name: "Neighbour quote", status: "sent", line_items: [], total: 0, subtotal: 0, is_demo: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  await put(page, JSON.stringify(state));
  await page.goto(BASE + "/settings");
  await shot(page, "settings", pname);
  await page.getByRole("button", { name: "Load demo data" }).click();
  await page.getByText(/Loaded 7 demo quotes and 10 library items/).waitFor();
  await page.goto(BASE + "/");
  await page.getByText("Ayesha D.").waitFor();
  await shot(page, "dashboard-demo", pname);
  await fold(page, "dashboard-demo", pname);
  await R.check("B1 demo: every status present on the dashboard", async () => { await expectText(page, ["Draft", "Sent", "Viewed", "Accepted", "Expired", "Invoiced"]); });
  let d = await db(page);
  const tq = d.quotes.find((q) => q.customer_name === "Ayesha D.");
  const oq = d.quotes.find((q) => q.customer_name === "Johan B.");
  const dq = d.quotes.find((q) => q.customer_name === "Pieter V.");
  const xq = d.quotes.find((q) => q.customer_name === "Ruan S.");

  await page.goto(`${BASE}/quotes/${tq.id}`);
  await page.getByText("History").waitFor();
  await shot(page, "detail-timeline", pname);
  await R.check("B2 WhatsApp follow-up: quote number, from-total, public link", async () => {
    const href = await page.getByRole("link", { name: "Follow up on WhatsApp" }).getAttribute("href");
    const u = new URL(href); const t = clean(u.searchParams.get("text"));
    const ref = `Q-${tq.id.slice(0, 6).toUpperCase()}`;
    if (u.pathname !== "/27000000003") throw new Error(u.pathname);
    for (const s of [ref, "from R 5 200,00", `/quote/${tq.id}`, "Just following up"]) if (!t.includes(s)) throw new Error(`missing ${s} in ${t}`);
  });
  await page.goto(`${BASE}/quotes/${xq.id}`);
  await page.getByText("History").waitFor();
  await R.check("B2 expired quote: timeline ends Expired, no follow-up", async () => {
    await expectText(page, ["Expired", "Valid until"]);
    if (await page.getByRole("link", { name: "Follow up on WhatsApp" }).count()) throw new Error("follow-up shown");
  });
  await shot(page, "detail-expired", pname);

  // tiered public page
  ({ c: cctx, p: cp } = await customer(profile, page, `/quote/${tq.id}`));
  await cp.getByText("Choose an option").waitFor();
  await shot(cp, "public-tiered", pname);
  await cp.getByRole("radio", { name: /Better/ }).click();
  await R.check("B3 tier pick updates the live total (Better R 6 700,00)", async () => { if (clean(await cp.getByTestId("doc-total").textContent()) !== "R 6 700,00") throw new Error(await cp.getByTestId("doc-total").textContent()); });
  await cp.getByRole("button", { name: "Accept quote" }).click();
  await cp.getByLabel("Your full name").fill("Ayesha Demo");
  await cp.getByRole("dialog").getByRole("checkbox").check();
  await cp.getByRole("button", { name: /^Accept for R 6 700,00/ }).click();
  await cp.getByText("Quote accepted").first().waitFor();
  await R.check("B3 chosen tier stored and invoiced amount = tier total", async () => {
    const q = (await db(cp)).quotes.find((x) => x.id === tq.id);
    if (q.accepted_tier_id !== "better" || q.total !== 6700 || q.accepted_selection.tier_name !== "Better") throw new Error(JSON.stringify([q.accepted_tier_id, q.total]));
  });
  await shot(cp, "public-tiered-accepted", pname);
  await put(page, await dump(cp)); await cctx.close();

  // optional add-ons
  ({ c: cctx, p: cp } = await customer(profile, page, `/quote/${oq.id}`));
  await cp.getByText("Optional add-ons").waitFor();
  await R.check("B4 optional add-ons: toggling recalculates live", async () => {
    const t0 = clean(await cp.getByTestId("doc-total").textContent());
    await cp.getByText("Stump grinding").click();
    const t1 = clean(await cp.getByTestId("doc-total").textContent());
    await cp.getByText("Replacement tree").click();
    const t2 = clean(await cp.getByTestId("doc-total").textContent());
    await cp.getByText("Replacement tree").click();
    const t3 = clean(await cp.getByTestId("doc-total").textContent());
    if ([t0, t1, t2, t3].join("|") !== "R 2 150,00|R 3 050,00|R 4 250,00|R 3 050,00") throw new Error([t0, t1, t2, t3].join("|"));
  });
  await shot(cp, "public-optional", pname);
  await cp.getByRole("button", { name: "Accept quote" }).click();
  await cp.getByLabel("Your full name").fill("Johan Demo"); await cp.getByRole("dialog").getByRole("checkbox").check();
  await cp.getByRole("button", { name: /^Accept for R 3 050,00/ }).click();
  await cp.getByText("Quote accepted").first().waitFor();
  await R.check("B4 acceptance freezes the selection (stump grinding in, tree out)", async () => {
    const q = (await db(cp)).quotes.find((x) => x.id === oq.id);
    const names = q.accepted_selection.line_items.map((i) => i.description);
    if (q.total !== 3050 || !names.includes("Stump grinding") || names.some((n) => n.startsWith("Replacement"))) throw new Error(names.join(","));
  });
  await put(page, await dump(cp)); await cctx.close();

  // deposit
  ({ c: cctx, p: cp } = await customer(profile, page, `/quote/${dq.id}`));
  await cp.getByTestId("deposit").waitFor();
  await R.check("B5 deposit quote: due now vs balance (50% of R 8 980,00)", async () => {
    if (clean(await cp.getByTestId("deposit").textContent()) !== "R 4 490,00" || clean(await cp.getByTestId("balance").textContent()) !== "R 4 490,00") throw new Error("split");
  });
  await shot(cp, "public-deposit", pname); await cctx.close();

  // expired
  ({ c: cctx, p: cp } = await customer(profile, page, `/quote/${xq.id}`));
  await cp.getByText("This quote has expired").waitFor();
  await R.check("B6 expired: designed state, no Accept button", async () => { if (await cp.getByRole("button", { name: "Accept quote" }).count()) throw new Error("accept visible"); });
  await shot(cp, "public-expired", pname); await cctx.close();

  // item library
  await page.goto(BASE + "/library");
  await page.getByText("Instant lawn (Kikuyu)").first().waitFor();
  await shot(page, "library-populated", pname);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save item" }).click();
  await R.check("B7 library: new item validates inline", async () => { await page.getByText("Name the item, e.g. Instant lawn (Kikuyu)").waitFor({ timeout: 2000 }); await page.getByText("Enter a default rate above 0").waitFor(); });
  await shot(page, "library-sheet-error", pname);
  await page.getByRole("dialog").getByLabel("Name").fill("Gravel path (test)");
  await page.getByRole("dialog").getByRole("radio", { name: "Area (m²)" }).click();
  await page.getByRole("dialog").getByLabel(/Default rate/).fill("140");
  await page.getByRole("dialog").getByRole("button", { name: "Save item" }).click();
  await R.check("B7 library: create", async () => { await page.getByText("Item added to your library").waitFor({ timeout: 3000 }); });
  await page.getByRole("button", { name: /^Gravel path \(test\)/ }).click();
  await page.getByRole("dialog").getByLabel(/Default rate/).fill("150");
  await page.getByRole("dialog").getByRole("button", { name: "Save item" }).click();
  await R.check("B7 library: edit", async () => {
    await page.getByText("Item updated").waitFor({ timeout: 3000 });
    const g = (await db(page)).quote_library_items.filter((i) => i.name === "Gravel path (test)");
    if (g.length !== 1 || g[0].default_rate !== 150) throw new Error(JSON.stringify(g));
  });
  await page.getByRole("button", { name: "Delete Gravel path (test)" }).click();
  await shot(page, "library-delete-sheet", pname);
  await page.getByRole("dialog").getByRole("button", { name: "Delete item" }).click();
  await R.check("B7 library: delete via confirmation sheet", async () => { await page.getByText("Item deleted").waitFor({ timeout: 3000 }); if ((await db(page)).quote_library_items.some((i) => i.name.startsWith("Gravel"))) throw new Error("still there"); });

  // builder: tiers + library insert + save to library inline
  await page.goto(BASE + "/builder");
  await page.getByLabel("Customer name").fill("Test Customer Tiers");
  await page.getByLabel("WhatsApp number").fill("+27000000000");
  await page.getByRole("button", { name: "Add from library" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Instant lawn \(Kikuyu\)/ }).click();
  await R.check("B8 one-tap insert from library (name, detail, rate) fills the empty starter row", async () => {
    if ((await page.getByTestId("line-item").count()) !== 1) throw new Error("blank row kept");
    const it = item(page, 0);
    if ((await it.getByLabel("Description").inputValue()) !== "Instant lawn (Kikuyu)") throw new Error("desc");
    if ((await it.getByLabel("Rate per m²").inputValue()) !== "85") throw new Error("rate");
  });
  await item(page, 0).getByLabel("Area (m²)", { exact: true }).fill("30");
  await item(page, 0).getByRole("button", { name: "Save to library" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Instant lawn, premium (test)");
  await page.getByRole("dialog").getByRole("button", { name: "Save item" }).click();
  await R.check("B8 save a builder line to the library inline", async () => { await page.getByText("Saved to your item library").waitFor({ timeout: 3000 }); });
  await page.getByRole("button", { name: "Offer options" }).click();
  await page.getByRole("radio", { name: "Better" }).click();
  await page.getByRole("button", { name: "Day-rate labour", exact: true }).click();
  await item(page, 1).getByLabel("Description").fill("Irrigation install");
  await item(page, 1).getByLabel("Days", { exact: true }).fill("1");
  await item(page, 1).getByLabel("Day rate").fill("1800");
  await R.check("B8 tiered builder: sticky bar shows From cheapest option", async () => { if (clean(await page.getByTestId("sticky-total").textContent()) !== "R 2 550,00") throw new Error(await page.getByTestId("sticky-total").textContent()); });
  await shot(page, "builder-tiers", pname);
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL(/\/builder\/[0-9a-f-]{36}$/);
  await R.check("B8 tiered quote saved with 2 tiers", async () => { const id2 = page.url().split("/").pop(); const q = (await db(page)).quotes.find((x) => x.id === id2); if (q.tiers?.length !== 2 || q.total !== 2550) throw new Error(JSON.stringify(q.tiers?.length)); });

  // ---------------- Addenda: health line, payment block, suggestions -------
  await page.goto(BASE + "/");
  await R.check("D1 health status line in the shell (base config: WhatsApp placeholder flagged)", async () => {
    const s = page.getByTestId("health-status").filter({ visible: true }).first();
    await s.waitFor({ timeout: 4000 });
    await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=health-status]")].some((e) => e.dataset.tone !== "unknown"));
    const t = clean(await page.getByTestId("health-status").filter({ visible: true }).first().textContent());
    if (t !== "Connected · add WhatsApp number") throw new Error(t);
  });
  await shot(page, "health-line", pname);
  await page.evaluate(() => localStorage.setItem("dropstack-mock-fail", "db"));
  await page.reload();
  await R.check("D1 health line shows 'Database not reachable' when the probe fails", async () => {
    await page.getByTestId("health-status").filter({ visible: true }).first().getByText("Database not reachable").waitFor({ timeout: 4000 });
  });
  await page.evaluate(() => localStorage.removeItem("dropstack-mock-fail"));
  ({ c: cctx, p: cp } = await customer(profile, page, `/quote/${dq.id}`));
  await cp.getByTestId("payment-block").waitFor();
  await R.check("D2 payment block on the open quote page (details, reference; no link when paymentLink empty)", async () => {
    const t = clean(await cp.getByTestId("payment-block").textContent());
    for (const s of ["Payment details", "Pay once you've accepted", "EFT to Placeholder Garden Services", `Reference: Q-${dq.id.slice(0, 6).toUpperCase()}`]) if (!t.includes(s)) throw new Error(`missing ${s}`);
    if (await cp.getByRole("link", { name: "Pay online" }).count()) throw new Error("link shown without paymentLink");
  });
  await shot(cp, "public-payment", pname);
  await cp.goto(`${BASE}/quote/${id}`); // invoiced in flow A
  await R.check("D2 payment block on the invoice view", async () => {
    const t = clean(await cp.getByTestId("payment-block").textContent());
    if (!t.includes("How to pay") || !t.includes(`INV-${id.slice(0, 6).toUpperCase()}`)) throw new Error(t);
  });
  await cctx.close();
  await page.goto(`${BASE}/quotes/${id}`);
  await R.check("D2 owner's invoice detail shows the same payment block", async () => { await page.getByTestId("payment-block").getByText("How to pay").waitFor({ timeout: 3000 }); });
  await page.goto(BASE + "/builder");
  await page.getByTestId("quick-add").first().waitFor();
  await shot(page, "builder-suggestions", pname);
  await R.check("D3 quick add ranks most-used first (library + past quotes)", async () => {
    const first = clean(await page.getByTestId("quick-add").first().textContent());
    if (!first.startsWith("Instant lawn (Kikuyu)")) throw new Error(first);
  });
  await page.getByTestId("quick-add").first().click();
  await R.check("D3 one tap adds it (fills the empty row, library rate)", async () => {
    if ((await page.getByTestId("line-item").count()) !== 1) throw new Error("rows");
    if ((await item(page, 0).getByLabel("Description").inputValue()) !== "Instant lawn (Kikuyu)") throw new Error("desc");
    if ((await item(page, 0).getByLabel("Rate per m²").inputValue()) !== "85") throw new Error("rate");
  });
  await page.getByRole("button", { name: "Per unit", exact: true }).click();
  await item(page, 1).getByLabel("Description").fill("comp");
  await R.check("D3 as-you-type match fills the line (mode + rate) in one tap", async () => {
    await page.getByRole("list", { name: "Matching items" }).getByRole("button", { name: /Compost delivery/ }).click();
    if ((await item(page, 1).getByLabel("Description").inputValue()) !== "Compost delivery") throw new Error("desc");
    if ((await item(page, 1).getByLabel("Rate per load").inputValue()) !== "1250") throw new Error("rate/mode");
  });
  await shot(page, "builder-typeahead", pname);
  await R.check("D3 already-added items drop out of quick add", async () => {
    const chips = (await page.getByTestId("quick-add").allTextContents()).map(clean);
    if (chips.some((c) => c.startsWith("Instant lawn (Kikuyu)") || c.startsWith("Compost delivery"))) throw new Error(chips.join(" | "));
  });

  // realtime (same context, BroadcastChannel stands in for Supabase Realtime)
  await page.goto(BASE + "/");
  await page.getByText("Pieter V.").waitFor();
  const cust2 = await ctx.newPage();
  await cust2.goto(`${BASE}/quote/${dq.id}`);
  await cust2.getByRole("button", { name: "Accept quote" }).click();
  await cust2.getByLabel("Your full name").fill("Pieter Demo"); await cust2.getByRole("dialog").getByRole("checkbox").check();
  await cust2.getByRole("button", { name: /^Accept for/ }).click();
  await cust2.getByText("Quote accepted").first().waitFor();
  await R.check("B9 dashboard updates live without reload when the customer accepts", async () => {
    await page.locator("li", { hasText: "Pieter V." }).getByText("Accepted", { exact: true }).waitFor({ timeout: 4000 });
  });
  await cust2.close();

  // remove demo data
  await page.goto(BASE + "/settings");
  await page.getByRole("button", { name: "Remove demo data" }).click();
  await shot(page, "settings-remove-sheet", pname);
  await page.getByRole("dialog").getByRole("button", { name: "Remove demo data" }).click();
  await page.getByText(/Removed 7 demo quotes/).waitFor();
  await R.check("B10 remove demo data: exactly the seeded rows, neighbour + real rows kept", async () => {
    const s = await db(page);
    if (s.quotes.some((q) => q.is_demo && q.owner_id !== "other-owner")) throw new Error("demo left");
    if (!s.quotes.some((q) => q.id === "99999999-9999-4999-8999-999999999999")) throw new Error("neighbour deleted");
    if (!s.quotes.some((q) => q.customer_name === "Test Customer") || !s.quotes.some((q) => q.customer_name === "Test Customer Tiers")) throw new Error("real quote deleted");
    if (s.quote_library_items.some((i) => i.is_demo) || !s.quote_library_items.some((i) => i.name === "Instant lawn, premium (test)")) throw new Error("library");
  });

  // ---------------- failure states on the public page -----------------------
  const fctx = await ctxFor(profile); const fp = await fctx.newPage();
  await fp.goto(BASE + "/login"); await put(fp, await dump(page));
  await fp.evaluate(() => localStorage.setItem("dropstack-mock-latency", "4000"));
  await fp.goto(`${BASE}/quote/${id}`);
  await R.check("C1 slow (>2s): skeleton then a calm 'still loading' line", async () => { await fp.getByText("Still loading").waitFor({ timeout: 3500 }); });
  await shot(fp, "public-slow", pname);
  await fp.evaluate(() => { localStorage.setItem("dropstack-mock-latency", "50"); localStorage.setItem("dropstack-mock-fail", "rpc"); });
  await fp.goto(`${BASE}/quote/${id}`);
  await R.check("C2 failed: plain message + retry + contact fallback (no fake number)", async () => {
    await fp.getByText("This quote didn't load").waitFor({ timeout: 3000 });
    if (await fp.getByRole("link", { name: /WhatsApp/ }).count()) throw new Error("WhatsApp shown with placeholder number");
    await fp.getByRole("link", { name: "Email" }).waitFor();
  });
  await shot(fp, "public-error", pname);
  await fctx.setOffline(true);
  await fp.getByRole("button", { name: "Try again" }).click();
  await R.check("C3 offline: designed offline state", async () => { await fp.getByText("You're offline").waitFor({ timeout: 3000 }); });
  await shot(fp, "public-offline", pname);
  await fctx.setOffline(false);
  await fp.evaluate(() => localStorage.removeItem("dropstack-mock-fail"));
  await fp.goto(`${BASE}/quote/not-a-token`);
  await fp.getByText("Quote not available").waitFor();
  await shot(fp, "public-notfound", pname);
  await fctx.close();

  R.step("no horizontal scroll on any captured screen", overflow.length === 0, overflow.join(", "));
  overflow.length = 0;
  R.step("no JS errors on owner pages", errors.length === 0, errors.join("; "));
  R.step("no request left the local server", ctx.blocked.length === 0, ctx.blocked.join(", "));
  results[pname] = R.rows;
  await ctx.close();
}
writeFileSync(`${OUT}/gate2-results.json`, JSON.stringify(results, null, 2));
await browser.close();
