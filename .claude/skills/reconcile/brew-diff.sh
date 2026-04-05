#!/bin/bash
# brew-diff.sh — Compare declared Homebrew packages against installed ones.
# Outputs a structured diff that the reconcile skill can parse.
#
# Usage: bash .claude/skills/reconcile/brew-diff.sh
#
# Output format (one package per line):
#   PROFILE: <active profile>
#   MISSING TAP: <tap>
#   MISSING FORMULA: <formula>
#   MISSING CASK: <cask>
#   EXTRA TAP: <tap>
#   EXTRA FORMULA: <formula>
#   EXTRA CASK: <cask>
#   IGNORED TAP: <tap>
#   IGNORED FORMULA: <formula>
#   IGNORED CASK: <cask>
#
# Exit codes:
#   0 — diff computed (may or may not have differences)
#   1 — brew not installed or chezmoi data unavailable

set -euo pipefail

if ! command -v brew &>/dev/null && ! [ -x /opt/homebrew/bin/brew ]; then
    echo "ERROR: Homebrew is not installed" >&2
    exit 1
fi

eval "$(/opt/homebrew/bin/brew shellenv)"

CHEZMOI_SOURCE="$(chezmoi source-path)"
IGNORED_FILE="$CHEZMOI_SOURCE/.brew-ignored"

# --- Gather declared packages via chezmoi execute-template (no python/jq needed) ---
PROFILE=$(chezmoi execute-template '{{ .profile }}')
echo "PROFILE: $PROFILE"

declared_list() {
    local category=$1
    chezmoi execute-template "{{ range concat .packages.${category}.common (index .packages.${category} .profile) }}{{ . }}
{{ end }}"
}

DECLARED_TAPS=$(declared_list taps)
DECLARED_FORMULAE=$(declared_list formulae)
DECLARED_CASKS=$(declared_list casks)

# --- Gather installed packages ---
# Use `--installed-on-request` to only surface formulae the user explicitly installed.
# Anything installed as a dependency is automatically treated as ignored.
INSTALLED_TAPS=$(brew tap 2>/dev/null || true)
INSTALLED_FORMULAE=$(brew list --formula --installed-on-request --full-name -1 2>/dev/null || true)
INSTALLED_CASKS=$(brew list --cask -1 2>/dev/null || true)
DEP_FORMULAE=$(brew list --formula --installed-as-dependency --full-name -1 2>/dev/null || true)

# --- Load ignored packages ---
IGNORED=""
if [ -f "$IGNORED_FILE" ]; then
    IGNORED=$(grep -v '^#' "$IGNORED_FILE" | grep -v '^[[:space:]]*$' || true)
fi

is_ignored() {
    local pkg=$1
    # Match bare name (exact) or tap-qualified entry ending with /<pkg>.
    # Use fixed-string matching to handle special characters (e.g. logi-options+).
    if [ -n "$IGNORED" ] && { echo "$IGNORED" | grep -qFx "$pkg" || echo "$IGNORED" | grep -qF "/$pkg"; }; then
        return 0
    fi
    if [ -n "$DEP_FORMULAE" ] && echo "$DEP_FORMULAE" | grep -qx "$pkg"; then
        return 0
    fi
    return 1
}

# --- Compute and output diff ---
diff_category() {
    local category_label=$1
    local declared=$2
    local installed=$3

    # Missing: declared but not installed
    if [ -n "$declared" ]; then
        while IFS= read -r pkg; do
            [ -z "$pkg" ] && continue
            if ! echo "$installed" | grep -qx "$pkg"; then
                echo "MISSING $category_label: $pkg"
            fi
        done <<< "$declared"
    fi

    # Extra: installed but not declared
    if [ -n "$installed" ]; then
        while IFS= read -r pkg; do
            [ -z "$pkg" ] && continue
            if [ -n "$declared" ] && echo "$declared" | grep -qx "$pkg"; then
                continue
            fi
            if ! is_ignored "$pkg"; then
                echo "EXTRA $category_label: $pkg"
            fi
        done <<< "$installed"
    fi
}

diff_category "TAP" "$DECLARED_TAPS" "$INSTALLED_TAPS"
diff_category "FORMULA" "$DECLARED_FORMULAE" "$INSTALLED_FORMULAE"
diff_category "CASK" "$DECLARED_CASKS" "$INSTALLED_CASKS"
