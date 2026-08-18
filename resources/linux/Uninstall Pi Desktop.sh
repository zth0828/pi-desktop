#!/bin/sh
set -eu

printf 'This removes Pi Desktop app data. Pi sessions in ~/.pi will not be removed.\n'
read -r -p 'Continue? [y/N] ' answer
if [ "$answer" != "y" ] && [ "$answer" != "Y" ]; then
  exit 0
fi

rm -rf \
  "$HOME/.config/Pi Desktop" \
  "$HOME/.config/pi-desktop" \
  "$HOME/.cache/Pi Desktop" \
  "$HOME/.cache/pi-desktop" \
  "$HOME/.local/share/Pi Desktop" \
  "$HOME/.local/share/pi-desktop"

printf 'Pi Desktop app data was removed. Delete the AppImage manually if it is no longer needed.\n'
