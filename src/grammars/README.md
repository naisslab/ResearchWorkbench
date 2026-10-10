# Bundled VS Code Grammars

Source: https://github.com/jlelong/vscode-latex-basics
Commit: 16299890194c0d512faec405113b54075afdb7e6
Retrieved: October 9, 2026

The five grammar JSON files are copied without changes. See LICENSE.txt for their MIT license. The LaTeX grammar incorporates the original TextMate LaTeX grammar under the following license, also documented by the upstream repository:

> Permission to copy, use, modify, sell and distribute this software is granted. This software is provided "as is" without express or implied warranty, and with no claim as to its suitability for any purpose.

Vite bundles the tokenizer packages vscode-textmate and vscode-oniguruma into the renderer, so the packaged app does not include their package folders. Their MIT licenses and the Oniguruma notice ship in electron/licenses instead. Unsupported embedded-language scopes are left plain rather than loaded from the network.
