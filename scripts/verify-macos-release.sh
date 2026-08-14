#!/usr/bin/env bash
set -euo pipefail

output_dir="${1:-release}"
signed_release="${2:-true}"
product_name="Pi Desktop"
shopt -s nullglob

if [[ "$signed_release" != "true" && "$signed_release" != "false" ]]; then
  printf 'Signing mode must be true (Developer ID) or false (ad-hoc)\n' >&2
  exit 1
fi

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

  if [[ "$signed_release" == "true" ]]; then
    spctl --assess --type execute --verbose=2 "$app"
    xcrun stapler validate "$app"
  else
    signature_info="$(codesign --display --verbose=4 "$app" 2>&1)"
    if [[ "$signature_info" != *"Signature=adhoc"* ]]; then
      printf 'Expected an ad-hoc app signature: %s\n' "$app" >&2
      exit 1
    fi
    if spctl --assess --type execute --verbose=2 "$app"; then
      printf 'An ad-hoc preview unexpectedly passed Gatekeeper: %s\n' "$app" >&2
      exit 1
    fi
  fi
done

for dmg in "${dmgs[@]}"; do
  printf 'Verifying DMG: %s\n' "$dmg"
  hdiutil verify "$dmg"

  if [[ "$signed_release" == "true" ]]; then
    codesign --verify --verbose=2 "$dmg"
    spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"
  fi
done
