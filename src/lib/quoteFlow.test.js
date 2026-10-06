// End-to-end through the pure layers the Builder uses: create a quote, add
// line items in each input mode, total it, serialise it as Save does, then
// build the PDF and the WhatsApp share link from the saved record.
// (Supabase and the tap on the WhatsApp link are covered by
// docs/manual-test-whatsapp.md.)
import { describe, expect, it } from "vitest";
import { computeTotal, newLineItem, serialiseLineItem, sumLineItems } from "./lineItems.js";
import { toCents } from "./money.js";
import { buildQuotePdf } from "./pdfExport.js";
import { buildShareMessage, buildWhatsAppUrl, normaliseWhatsAppNumber } from "./shareLinks.js";
import { companyConfig } from "../../companyConfig.js";

// What LineItemEditor does on every keystroke.
const edit = (item, patch) => {
  const next = { ...item, ...patch };
  next.total = computeTotal(next);
  return next;
};

function buildQuote() {
  return {
    id: "3f2a9c00-0000-4000-8000-000000000000",
    status: "draft",
    customer_name: "Test Customer",
    customer_phone: "+27000000000",
    customer_email: "test@example.com",
    created_at: "2026-10-01T10:00:00Z",
    line_items: [
      // Values arrive as strings from <input type="number">.
      edit(newLineItem("area"), { description: "Instant lawn, Kikuyu", qty: "40", rate: "85" }),
      edit(newLineItem("unit"), { description: "Pavers", qty: "3", rate: "0.10" }),
      edit(newLineItem("load"), { description: "Compost", qty: "2", rate: "1250,50" }),
      edit(newLineItem("day"), { description: "Labour", qty: "1.5", rate: "0.15" }),
      edit(newLineItem("plain"), { description: "Tree removal", rate: "1999.99" }),
    ],
  };
}

describe("quote totals", () => {
  const quote = buildQuote();
  const items = quote.line_items.map(serialiseLineItem);

  it("computes each line in cents", () => {
    expect(items.map((it) => toCents(it.total))).toEqual([340000, 30, 250100, 23, 199999]);
  });

  it("totals with no float drift", () => {
    expect(sumLineItems(items)).toBe(7901.52);
    expect(toCents(sumLineItems(items))).toBe(790152);
  });

  it("the classic 0.1 + 0.2 case totals exactly", () => {
    const lines = ["0.10", "0.20"].map((rate) => serialiseLineItem(edit(newLineItem("plain"), { description: "x", rate })));
    expect(sumLineItems(lines)).toBe(0.3);
  });

  it("many small lines don't accumulate error", () => {
    const lines = Array.from({ length: 1000 }, () => ({ total: 0.1 }));
    expect(sumLineItems(lines)).toBe(100);
  });

  it("serialises to plain numbers, rate rounded to the cent", () => {
    const it0 = serialiseLineItem(edit(newLineItem("unit"), { description: " Bags ", qty: "2,5", rate: "19.999" }));
    expect(it0).toMatchObject({ description: "Bags", qty: 2.5, rate: 20, total: 50 });
  });

  it("totals survive a save/load round trip unchanged", () => {
    const reloaded = JSON.parse(JSON.stringify(items)); // jsonb in Supabase
    expect(reloaded.map(serialiseLineItem)).toEqual(items);
    expect(sumLineItems(reloaded)).toBe(sumLineItems(items));
  });
});

describe("PDF", () => {
  it("generates and shows the same totals as the screen", async () => {
    const q = buildQuote();
    const items = q.line_items.map(serialiseLineItem);
    const total = sumLineItems(items);
    const { doc, filename } = await buildQuotePdf({ ...q, line_items: items, subtotal: total, total });

    expect(filename).toBe("Quote-Test_Customer-3F2A9C.pdf");
    expect(doc.getNumberOfPages()).toBe(1);
    const raw = doc.output();
    expect(raw.startsWith("%PDF-")).toBe(true);
    // jsPDF doesn't compress by default, so drawn text is visible in the raw output.
    for (const text of ["QUOTE", "Test Customer", "R 7 901,52", "R 3 400,00", "R 0,30", "R 0,23", "R 85,00"]) {
      expect(raw).toContain(text);
    }
  });

  it("is titled INVOICE once invoiced", async () => {
    const q = buildQuote();
    const items = q.line_items.map(serialiseLineItem);
    const { doc, filename } = await buildQuotePdf({ ...q, status: "invoiced", line_items: items, subtotal: 1, total: 1 });
    expect(filename.startsWith("Invoice-")).toBe(true);
    expect(doc.output()).toContain("INVOICE");
  });
});

describe("WhatsApp share link", () => {
  it.each([
    ["082 000 0000", "27820000000"],
    ["+27 82 000 0000", "27820000000"],
    ["0027820000000", "27820000000"],
    ["820000000", "27820000000"],
    ["123", null],
    ["", null],
  ])("normalises %j -> %j", (raw, out) => {
    expect(normaliseWhatsAppNumber(raw)).toBe(out);
  });

  it("builds a wa.me link with the customer, business and quote URL", () => {
    const quoteUrl = "https://quotes.invalid/quote/3f2a9c00";
    const url = buildWhatsAppUrl({
      phone: "+27000000000",
      message: buildShareMessage({ customerName: "Test Customer", quoteUrl }),
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://wa.me/27000000000");
    const text = parsed.searchParams.get("text");
    expect(text).toContain("Hi Test Customer,");
    expect(text).toContain(companyConfig.businessName);
    expect(text).toContain(quoteUrl);
  });

  it("returns null without a usable number, so the button can hide", () => {
    expect(buildWhatsAppUrl({ phone: "", message: "x" })).toBeNull();
  });
});
