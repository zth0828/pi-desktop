#!/bin/bash
set -euo pipefail

app_name="Pi Desktop"
target_app="/Applications/${app_name}.app"

remove_user_data() {
  local home_dir="$1"
  rm -rf \
    "$home_dir/Library/Application Support/Pi Desktop" \
    "$home_dir/Library/Application Support/pi-desktop" \
    "$home_dir/Library/Caches/Pi Desktop" \
    "$home_dir/Library/Caches/pi-desktop" \
    "$home_dir/Library/Logs/Pi Desktop" \
    "$home_dir/Library/Logs/pi-desktop" \
    "$home_dir/Library/Saved Application State/io.github.zth0828.pidesktop.savedState" \
    "$home_dir/Library/Preferences/io.github.zth0828.pidesktop.plist"
}

printf 'This removes Pi Desktop and its app data. Pi sessions in ~/.pi will not be removed.\n'
read -r -p 'Continue? [y/N] ' answer
if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  exit 0
fi

/usr/bin/pkill -x "$app_name" >/dev/null 2>&1 || true
sleep 1

if [[ -d "$target_app" ]]; then
  if ! /bin/rm -rf "$target_app"; then
    printf 'Administrator permission is required to remove %s.\n' "$target_app"
    /usr/bin/sudo /bin/rm -rf "$target_app"
  fi
fi

remove_user_data "$HOME"
if [[ "$0" == "/Applications/Uninstall Pi Desktop.command" ]]; then
  /bin/rm -f "$0" 2>/dev/null || /usr/bin/sudo /bin/rm -f "$0"
fi
printf 'Pi Desktop and its app data were removed.\n'
