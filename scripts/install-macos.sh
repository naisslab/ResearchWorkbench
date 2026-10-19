#!/bin/bash
# Install the pinned Apple silicon preview from the private NaissLab release.
set -euo pipefail

main() {
  local verify_only=false
  case "${1:-}" in
    "") ;;
    --verify-only) verify_only=true ;;
    *) echo "Usage: bash install-macos.sh [--verify-only]" >&2; return 1 ;;
  esac
  local repo=naisslab/ResearchWorkbench tag=preview-0.1.0 version=0.1.0
  local asset=Research-Workbench-0.1.0-arm64.dmg
  local digest=90a11ed3674a06598b38ec2a614234aa012a178d26883076becefdd0a5932b70
  local destination="${RESEARCH_WORKBENCH_INSTALL_DIR:-$HOME/Applications}"
  local app_name="Research Workbench.app"

  [[ "$(uname -s)" == Darwin ]] || { echo "This installer requires macOS." >&2; return 1; }
  [[ "$(uname -m)" == arm64 || "$(sysctl -in hw.optional.arm64 2>/dev/null || true)" == 1 ]] || {
    echo "This preview requires an Apple silicon Mac; an Intel installer is not available yet." >&2; return 1;
  }
  local os_version
  os_version=$(sw_vers -productVersion)
  [[ "${os_version%%.*}" -ge 13 ]] || { echo "macOS 13 or later is required." >&2; return 1; }
  command -v gh >/dev/null || {
    echo "Install GitHub CLI (https://cli.github.com), then run: gh auth login" >&2; return 1;
  }
  gh auth status --hostname github.com >/dev/null 2>&1 || {
    echo "Run gh auth login with an account that can access $repo, then retry." >&2; return 1;
  }
  if [[ "$verify_only" == false ]]; then
    local existing
    local locations=("$destination/$app_name")
    [[ -n "${RESEARCH_WORKBENCH_INSTALL_DIR:-}" ]] || locations+=("/Applications/$app_name")
    for existing in "${locations[@]}"; do
      if [[ -e "$existing" || -L "$existing" ]]; then
        echo "An application already exists at: $existing" >&2
        echo "It was left unchanged. Use the release DMG for a deliberate upgrade." >&2
        return 1
      fi
    done
  fi

  local work staging="" mounted=false
  work=$(mktemp -d "${TMPDIR:-/tmp}/research-workbench-install.XXXXXX")
  # Cleanup runs inside main so these local variables remain in scope.
  trap 'if [[ "$mounted" == true ]]; then hdiutil detach "$work/mount" -quiet || true; fi; if [[ -n "$staging" ]]; then rm -rf "$staging"; fi; rm -rf "$work"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  echo "Downloading Research Workbench $version for Apple silicon…"
  gh release download "$tag" --repo "$repo" --pattern "$asset" --dir "$work"
  (cd "$work" && printf '%s  %s\n' "$digest" "$asset" | shasum -a 256 -c -)
  mkdir "$work/mount"
  mounted=true
  hdiutil attach "$work/$asset" -readonly -nobrowse -mountpoint "$work/mount" -quiet
  local source="$work/mount/$app_name" bundle_id bundle_version
  [[ -d "$source" && ! -L "$source" ]] || { echo "Expected app is missing from the DMG." >&2; exit 1; }
  bundle_id=$(plutil -extract CFBundleIdentifier raw -o - "$source/Contents/Info.plist")
  bundle_version=$(plutil -extract CFBundleShortVersionString raw -o - "$source/Contents/Info.plist")
  [[ "$bundle_id" == com.research.workbench && "$bundle_version" == "$version" ]] || {
    echo "The app identity or version does not match this release." >&2; exit 1;
  }
  if [[ "$verify_only" == true ]]; then
    echo "Checksum and app identity verified. No app was installed."
  else
    mkdir -p "$destination"
    staging=$(mktemp -d "$destination/.research-workbench.XXXXXX")
    ditto "$source" "$staging/$app_name"
    mv -n "$staging/$app_name" "$destination/"
    [[ ! -e "$staging/$app_name" ]] || { echo "Destination changed during installation; existing app left unchanged." >&2; exit 1; }
    echo "Installed: $destination/$app_name"
  fi
  echo "This preview is unsigned and not notarized. macOS may block first launch."
  echo "The installer does not change Gatekeeper settings or remove quarantine."
  # Exit here to execute cleanup before main's local variables go out of scope.
  exit 0
}

main "$@"
