/** @type {import('tailwindcss').Config} */
// Tokens copied from the DropStack console (dropstack-outreachv2
// apps/web/src/styles.css) per dropstack-tools-DESIGN.md §1. Do not re-derive.
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}", "./companyConfig.js"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "'SF Pro Text'", "'SF Pro Display'", "'Helvetica Neue'", "'Segoe UI'", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "'SF Mono'", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        canvas: "#f5f5f7",
        ink: { DEFAULT: "#1d1d1f", 2: "#48484a", 3: "#6e6e73", 4: "#aeaeb2" },
        hairline: "rgb(0 0 0 / 0.08)",
        fill: { DEFAULT: "#f2f2f4", 2: "#e8e8ed" },
        chrome: "#1c1c1e",
        good: { DEFAULT: "#1a7a37", soft: "#e6f6ea" },
        warn: { DEFAULT: "#a35200", soft: "#fff4e0" },
        bad: { DEFAULT: "#c7001a", soft: "#ffeaec" },
        info: { DEFAULT: "#0062cc", soft: "#e7f1ff" },
        action: { DEFAULT: "#0066cc", fill: "#0071e3" },
        field: "#d2d2d7",
        error: "#b42318",
        // Client brand from companyConfig.js, set as CSS variables in main.jsx.
        brand: { DEFAULT: "rgb(var(--brand-rgb) / <alpha-value>)", ink: "var(--brand-ink)" },
      },
      borderRadius: { card: "18px", input: "12px" },
      boxShadow: {
        card: "0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px -12px rgb(0 0 0 / 0.12)",
        lift: "0 2px 4px rgb(0 0 0 / 0.05), 0 18px 40px -16px rgb(0 0 0 / 0.22)",
        ring: "0 0 0 4px rgb(0 113 227 / 0.18)",
      },
      transitionTimingFunction: { "out-soft": "cubic-bezier(0.22, 1, 0.36, 1)" },
      keyframes: {
        shimmer: { from: { backgroundPosition: "-400px 0" }, to: { backgroundPosition: "400px 0" } },
        "pulse-dot": {
          "0%": { boxShadow: "0 0 0 0 rgb(52 199 89 / 0.55)" },
          "70%": { boxShadow: "0 0 0 7px rgb(52 199 89 / 0)" },
          "100%": { boxShadow: "0 0 0 0 rgb(52 199 89 / 0)" },
        },
        rise: { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        "sheet-up": { from: { transform: "translateY(100%)" }, to: { transform: "none" } },
        "sheet-left": { from: { transform: "translateX(100%)" }, to: { transform: "none" } },
        fade: { from: { opacity: "0" }, to: { opacity: "1" } },
        flash: { "0%": { backgroundColor: "rgb(0 113 227 / 0.08)" }, "100%": { backgroundColor: "transparent" } },
      },
      animation: {
        shimmer: "shimmer 1.4s linear infinite",
        "pulse-dot": "pulse-dot 2s cubic-bezier(0.22, 1, 0.36, 1) infinite",
        rise: "rise 220ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "sheet-up": "sheet-up 240ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "sheet-left": "sheet-left 240ms cubic-bezier(0.22, 1, 0.36, 1) both",
        fade: "fade 180ms ease-out both",
        flash: "flash 900ms ease-out",
      },
    },
  },
  plugins: [],
};
