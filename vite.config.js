import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { BRAND } from "./src/config/brand";

// Fills %BRAND_*% placeholders in index.html (title, SEO and social metadata)
// from the central brand config.
const brandHtml = () => ({
  name: "brand-html",
  transformIndexHtml: (html) =>
    html
      .replaceAll("%BRAND_NAME%", BRAND.name)
      .replaceAll("%BRAND_URL%", BRAND.url)
      .replaceAll("%BRAND_TAGLINE%", BRAND.tagline)
      .replaceAll("%BRAND_DESCRIPTION%", BRAND.description)
      .replaceAll("%BRAND_THEME%", BRAND.themeColor),
});

export default defineConfig({
  plugins: [brandHtml(), react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    hmr: {
      port: 3000,
    },
  },
});
