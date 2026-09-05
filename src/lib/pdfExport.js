import { companyConfig } from "../../companyConfig.js";
import { makeMoneyFormatter, describeCalc } from "./lineItems.js";
import { docLabel, docRef, isInvoiceStatus } from "./quoteDoc.js";

// Client-side PDF of a quote/invoice. Mirrors the public page: header,
// customer + date, line items with thumbnails, totals, acceptance note.
// Works at every status; the title follows docLabel() so it says QUOTE
// until invoiced/paid, then INVOICE.

const PAGE_W = 210, PAGE_H = 297, MARGIN = 16;
const THUMB = 18; // mm

// Download the PDF (browser). jsPDF is loaded lazily so the public page
// doesn't pay for it until the customer taps Download.
export async function exportQuotePdf(quote) {
  const { doc, filename } = await buildQuotePdf(quote);
  doc.save(filename);
}

export async function buildQuotePdf(quote) {
  const { jsPDF } = await import("jspdf");
  const fmt = makeMoneyFormatter(companyConfig.currency);
  const money = (n) => fmt(n).replace(/[\u00A0\u202F]/g, " "); // jsPDF core fonts lack NBSP glyphs
  const label = docLabel(quote.status);
  const primary = hexToRgb(companyConfig.primaryColor);
  const accent = hexToRgb(companyConfig.accentColor);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = MARGIN;

  // --- Header -------------------------------------------------------------
  const logo = await loadImageAsJpeg(companyConfig.logoUrl, 240);
  if (logo) {
    const h = 16, w = (logo.width / logo.height) * h;
    doc.addImage(logo.dataUrl, "JPEG", MARGIN, y, Math.min(w, 50), h);
  }
  doc.setTextColor(...primary).setFont("helvetica", "bold").setFontSize(22);
  doc.text(label.toUpperCase(), PAGE_W - MARGIN, y + 8, { align: "right" });
  doc.setTextColor(90).setFont("helvetica", "normal").setFontSize(10);
  doc.text(docRef(quote), PAGE_W - MARGIN, y + 14, { align: "right" });
  y += 22;

  doc.setTextColor(...primary).setFont("helvetica", "bold").setFontSize(13);
  doc.text(companyConfig.businessName, MARGIN, y);
  doc.setTextColor(110).setFont("helvetica", "normal").setFontSize(9);
  if (companyConfig.contactEmail) doc.text(companyConfig.contactEmail, MARGIN, y + 5);
  if (companyConfig.whatsappNumber) doc.text(`WhatsApp +${companyConfig.whatsappNumber}`, MARGIN, y + 9.5);
  y += 16;

  doc.setDrawColor(...accent).setLineWidth(0.6).line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 8;

  // --- Parties / dates ----------------------------------------------------
  const dateOf = (iso) => new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
  doc.setTextColor(110).setFontSize(8.5).text(`${label.toUpperCase()} FOR`, MARGIN, y);
  doc.setTextColor(20).setFont("helvetica", "bold").setFontSize(12).text(quote.customer_name, MARGIN, y + 6);
  doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(70);
  let cy = y + 11;
  if (quote.customer_phone) { doc.text(quote.customer_phone, MARGIN, cy); cy += 4.5; }
  if (quote.customer_email) { doc.text(quote.customer_email, MARGIN, cy); cy += 4.5; }

  const rightCol = [["Date", dateOf(quote.created_at)], ["Status", capitalise(quote.status)]];
  if (quote.accepted_at) rightCol.push(["Accepted", dateOf(quote.accepted_at)]);
  if (quote.invoiced_at && isInvoiceStatus(quote.status)) rightCol.push(["Invoiced", dateOf(quote.invoiced_at)]);
  if (quote.paid_at) rightCol.push(["Paid", dateOf(quote.paid_at)]);
  let ry = y;
  for (const [k, v] of rightCol) {
    doc.setTextColor(110).setFontSize(8.5).text(k.toUpperCase(), PAGE_W - MARGIN - 58, ry);
    doc.setTextColor(20).setFontSize(9.5).text(v, PAGE_W - MARGIN, ry, { align: "right" });
    ry += 5.5;
  }
  y = Math.max(cy, ry) + 6;

  // --- Line items table ---------------------------------------------------
  const hasPhotos = quote.line_items.some((it) => it.photo_url);
  const colAmountX = PAGE_W - MARGIN;
  const colDescX = MARGIN + (hasPhotos ? THUMB + 4 : 3);
  const descW = colAmountX - 35 - colDescX;

  const drawTableHeader = () => {
    doc.setFillColor(...primary).rect(MARGIN, y, PAGE_W - 2 * MARGIN, 7, "F");
    doc.setTextColor(255).setFont("helvetica", "bold").setFontSize(9);
    doc.text("Item", MARGIN + 3, y + 4.8);
    doc.text("Amount", colAmountX - 3, y + 4.8, { align: "right" });
    y += 9;
  };
  drawTableHeader();

  // Pre-load thumbnails in parallel; failures just omit the image.
  const thumbs = await Promise.all(quote.line_items.map((it) => (it.photo_url ? loadImageAsJpeg(it.photo_url, 200) : null)));

  quote.line_items.forEach((it, i) => {
    const descLines = doc.setFont("helvetica", "bold").setFontSize(10).splitTextToSize(it.description || "Untitled item", descW);
    const calc = describeCalc(it, money);
    const textH = descLines.length * 4.6 + (calc ? 4.5 : 0);
    const rowH = Math.max(textH, thumbs[i] ? THUMB : 0) + 5;

    if (y + rowH > PAGE_H - MARGIN - 20) {
      doc.addPage();
      y = MARGIN;
      drawTableHeader();
    }

    let x = MARGIN + 2;
    if (thumbs[i]) {
      const t = thumbs[i];
      const s = Math.min(THUMB / t.width, THUMB / t.height);
      doc.addImage(t.dataUrl, "JPEG", x, y, t.width * s, t.height * s);
    }
    doc.setTextColor(20).setFont("helvetica", "bold").setFontSize(10);
    doc.text(descLines, colDescX, y + 4);
    if (calc) {
      doc.setTextColor(110).setFont("helvetica", "normal").setFontSize(8.5);
      doc.text(calc, colDescX, y + 4 + descLines.length * 4.6);
    }
    doc.setTextColor(20).setFont("helvetica", "bold").setFontSize(10);
    doc.text(money(it.total), colAmountX - 3, y + 4, { align: "right" });

    y += rowH;
    doc.setDrawColor(225).setLineWidth(0.2).line(MARGIN, y - 2.5, PAGE_W - MARGIN, y - 2.5);
  });

  // --- Totals -------------------------------------------------------------
  if (y + 30 > PAGE_H - MARGIN) { doc.addPage(); y = MARGIN; }
  y += 3;
  doc.setTextColor(90).setFont("helvetica", "normal").setFontSize(10);
  doc.text("Subtotal", colAmountX - 45, y);
  doc.text(money(quote.subtotal), colAmountX - 3, y, { align: "right" });
  y += 7;
  doc.setFillColor(245).rect(colAmountX - 75, y - 5, 75, 10, "F");
  doc.setTextColor(...primary).setFont("helvetica", "bold").setFontSize(12);
  doc.text("Total", colAmountX - 72, y + 1.5);
  doc.text(money(quote.total), colAmountX - 3, y + 1.5, { align: "right" });
  y += 14;

  // --- Notes --------------------------------------------------------------
  doc.setTextColor(70).setFont("helvetica", "normal").setFontSize(9.5);
  const note = isInvoiceStatus(quote.status)
    ? (quote.status === "paid"
        ? "Paid in full. Thank you for your business."
        : `This invoice is based on the quote you accepted${quote.accepted_at ? ` on ${dateOf(quote.accepted_at)}` : ""}. Please contact us to arrange payment.`)
    : quote.status === "accepted"
      ? `Quote accepted${quote.accepted_at ? ` on ${dateOf(quote.accepted_at)}` : ""}. ${companyConfig.businessName} will be in touch to arrange the work.`
      : "This quote can be viewed and accepted online via the link you were sent.";
  doc.text(doc.splitTextToSize(note, PAGE_W - 2 * MARGIN), MARGIN, y);

  // --- Footer on every page ----------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setTextColor(150).setFontSize(8).setFont("helvetica", "normal");
    doc.text(`${companyConfig.businessName}${companyConfig.contactEmail ? ` · ${companyConfig.contactEmail}` : ""}`, MARGIN, PAGE_H - 8);
    doc.text(`Page ${p} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 8, { align: "right" });
  }

  const safeName = (quote.customer_name || "customer").replace(/[^\w\-]+/g, "_").slice(0, 40);
  return { doc, filename: `${label}-${safeName}-${docRef(quote).split("-")[1]}.pdf` };
}

// Load any browser-decodable image (jpg/png/webp) from a URL, downscale so
// the longest side is `maxPx`, and return a JPEG data URL + dimensions.
// Returns null on any failure (CORS, HEIC, 404) so the PDF still generates.
async function loadImageAsJpeg(url, maxPx) {
  if (!url) return null;
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });
    const s = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * s);
    c.height = Math.round(img.naturalHeight * s);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; // flatten transparency (logos)
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return { dataUrl: c.toDataURL("image/jpeg", 0.82), width: c.width, height: c.height };
  } catch {
    return null;
  }
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return [47, 82, 51];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);
