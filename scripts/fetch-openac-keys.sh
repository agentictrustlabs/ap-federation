#!/usr/bin/env sh
# THE OPENAC 1k KEYS (openac-sdk 5.0.0's published artifacts, the host its README names). Two halves, two homes:
#   · the VERIFYING keys (≈280 MB) → apps/door/verifier/keys/  — the verifier image's build context (gitignored);
#   · the PROVING keys   (≈280 MB) → $OPENAC_KEYS_DIR (default ~/.cache/openac-5.0.0) — the gate's holder half runs
#     Prepare and Show here; a verifier never holds them.
# Idempotent: a key already present at its size is kept. Ring 0's lock (`openac-sdk`) pins the SDK; these keys are what
# `OpenAcRequestParamsV1.acceptedVersions` binds a bundle `version` to (1/OPENAC §Versioning) — change them, change that.
set -eu
BASE="${OPENAC_KEYS_BASE_URL:-https://pub-d941fd6fc0c84bd892810e681a55edcd.r2.dev/openac-5.0.0}"
VERIFIER_DIR="$(dirname "$0")/../apps/door/verifier/keys"
PROVING_DIR="${OPENAC_KEYS_DIR:-$HOME/.cache/openac-5.0.0}"
mkdir -p "$VERIFIER_DIR" "$PROVING_DIR"
fetch() { # url dest
  if [ -s "$2" ]; then echo "  kept   $2 ($(wc -c < "$2") bytes)"; return; fi
  echo "  fetch  $1"; curl -fsSL --retry 3 -o "$2.part" "$1" && mv "$2.part" "$2"; echo "  wrote  $2 ($(wc -c < "$2") bytes)"
}
echo "verifying keys → $VERIFIER_DIR"
fetch "$BASE/1k_prepare_verifying.key" "$VERIFIER_DIR/1k_prepare_verifying.key"
fetch "$BASE/1k_show_verifying.key" "$VERIFIER_DIR/1k_show_verifying.key"
if [ "${1:-}" = "--proving" ]; then
  echo "proving keys → $PROVING_DIR (the holder half; the gate reads OPENAC_KEYS_DIR)"
  for k in 1k_prepare_proving 1k_prepare_verifying 1k_show_proving 1k_show_verifying; do fetch "$BASE/$k.key" "$PROVING_DIR/$k.key"; done
fi
