#!/bin/bash
set -euo pipefail
if [ ! -x /Library/TeX/texbin/tlmgr ]; then
  brew install --cask basictex
fi
echo "/Library/TeX/texbin" >> "$GITHUB_PATH"
# Keep tlmgr and texlive-scripts (including fmtutil) in sync. Updating only
# tlmgr can make it pass new format-selection options to BasicTeX's older
# fmtutil, which then rejects the package installation's postprocessing.
sudo /Library/TeX/texbin/tlmgr update --self --all
sudo /Library/TeX/texbin/tlmgr install latexmk latexdiff collection-latexrecommended collection-latexextra collection-fontsrecommended collection-xetex collection-luatex
