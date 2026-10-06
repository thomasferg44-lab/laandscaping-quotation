// All money maths happens here, in integer cents. No floats on the money path.
//
// Boundaries:
//   in:  toCents(value)       user input ("1 250,50", "85") or stored numeric (1999.99)
//   out: fromCents(cents)     decimal number for Supabase (numeric(12,2) / jsonb)
//        formatCents(cents)   display string via Intl
//
// Rounding is half away from zero ("commercial" rounding): R0.005 -> R0.01,
// -R0.005 -> -R0.01. Quantities (m², loads, days) keep 3 decimals.

export const QTY_SCALE = 3;

// Parse a decimal into a BigInt scaled by 10^scale, rounding half away from
// zero. Strings are parsed digit by digit, so "1.005" is exactly 1.005.
// Numbers go through String(), whose shortest round-trip form is the decimal
// the number was stored as (1.005, not 1.00499999…). Invalid input -> 0n.
export function parseScaled(value, scale) {
  if (value === null || value === undefined || value === "") return 0n;
  let s;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0n;
    s = String(value);
    if (/e/i.test(s)) s = value.toFixed(scale + 1); // tiny values; huge ones fail the regex below
  } else {
    s = String(value).replace(/[\s  ]/g, "");
    // A lone comma is a decimal comma (en-ZA "1250,50"); with a dot present
    // commas are thousands separators ("1,250.50").
    s = s.includes(".") ? s.replace(/,/g, "") : s.replace(",", ".");
  }
  const m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (!m[2] && !m[3])) return 0n;
  const [, sign, whole = "", frac = ""] = m;
  const kept = BigInt((whole || "0") + frac.padEnd(scale, "0").slice(0, scale));
  const roundUp = frac.length > scale && frac[scale] >= "5" ? 1n : 0n;
  const abs = kept + roundUp;
  return sign === "-" ? -abs : abs;
}

const toSafeNumber = (big) => {
  const n = Number(big);
  return Number.isSafeInteger(n) ? n : 0;
};

export function toCents(value) {
  return toSafeNumber(parseScaled(value, 2));
}

// Quantity as an integer number of thousandths (12.5 m² -> 12500).
export function toQtyMilli(value) {
  return toSafeNumber(parseScaled(value, QTY_SCALE));
}

// Divide BigInts, rounding half away from zero.
function divRound(n, d) {
  const q = n / d, r = n % d;
  if (r * 2n >= d) return q + 1n;
  if (r * 2n <= -d) return q - 1n;
  return q;
}

// qty × rate in cents. BigInt so large m² × rate can't overflow.
export function multiplyCents(qty, rate) {
  const unit = 10n ** BigInt(QTY_SCALE);
  return toSafeNumber(divRound(parseScaled(qty, QTY_SCALE) * BigInt(toCents(rate)), unit));
}

export function sumCents(values) {
  return values.reduce((acc, c) => acc + c, 0);
}

// Exact decimal string, e.g. 199999 -> "1999.99", -5 -> "-0.05".
export function centsToDecimalString(cents) {
  const neg = cents < 0;
  const abs = String(Math.abs(cents)).padStart(3, "0");
  return `${neg ? "-" : ""}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

// For storage. Number("1999.99") is the double Postgres parses back to
// exactly 1999.99, and toCents() reads it back exactly.
export function fromCents(cents) {
  return Number(centsToDecimalString(cents));
}

// Quantity back to a plain number for storage/display (12500 -> 12.5).
export function fromQtyMilli(milli) {
  const neg = milli < 0;
  const abs = String(Math.abs(milli)).padStart(QTY_SCALE + 1, "0");
  return Number(`${neg ? "-" : ""}${abs.slice(0, -QTY_SCALE)}.${abs.slice(-QTY_SCALE)}`);
}

// Intl formats decimal strings exactly, so no float is involved here either.
export function makeCentsFormatter(currency) {
  const fmt = new Intl.NumberFormat("en-ZA", { style: "currency", currency, minimumFractionDigits: 2 });
  return (cents) => fmt.format(centsToDecimalString(cents));
}
