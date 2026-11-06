import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { companyConfig } from "./companyConfig.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// index.html carries the client's name (tab title, link previews) straight
// from companyConfig.js, so a config swap rebrands it too.
const brandHtml = () => ({
  name: "brand-html",
  transformIndexHtml: (html) => html
    .replaceAll("%BUSINESS_NAME%", esc(companyConfig.businessName))
    .replaceAll("%LOGO_URL%", esc(companyConfig.logoUrl || "data:,")),
});

export default defineConfig({
  plugins: [react(), brandHtml()],
});
