import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "pdfjs-dist/web/pdf_viewer.css";
import "./styles.css";
import "./workbench.css";
import "./themes.css";
import "./deadlines.css";
import "./light-glass.css";
import "./git-workflow.css";
import "./pdf-reader.css";

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
