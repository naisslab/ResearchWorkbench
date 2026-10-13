#!/bin/bash
set -euo pipefail
if [ ! -x /Library/TeX/texbin/tlmgr ]; then
  brew install --cask basictex
fi
echo "/Library/TeX/texbin" >> "$GITHUB_PATH"
sudo /Library/TeX/texbin/tlmgr update --self
sudo /Library/TeX/texbin/tlmgr install latexmk latexdiff collection-latexrecommended collection-latexextra collection-fontsrecommended collection-xetex collection-luatex
