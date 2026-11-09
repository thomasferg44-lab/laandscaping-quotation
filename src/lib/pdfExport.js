import { companyConfig } from "../../companyConfig.js";
import { makeMoneyFormatter, describeCalc } from "./lineItems.js";
import { makeCentsFormatter } from "./money.js";
import { docLabel, docRef, isInvoiceStatus } from "./quoteDoc.js";
import {
  acceptedDocument, baseCents, depositSplit, isAcceptedStatus, isExpired, isOptional, isTiered, quoteDeposit, quoteTiers,
} from "./quoteMath.js";
import { hexToRgb, initials } from "./brand.js";
import { normaliseWhatsAppNumber } from "./shareLinks.js";
import { paymentBlock } from "./payment.js";

// Client-side PDF of a quote/invoice. Mirrors the public page: header,
// customer + dates, options/items with thumbnails, totals with the deposit
// split, the typed-name acceptance and payment instructions. Works at every
// status; the title says QUOTE until invoiced/paid, then INVOICE.

const PAGE_W = 210, PAGE_H = 297, M = 18;
const THUMB = 16; // mm
const INK = [29, 29, 31], INK2 = [72, 72, 74], INK3 = [110, 110, 115], HAIR = [224, 224, 228], FILL = [245, 245, 247];

// Download the PDF (browser). jsPDF is loaded lazily so the public page
// doesn't pay for it until the customer taps Download.
export async function exportQuotePdf(quote) {
  const { doc, filename } = await buildQuotePdf(quote);
  doc.save(filename);
}

export async function buildQuotePdf(quote) {
  const { jsPDF } = await import("jspdf");
  const nb = (s) => s.replace(/[  ]/g, " "); // jsPDF core fonts lack NBSP glyphs
  const fmtD = makeMoneyFormatter(companyConfig.currency);
  const fmtC = makeCentsFormatter(companyConfig.currency);
  const money = (n) => nb(fmtD(n));
  const cents = (c) => nb(fmtC(c));
  const label = docLabel(quote.status);
  const brand = hexToRgb(companyConfig.primaryColor);
  const accent = hexToRgb(companyConfig.accentColor, brand);
  const tz = companyConfig.timeZone;
  const dateOf = (iso, dateOnly) => new Date(dateOnly ? `${String(iso).slice(0, 10)}T12:00:00Z` : iso)
    .toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: tz });
  const timeOf = (iso) => new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: tz });

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = M;
  const right = PAGE_W - M;
  const ensure = (h) => { if (y + h > PAGE_H - M - 12) { doc.addPage(); y = M; return true; } return false; };
  const text = (s, x, yy, opts) => doc.text(s, x, yy, opts);
  const font = (style, size, color) => doc.setFont("helvetica", style).setFontSize(size).setTextColor(...color);

  // --- Header ----------------------------------------------------------------
  const logo = companyConfig.logoUrl ? await loadImageAsJpeg(companyConfig.logoUrl, 240) : null;
  if (logo) {
    const h = 14, w = Math.min((logo.width / logo.height) * h, 48);
    doc.addImage(logo.dataUrl, "JPEG", M, y, w, h);
  } else {
    doc.setFillColor(...brand).roundedRect(M, y, 14, 14, 3.5, 3.5, "F");
    font("bold", 11, [255, 255, 255]);
    text(initials(companyConfig.businessName), M + 7, y + 9, { align: "center" });
  }
  font("bold", 20, brand);
  text(label.toUpperCase(), right, y + 7, { align: "right" });
  font("normal", 9.5, INK3);
  text(docRef(quote), right, y + 13, { align: "right" });
  y += 22;

  font("bold", 12, INK);
  text(companyConfig.businessName, M, y);
  font("normal", 9, INK3);
  let hy = y + 5;
  if (companyConfig.contactEmail) { text(companyConfig.contactEmail, M, hy); hy += 4.5; }
  const wa = normaliseWhatsAppNumber(companyConfig.whatsappNumber);
  if (wa) { text(`WhatsApp +${wa}`, M, hy); hy += 4.5; }
  y = hy + 3;
  doc.setDrawColor(...accent).setLineWidth(0.5).line(M, y, right, y);
  y += 9;

  // --- Parties / dates ---------------------------------------------------------
  font("normal", 8.5, INK3);
  text(`${label} for`, M, y);
  font("bold", 12, INK);
  text(quote.customer_name, M, y + 6);
  font("normal", 9.5, INK2);
  let cy = y + 11;
  if (quote.customer_phone) { text(quote.customer_phone, M, cy); cy += 4.5; }
  if (quote.customer_email) { text(quote.customer_email, M, cy); cy += 4.5; }

  const accepted = isAcceptedStatus(quote.status);
  const expired = isExpired(quote, new Date(), tz);
  const meta = [["Date", dateOf(quote.created_at)], ["Status", expired ? "Expired" : capitalise(quote.status)]];
  if (quote.valid_until && !accepted) meta.push(["Valid until", dateOf(quote.valid_until, true)]);
  if (quote.accepted_at) meta.push(["Accepted", dateOf(quote.accepted_at)]);
  if (quote.invoiced_at && isInvoiceStatus(quote.status)) meta.push(["Invoiced", dateOf(quote.invoiced_at)]);
  if (quote.paid_at) meta.push(["Paid", dateOf(quote.paid_at)]);
  let ry = y;
  for (const [k, v] of meta) {
    font("normal", 8.5, INK3); text(k, right - 62, ry);
    font("normal", 9.5, INK); text(v, right, ry, { align: "right" });
    ry += 5.5;
  }
  y = Math.max(cy, ry) + 7;

  // --- Items -----------------------------------------------------------------
  const allItems = accepted ? acceptedDocument(quote).line_items : quoteTiers(quote).flatMap((t) => t.line_items);
  const hasPhotos = allItems.some((it) => it.photo_url);
  const descX = M + (hasPhotos ? THUMB + 4 : 0);
  const descW = right - 38 - descX;
  const thumbs = new Map(await Promise.all(allItems.map(async (it) => [it.id, it.photo_url ? await loadImageAsJpeg(it.photo_url, 200) : null])));

  const columnHead = () => {
    font("bold", 8.5, INK3);
    text("Item", M, y);
    text("Amount", right, y, { align: "right" });
    y += 2.5;
    doc.setDrawColor(...HAIR).setLineWidth(0.3).line(M, y, right, y);
    y += 5;
  };
  const drawItem = (it, { muted = false, tag = null } = {}) => {
    const lines = doc.setFont("helvetica", "bold").setFontSize(10).splitTextToSize(it.description || "Untitled item", descW);
    const calc = describeCalc(it, money);
    const sub = [it.detail, calc].filter(Boolean);
    const textH = lines.length * 4.6 + sub.length * 4.2 + (tag ? 4.2 : 0);
    const th = thumbs.get(it.id);
    const rowH = Math.max(textH, th ? THUMB : 0) + 4;
    if (ensure(rowH)) columnHead();
    if (th) {
      const s = Math.min(THUMB / th.width, THUMB / th.height);
      doc.addImage(th.dataUrl, "JPEG", M, y - 3, th.width * s, th.height * s);
    }
    font("bold", 10, muted ? INK3 : INK);
    text(lines, descX, y);
    let sy = y + lines.length * 4.6;
    font("normal", 8.5, INK3);
    for (const s of sub) { text(doc.splitTextToSize(s, descW)[0], descX, sy); sy += 4.2; }
    if (tag) { font("bold", 8, accent); text(tag, descX, sy); }
    font("bold", 10, muted ? INK3 : INK);
    text(money(it.total), right, y, { align: "right" });
    y += rowH;
    doc.setDrawColor(...HAIR).setLineWidth(0.2).line(descX, y - 3.5, right, y - 3.5);
  };
  const totalsBlock = (rows, strongIdx) => {
    ensure(rows.length * 7 + 6);
    y += 1;
    rows.forEach(([k, v], i) => {
      const strong = i === strongIdx;
      if (strong) { doc.setFillColor(...FILL).roundedRect(right - 82, y - 5, 82, 9.5, 2, 2, "F"); }
      font(strong ? "bold" : "normal", strong ? 12 : 9.5, strong ? brand : INK2);
      text(k, right - 79, y + (strong ? 1 : 0));
      font(strong ? "bold" : "normal", strong ? 12 : 9.5, strong ? brand : INK);
      text(v, right - 3, y + (strong ? 1 : 0), { align: "right" });
      y += strong ? 10 : 6;
    });
  };
  const depositRows = (totalC, dep) => (dep && dep.depositCents > 0
    ? [[accepted ? "Deposit due now" : "Deposit due on acceptance", cents(dep.depositCents)], ["Balance on completion", cents(dep.balanceCents)]]
    : []);

  if (accepted) {
    const d = acceptedDocument(quote);
    if (d.tierName) { font("bold", 11, INK); text(`Option chosen: ${d.tierName}`, M, y); y += 7; }
    columnHead();
    for (const it of d.line_items) drawItem(it, { tag: isOptional(it) ? "Add-on chosen" : null });
    totalsBlock([["Subtotal", money(d.subtotal)], ["Total", money(d.total)], ...depositRows(d.totalCents, d.deposit)], 1);
  } else if (isTiered(quote)) {
    font("normal", 9.5, INK2);
    text("Choose one option when you accept online.", M, y); y += 7;
    const deposit = quoteDeposit(quote);
    for (const [i, t] of quoteTiers(quote).entries()) {
      ensure(24);
      const tc = baseCents(t.line_items);
      font("bold", 11.5, brand); text(`Option ${i + 1}: ${t.name}`, M, y);
      font("bold", 11.5, INK); text(cents(tc), right, y, { align: "right" });
      y += 7;
      columnHead();
      for (const it of t.line_items) drawItem(it, isOptional(it) ? { muted: true, tag: "Optional add-on, not in the total" } : {});
      const dep = deposit ? depositSplit(tc, deposit) : null;
      totalsBlock([[`${t.name} total`, cents(tc)], ...depositRows(tc, dep)], 0);
      y += 4;
    }
  } else {
    const items = quote.line_items ?? [];
    const tc = baseCents(items);
    columnHead();
    for (const it of items) drawItem(it, isOptional(it) ? { muted: true, tag: "Optional add-on, not in the total" } : {});
    const deposit = quoteDeposit(quote);
    totalsBlock([["Subtotal", money(quote.subtotal ?? 0)], ["Total", money(quote.total ?? 0)], ...depositRows(tc, deposit ? depositSplit(tc, deposit) : null)], 1);
  }

  // --- Acceptance, payment, notes -------------------------------------------
  y += 4;
  const para = (title, body, color = INK2) => {
    const lines = doc.setFont("helvetica", "normal").setFontSize(9.5).splitTextToSize(body, right - M);
    ensure(lines.length * 4.6 + (title ? 6 : 0) + 2);
    if (title) { font("bold", 9.5, INK); text(title, M, y); y += 5; }
    font("normal", 9.5, color); text(lines, M, y);
    y += lines.length * 4.6 + 4;
  };
  if (accepted && quote.accepted_name) {
    para("Accepted by", `${quote.accepted_name}, on ${dateOf(quote.accepted_at)} at ${timeOf(quote.accepted_at)}. The customer typed their full name and ticked the consent box online.`);
  }
  // Payment block: same content as the quote page (bank details + link).
  const pay = expired ? null : paymentBlock(companyConfig, quote, docRef(quote));
  if (pay) {
    const body = [pay.note, pay.instructions, `Reference: ${pay.reference}.`].filter(Boolean).join(" ");
    para(pay.title, body);
    if (pay.link) {
      ensure(8);
      font("normal", 9.5, INK2); text("Pay online:", M, y);
      font("normal", 9.5, brand);
      doc.textWithLink(pay.link, M + doc.getTextWidth("Pay online: "), y, { url: pay.link });
      y += 8;
    }
  }

  const note = isInvoiceStatus(quote.status)
    ? (quote.status === "paid"
        ? "Paid in full. Thank you for your business."
        : `This invoice is based on the quote you accepted${quote.accepted_at ? ` on ${dateOf(quote.accepted_at)}` : ""}.`)
    : accepted
      ? `Quote accepted${quote.accepted_at ? ` on ${dateOf(quote.accepted_at)}` : ""}. ${companyConfig.businessName} will be in touch to arrange the work.`
      : expired
        ? `This quote expired on ${dateOf(quote.valid_until, true)}. Contact ${companyConfig.businessName} for an updated quote.`
        : "This quote can be viewed and accepted online via the link you were sent.";
  para(null, note);
  if (quote.is_demo) para(null, "Demo quote made from sample data.", INK3);
  if (companyConfig.quoteTerms) para(null, companyConfig.quoteTerms, INK3);

  // --- Footer on every page ---------------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    font("normal", 8, [150, 150, 155]);
    text(`${companyConfig.businessName}${companyConfig.contactEmail ? ` · ${companyConfig.contactEmail}` : ""}`, M, PAGE_H - 9);
    text(`Page ${p} of ${pages}`, right, PAGE_H - 9, { align: "right" });
  }

  const safeName = (quote.customer_name || "customer").replace(/[^\w\-]+/g, "_").slice(0, 40);
  return { doc, filename: `${label}-${safeName}-${docRef(quote).split("-")[1]}.pdf` };
}

// Load any browser-decodable image (jpg/png/webp) from a URL, downscale so
// the longest side is `maxPx`, and return a JPEG data URL + dimensions.
// Returns null on any failure (CORS, HEIC, 404, no DOM) so the PDF still generates.
async function loadImageAsJpeg(url, maxPx) {
  if (!url || typeof Image === "undefined") return null;
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
    c.width = Math.round(img.naturalWidth * s) || 1;
    c.height = Math.round(img.naturalHeight * s) || 1;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; // flatten transparency (logos)
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return { dataUrl: c.toDataURL("image/jpeg", 0.85), width: c.width, height: c.height };
  } catch {
    return null;
  }
}

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);
