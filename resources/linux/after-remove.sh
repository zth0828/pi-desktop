#!/bin/sh
set -eu

# Debian invokes post-removal scripts for upgrades as well as removals.
case "${1:-remove}" in
  remove|purge) ;;
  *) exit 0 ;;
esac

remove_user_data() {
  home_dir="$1"
  [ -d "$home_dir" ] || return 0
  rm -rf \
    "$home_dir/.config/Pi Desktop" \
    "$home_dir/.config/pi-desktop" \
    "$home_dir/.cache/Pi Desktop" \
    "$home_dir/.cache/pi-desktop" \
    "$home_dir/.local/share/Pi Desktop" \
    "$home_dir/.local/share/pi-desktop"
}

# Package removal runs as root, so clean known user home directories rather
# than relying on $HOME (which normally points at /root in maintainer scripts).
remove_user_data /root
for home_dir in /home/*; do
  remove_user_data "$home_dir"
done
