import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { BRAND } from "./src/config/brand";

// Fills %BRAND_*% placeholders in index.html (title, SEO and social metadata)
// from the central brand config, and serves/emits the PWA manifest from it.
const manifest = () =>
  JSON.stringify(
    {
      name: BRAND.name,
      short_name: BRAND.name,
      description: BRAND.description,
      lang: "es",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: BRAND.backgroundColor,
      theme_color: BRAND.themeColor,
      icons: [
        { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    null,
    2
  );

const brandHtml = () => ({
  name: "brand-html",
  transformIndexHtml: (html) =>
    html
      .replaceAll("%BRAND_NAME%", BRAND.name)
      .replaceAll("%BRAND_COMPACT%", BRAND.compactName)
      .replaceAll("%BRAND_URL%", BRAND.url)
      .replaceAll("%BRAND_TAGLINE%", BRAND.tagline)
      .replaceAll("%BRAND_DESCRIPTION%", BRAND.description)
      .replaceAll("%BRAND_THEME%", BRAND.themeColor)
      .replaceAll("%BRAND_OG_IMAGE%", BRAND.url + BRAND.ogImage)
      .replaceAll("%BRAND_OG_ALT%", BRAND.ogImageAlt),
  configureServer(server) {
    server.middlewares.use("/manifest.webmanifest", (_req, res) => {
      res.setHeader("Content-Type", "application/manifest+json");
      res.end(manifest());
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use("/manifest.webmanifest", (_req, res) => {
      res.setHeader("Content-Type", "application/manifest+json");
      res.end(manifest());
    });
  },
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: manifest() });
  },
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
