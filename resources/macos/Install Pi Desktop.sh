#!/bin/bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
source_app="$script_dir/Pi Desktop.app"
target_app="/Applications/Pi Desktop.app"

if [[ ! -d "$source_app" ]]; then
  printf 'Pi Desktop.app was not found next to this installer.\n' >&2
  exit 1
fi

printf 'Checking the Pi Desktop application bundle...\n'
/usr/bin/codesign --verify --deep --strict "$source_app"

# Stop an existing copy before replacing it. Failure is harmless when it is not running.
/usr/bin/pkill -x "Pi Desktop" >/dev/null 2>&1 || true
sleep 1

install_for_current_user() {
  /bin/rm -rf "$target_app" &&
    /usr/bin/ditto "$source_app" "$target_app" &&
    /usr/bin/xattr -dr com.apple.quarantine "$target_app"
}

if ! install_for_current_user; then
  printf 'Administrator permission is required to update /Applications.\n'
  /usr/bin/sudo /bin/rm -rf "$target_app"
  /usr/bin/sudo /usr/bin/ditto "$source_app" "$target_app"
  /usr/bin/sudo /usr/bin/xattr -dr com.apple.quarantine "$target_app"
fi

printf 'Pi Desktop was installed in /Applications. Opening it now...\n'
/usr/bin/open "$target_app"
