#!/bin/bash
# Install/update from GitHub Releases; signing belongs to the release publisher.
set -euo pipefail

main() {
  local verify_only=false check_only=false reinstall=false allow_preview=false
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --verify-only) verify_only=true ;;
      --check) check_only=true ;;
      --reinstall) reinstall=true ;;
      --preview) allow_preview=true ;;
      *) echo "Usage: bash install-macos.sh [--preview] [--check | --verify-only | --reinstall]" >&2; return 1 ;;
    esac
    shift
  done
  local repo=naisslab/ResearchWorkbench app_name="Research Workbench.app"
  local destination="${RESEARCH_WORKBENCH_INSTALL_DIR:-$HOME/Applications}" arch
  [[ "$(uname -s)" == Darwin ]] || { echo "This installer requires macOS." >&2; return 1; }
  arch=$(uname -m)
  if [[ "$arch" == arm64 || "$(sysctl -in hw.optional.arm64 2>/dev/null || true)" == 1 ]]; then
    arch=arm64
  elif [[ "$arch" == x86_64 ]]; then arch=x64
  else echo "Unsupported Mac architecture: $arch" >&2; return 1; fi
  local os_version
  os_version=$(sw_vers -productVersion)
  [[ "${os_version%%.*}" -ge 13 ]] || { echo "macOS 13 or later is required." >&2; return 1; }
  command -v gh >/dev/null || { echo "Install GitHub CLI (https://cli.github.com), then run: gh auth login" >&2; return 1; }
  gh auth status --hostname github.com >/dev/null 2>&1 || { echo "Run gh auth login with access to $repo, then retry." >&2; return 1; }

  local work staging="" mounted=false lock="" backup="" committed=false target=""
  work=$(mktemp -d "${TMPDIR:-/tmp}/research-workbench-install.XXXXXX")
  cleanup() {
    local status=$?
    trap - EXIT
    set +e
    if [[ "$committed" == false && -n "$backup" && -d "$backup/$app_name" ]]; then
      if [[ ! -e "$target" && ! -L "$target" ]]; then
        mv "$backup/$app_name" "$target" || echo "Restore the previous app from: $backup" >&2
      else
        echo "Previous app retained at: $backup" >&2
      fi
    fi
    if [[ "$mounted" == true ]]; then hdiutil detach "$work/mount" -quiet || true; fi
    if [[ -n "$staging" ]]; then rm -rf "$staging"; fi
    if [[ -n "$lock" ]]; then rmdir "$lock" || true; fi
    rm -rf "$work"
    return "$status"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  local tag version asset digest preview=false
  if tag=$(gh api "repos/$repo/releases/latest" --jq '.tag_name' 2>"$work/latest-error"); then
    [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Unexpected stable release tag: $tag" >&2; exit 1; }
    version=${tag#v}
    asset="Research-Workbench-$version-$arch.dmg"
    digest=$(gh api "repos/$repo/releases/tags/$tag" --jq ".assets[] | select(.name == \"$asset\" and .state == \"uploaded\") | .digest")
    [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo "Release $tag has no verified $arch DMG asset." >&2; exit 1; }
    digest=${digest#sha256:}
  else
    if ! grep -q 'HTTP 404' "$work/latest-error"; then cat "$work/latest-error" >&2; exit 1; fi
    # Confirm repository access before treating a private-repository 404 as no release.
    gh api "repos/$repo" --silent
    [[ "$allow_preview" == true ]] || { echo "No stable release is published. Use --preview to allow the unsigned 0.1.0 preview." >&2; exit 1; }
    [[ "$arch" == arm64 ]] || { echo "The unsigned preview is available only for Apple silicon." >&2; exit 1; }
    preview=true
    tag=preview-0.1.0
    version=0.1.0
    asset=Research-Workbench-0.1.0-arm64.dmg
    digest=90a11ed3674a06598b38ec2a614234aa012a178d26883076becefdd0a5932b70
    echo "No stable release yet; using the explicitly allowed unsigned preview."
  fi

  # Reuse an existing installation rather than creating a second app elsewhere.
  if [[ -z "${RESEARCH_WORKBENCH_INSTALL_DIR:-}" && -e "/Applications/$app_name" ]]; then
    [[ ! -e "$destination/$app_name" ]] || { echo "Two installations found. Set RESEARCH_WORKBENCH_INSTALL_DIR to choose one." >&2; exit 1; }
    destination=/Applications
  fi
  target="$destination/$app_name"
  [[ ! -L "$target" ]] || { echo "Refusing to replace a symbolic link: $target" >&2; exit 1; }
  local installed="" existing_id
  if [[ -e "$target" ]]; then
    existing_id=$(plutil -extract CFBundleIdentifier raw -o - "$target/Contents/Info.plist")
    [[ "$existing_id" == com.research.workbench ]] || { echo "A different app occupies $target; left unchanged." >&2; exit 1; }
    installed=$(plutil -extract CFBundleShortVersionString raw -o - "$target/Contents/Info.plist")
    [[ "$installed" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Cannot compare installed version: $installed" >&2; exit 1; }
  fi
  echo "Installed: ${installed:-none}; available: $version ($tag, $arch)."
  if [[ "$check_only" == true ]]; then exit 0; fi
  if [[ -n "$installed" ]]; then
    local old_parts new_parts i
    IFS=. read -r -a old_parts <<< "$installed"
    IFS=. read -r -a new_parts <<< "$version"
    for i in 0 1 2; do
      if (( 10#${old_parts[i]} > 10#${new_parts[i]} )); then echo "Refusing to downgrade $installed to $version." >&2; exit 1; fi
      if (( 10#${old_parts[i]} < 10#${new_parts[i]} )); then break; fi
    done
    if [[ "$installed" == "$version" && "$reinstall" == false && "$verify_only" == false ]]; then
      echo "Already current. Use --reinstall to replace the app with a fresh verified copy."
      exit 0
    fi
  fi
  if [[ "$verify_only" == false ]] && pgrep -f '/Research Workbench[.]app/Contents/MacOS/Research Workbench' >/dev/null; then
    echo "Quit Research Workbench and rerun this command. No running app was stopped." >&2; exit 1
  fi

  echo "Downloading Research Workbench ${version}..."
  gh release download "$tag" --repo "$repo" --pattern "$asset" --dir "$work"
  (cd "$work" && printf '%s  %s\n' "$digest" "$asset" | shasum -a 256 -c -)
  mkdir "$work/mount"
  mounted=true
  hdiutil attach "$work/$asset" -readonly -nobrowse -mountpoint "$work/mount" -quiet
  local source="$work/mount/$app_name" bundle_id bundle_version
  [[ -d "$source" && ! -L "$source" ]] || { echo "Expected app is missing from the DMG." >&2; exit 1; }
  bundle_id=$(plutil -extract CFBundleIdentifier raw -o - "$source/Contents/Info.plist")
  bundle_version=$(plutil -extract CFBundleShortVersionString raw -o - "$source/Contents/Info.plist")
  [[ "$bundle_id" == com.research.workbench && "$bundle_version" == "$version" ]] || { echo "The app identity or version does not match the release." >&2; exit 1; }
  if [[ "$preview" == false ]]; then
    codesign --verify --deep --strict "$source"
    codesign --display --verbose=4 "$source" 2>&1 | grep -q '^Authority=Developer ID Application:'
    spctl --assess --type execute "$source"
    xcrun stapler validate "$source"
  fi
  if [[ "$verify_only" == true ]]; then
    echo "Release verified. No app was installed."
  else
    mkdir -p "$destination"
    [[ -w "$destination" ]] || { echo "$destination is not writable. Use the DMG with Finder's administrator approval." >&2; exit 1; }
    mkdir "$destination/.research-workbench-install-lock" || { echo "Another installation may be running. Check it before retrying." >&2; exit 1; }
    lock="$destination/.research-workbench-install-lock"
    staging=$(mktemp -d "$destination/.research-workbench.XXXXXX")
    ditto "$source" "$staging/$app_name"
    if [[ "$preview" == false ]]; then codesign --verify --deep --strict "$staging/$app_name"; fi
    # Recheck after downloading and staging; another installer or the user may have acted.
    if pgrep -f '/Research Workbench[.]app/Contents/MacOS/Research Workbench' >/dev/null; then
      echo "Research Workbench was opened during installation. Quit it and retry." >&2; exit 1
    fi
    if [[ -n "$installed" ]]; then
      [[ ! -L "$target" && "$(plutil -extract CFBundleIdentifier raw -o - "$target/Contents/Info.plist")" == com.research.workbench && "$(plutil -extract CFBundleShortVersionString raw -o - "$target/Contents/Info.plist")" == "$installed" ]] || { echo "Installation changed; retry." >&2; exit 1; }
      backup=$(mktemp -d "$destination/.research-workbench-backup.XXXXXX")
      mv "$target" "$backup/$app_name"
    else
      [[ ! -e "$target" && ! -L "$target" ]] || { echo "Destination changed; existing app left unchanged." >&2; exit 1; }
    fi
    mv -n "$staging/$app_name" "$destination/"
    [[ ! -e "$staging/$app_name" ]] || { echo "Replacement failed; restoring the previous app." >&2; exit 1; }
    committed=true
    echo "Installed: $target"
    [[ -z "$backup" ]] || echo "Previous app retained at: $backup/$app_name"
    echo "Project files and application support data were not removed."
  fi
  if [[ "$preview" == true ]]; then echo "This preview is unsigned and not notarized. macOS may block first launch."; fi
  echo "Gatekeeper and quarantine settings were not changed."
  # Keep locals available to cleanup on all exit paths.
  exit 0
}
main "$@"
