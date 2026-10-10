# Editor Syntax and Manuscripts

The light UI uses neutral white and gray surfaces, a white editor, and near-black source text (`#202020`). Saturated blue actions and distinct green, purple, red, and teal syntax colors make controls and tokens easier to distinguish. Dark mode keeps charcoal surfaces (`#1f1f1f` editor, `#181818` sidebar), with brighter blue links (`#3794ff`) and brighter syntax colors. Filled blue buttons use a darker blue than links so their white labels remain legible. Terminal colors follow the editor palette; switching themes preserves the shell session.

Light-mode chrome uses solid neutral surfaces without a colored background gradient. Only overlays (dialogs, the ⌘K finder and toasts) use translucency and blur. Source editors, terminals and PDF pages keep opaque reading surfaces. Reduced-transparency preferences also make overlays solid. Theme colors live in `src/tokens.css`; terminal ANSI colors live in `src/TerminalPanel.tsx`.

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
