#!/usr/bin/env bash
set -euo pipefail

output_dir="${1:-release}"
product_name="Pi Desktop"
shopt -s nullglob

apps=("$output_dir"/mac*/"$product_name.app")
dmgs=("$output_dir"/*.dmg)

if (( ${#apps[@]} == 0 )); then
  printf 'No packaged macOS apps found under %s/mac*\n' "$output_dir" >&2
  exit 1
fi
if (( ${#dmgs[@]} == 0 )); then
  printf 'No DMG artifacts found under %s\n' "$output_dir" >&2
  exit 1
fi

for app in "${apps[@]}"; do
  printf 'Verifying app: %s\n' "$app"
  codesign --verify --deep --strict --verbose=2 "$app"
  spctl --assess --type execute --verbose=2 "$app"
  xcrun stapler validate "$app"
done

for dmg in "${dmgs[@]}"; do
  printf 'Verifying DMG: %s\n' "$dmg"
  hdiutil verify "$dmg"
  codesign --verify --verbose=2 "$dmg"
  spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"
done
