// Must run before any module reads browser storage.
import "./config/legacyStorage";
// Errors in production go to the admin's "Errores" tab; imported early so a
// failure while the rest of the app loads is caught too.
import "./lib/errorReporting";
// Keeps the browser's "install app" offer, which arrives only once and early.
import "./lib/install";
import React from "react";
import ReactDOM from "react-dom/client";
// Fonts and icons are bundled with the app (no third-party CDN at runtime).
import "@fontsource-variable/inter";
import "@fontsource-variable/sora";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./index.css";
import App from "./App.tsx";

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
