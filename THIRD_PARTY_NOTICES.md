# Third-Party Notices

The MIT license at the repository root covers Research Workbench's original code. Dependencies, fonts, grammars, and bundled runtimes retain their own licenses and notices.

## Bundled Resources

- LaTeX, BibTeX, and related TextMate grammars: see `src/grammars/LICENSE.txt`, `src/grammars/README.md`, and `electron/licenses/vscode-latex-grammars-NOTICE.md`.
- vscode-textmate and vscode-oniguruma: notices are preserved in `electron/licenses/`.
- Electron includes Chromium and other components. Preserve the `LICENSE` and `LICENSES.chromium.html` files delivered in the application bundle.
- Inter and JetBrains Mono fonts: retain the license files distributed with the corresponding `@fontsource-variable` packages.
- Codex and its platform runtime packages: retain their upstream license and notice files when packaging the runtime.

## Release Review

Use `package-lock.json` as the dependency inventory for a build. Review all production dependencies and renderer-bundled dependencies, including fonts, when updating versions. `npm ls --all` and package license fields are useful inputs, but they do not replace reviewing the distributed files and their upstream terms.

The desktop packaging step copies this document, the project license, and font license notices into the application. Do not remove notices while trimming packaged dependencies. Before publishing, inspect the application bundle and ensure every redistributed component's required license text is present. This document is a maintainer checklist, not a claim that an automated license audit has completed.
