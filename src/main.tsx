import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./tokens.css";
import "./styles.css";
import "./workbench.css";
import "./deadlines.css";
import "./git-workflow.css";
import "./pdf-reader.css";

// Main sets the native theme from the saved appearance, so the media query
// already matches it; this avoids a light frame before React mounts.
document.documentElement.dataset.theme = matchMedia(
  "(prefers-color-scheme: dark)",
).matches
  ? "dark"
  : "light";

// Load bundled fonts before xterm measures its character cells.
void Promise.all([
  document.fonts.load('400 13px "Inter Variable"'),
  document.fonts.load('400 13px "JetBrains Mono Variable"'),
])
  .catch(() => {})
  .then(() => {
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
