// Brand colour helpers: CSS variables from companyConfig, a readable text
// colour on the brand, and the initials monogram used when there's no logo.
export function hexToRgb(hex, fallback = [47, 82, 51]) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return fallback;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export function luminance(rgb) { const [r, g, b] = rgb.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
export function contrast(a, b) { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }

// White text unless it fails AA (4.5:1) on the brand and ink does better.
export function brandInk(hex) {
  const rgb = hexToRgb(hex);
  const w = contrast(rgb, [255, 255, 255]);
  return w >= 4.5 || w >= contrast(rgb, [29, 29, 31]) ? "#ffffff" : "#1d1d1f";
}

export function initials(name) {
  const words = String(name || "").replace(/[^\p{L}\p{N}\s&-]/gu, "").split(/\s+/).filter(Boolean);
  const pick = words.filter((w) => !/^(and|&|the|of|-)$/i.test(w));
  return ((pick[0]?.[0] ?? "") + (pick[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function applyBrand(config, root = document.documentElement) {
  const rgb = hexToRgb(config.primaryColor);
  root.style.setProperty("--brand-rgb", rgb.join(" "));
  root.style.setProperty("--brand-ink", brandInk(config.primaryColor));
  root.style.setProperty("--accent", config.accentColor || config.primaryColor);
}
