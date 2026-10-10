# Editor Syntax and Manuscripts

The dark UI follows VS Code Dark Modern's neutral surfaces: editor `#1f1f1f`, sidebar `#181818`, subtle borders and muted ink-blue actions. Light mode uses a calmer Snazzy Light palette: lower-chroma syntax colors and an ink-blue accent. Source token colors carry semantic differences; dashboard surfaces remain neutral. System appearance and terminal sessions retain their existing behavior.

Light-mode chrome uses translucent white surfaces over a muted cool-gray background; only overlays (dialogs, the ⌘K finder and toasts) blur what is behind them. Source editors, terminals and PDF pages keep opaque reading surfaces. Reduced-transparency preferences use solid surfaces. The light material is the light-theme block of `src/tokens.css` and does not change dark-mode colors.

## Syntax Engine

LaTeX, TeX, DocTeX, BibTeX and BibTeX style use Microsoft's `vscode-textmate` with `vscode-oniguruma`, the engine used by VS Code on macOS, Linux and Windows. Upstream grammars come from [VSCode LaTeX grammars](https://github.com/jlelong/vscode-latex-basics). Upstream snapshot: `16299890194c0d512faec405113b54075afdb7e6`. The copied grammars retain their MIT license in `src/grammars/LICENSE.txt`; the upstream LaTeX grammar also incorporates the permissively licensed TextMate LaTeX grammar described in that repository's README.

Each line caches its incoming and outgoing grammar state. An edit retokenizes changed lines and subsequent lines whose context changed, so multiline math and environments stay consistent. Token scopes distinguish comments, commands, arguments, references, section headings, math, constants, operators and delimiters. The engine and grammars ship with the app and require no network access while editing.

Python, JavaScript, TypeScript, C/C++, CSS, HTML and JSON use CodeMirror's language parsers. Shell, YAML, TOML, Go, Rust, SQL and R use its maintained legacy modes. JSON adds parser diagnostics with gutter markers and underlines. LaTeX errors continue to come from the actual compiler in Build Log; highlighting does not claim to be a TeX language server. Embedded code inside LaTeX is limited to the bundled grammar set; a full external-language grammar registry is not bundled.

## Imported Manuscripts

| Project | Local Folder | Entry | Source |
| --- | --- | --- | --- |
| Web RAG | `~/Documents/GitHub/Web-RAG-Paper` | `main.tex` | Complete source archive from Overleaf WWW2027-Web RAG, October 9, 2026 |
| Synthetic Network Data SoK | `~/Documents/GitHub/Synthetic-Network-Data-SoK` | `paper.tex` | Complete source archive from its verified Overleaf project, October 9, 2026 |
| HillInfer | `~/Documents/GitHub/HillInfer-Overleaf` | `sample-sigconf.tex` | Latest Eurosys 2027 / HillServe Overleaf source, same project confirmed by the user |
| HillInfer arXiv Source | `~/Documents/GitHub/HillInfer-Paper` | `usenix.tex` | Official arXiv 2602.18750v2 TeX source, retained separately |

All imported folders have a local Git baseline. No GitHub remote was invented. Web RAG's Overleaf account allows only its project owner to establish GitHub linking; SoK's integration dialog confirms it has no linked repository. The user confirmed HillInfer's newer HillServe/EuroSys draft; its GitHub linking is also restricted to the project owner. These are source snapshots, so local edits do not automatically update Overleaf.

The research catalog records these folders and entry files, so the projects it adds start with them attached. Folder choices made in the app are kept.
