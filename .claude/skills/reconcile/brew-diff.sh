#!/bin/bash
# brew-diff.sh — Compare declared Homebrew packages against installed ones.
# Outputs a structured diff that the reconcile skill can parse.
#
# Usage: bash .claude/skills/reconcile/brew-diff.sh [--ignored]
#   --ignored  List ignored packages individually (default: count only)
#
# Output format (one package per line):
#   PROFILE: <active profile>
#   MISSING TAP|FORMULA|CASK: <pkg>   — declared in repo, not installed
#   EXTRA TAP|FORMULA|CASK: <pkg>     — installed, not declared
#   IGNORED TAP|FORMULA|CASK: <pkg>   — only with --ignored
#   SUMMARY: missing=<n> extra=<n> ignored=<n>
#   IN_SYNC: ...                      — when missing=0 and extra=0
#   NEXT: ...                         — suggested follow-up commands
#
# Exit codes:
#   0 — diff computed (may or may not have differences)
#   1 — brew not installed or chezmoi data unavailable
#   2 — unknown flag

set -euo pipefail

SHOW_IGNORED=0
for arg in "$@"; do
    case "$arg" in
        --ignored) SHOW_IGNORED=1 ;;
        *)
            echo "ERROR: unknown flag '$arg' (supported: --ignored)"
            exit 2
            ;;
    esac
done

if ! command -v brew &>/dev/null && ! [ -x /opt/homebrew/bin/brew ]; then
    echo "ERROR: Homebrew is not installed — skip package reconciliation"
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
# `--installed-on-request` lists only formulae the user explicitly installed;
# dependencies are gathered separately and treated as ignored for EXTRA checks,
# while INSTALLED_FORMULAE_ALL (every installed formula) backs the MISSING check.
# `--full-name` is intentionally omitted: in current Homebrew it no longer
# prefixes tap formulae with their tap, and it silently drops a formula whose
# short name collides with a core formula (e.g. flux vs fluxcd/tap/flux). We
# match on short names instead (see diff_formulae).
INSTALLED_TAPS=$(brew tap 2>/dev/null || true)
INSTALLED_FORMULAE=$(brew list --formula --installed-on-request -1 2>/dev/null || true)
INSTALLED_FORMULAE_ALL=$(brew list --formula -1 2>/dev/null || true)
INSTALLED_CASKS=$(brew list --cask -1 2>/dev/null || true)
DEP_FORMULAE=$(brew list --formula --installed-as-dependency -1 2>/dev/null || true)

# --- Load ignored packages ---
IGNORED=""
if [ -f "$IGNORED_FILE" ]; then
    IGNORED=$(grep -v '^#' "$IGNORED_FILE" | grep -v '^[[:space:]]*$' || true)
fi

MISSING_COUNT=0
EXTRA_COUNT=0
IGNORED_COUNT=0

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

emit_missing() {
    echo "MISSING $1: $2"
    MISSING_COUNT=$((MISSING_COUNT + 1))
}

emit_extra_or_ignored() {
    local category_label=$1 pkg=$2
    if is_ignored "$pkg"; then
        IGNORED_COUNT=$((IGNORED_COUNT + 1))
        if [ "$SHOW_IGNORED" = "1" ]; then
            echo "IGNORED $category_label: $pkg"
        fi
    else
        echo "EXTRA $category_label: $pkg"
        EXTRA_COUNT=$((EXTRA_COUNT + 1))
    fi
}

# --- Compute and output diff ---
diff_category() {
    local category_label=$1
    local declared=$2
    local installed=$3

    # Missing: declared in repo but not installed on this machine
    if [ -n "$declared" ]; then
        while IFS= read -r pkg; do
            [ -z "$pkg" ] && continue
            if ! echo "$installed" | grep -qx "$pkg"; then
                emit_missing "$category_label" "$pkg"
            fi
        done <<< "$declared"
    fi

    # Extra: installed on this machine but not declared in repo
    if [ -n "$installed" ]; then
        while IFS= read -r pkg; do
            [ -z "$pkg" ] && continue
            if [ -n "$declared" ] && echo "$declared" | grep -qx "$pkg"; then
                continue
            fi
            emit_extra_or_ignored "$category_label" "$pkg"
        done <<< "$installed"
    fi
}

# Formulae need short-name matching. A formula declared with a tap prefix
# (e.g. fluxcd/tap/flux) is listed by `brew list` under its short name (flux),
# so compare on the segment after the last "/". "Missing" is judged against the
# full installed set so a declared formula that is present only as a dependency
# isn't falsely flagged for reinstall.
diff_formulae() {
    local declared=$1
    local installed_request=$2
    local installed_all=$3

    # Missing: declared in repo but no formula with that short name is installed.
    if [ -n "$declared" ]; then
        while IFS= read -r pkg; do
            [ -z "$pkg" ] && continue
            if ! echo "$installed_all" | grep -qx "${pkg##*/}"; then
                emit_missing "FORMULA" "$pkg"
            fi
        done <<< "$declared"
    fi

    # Extra: explicitly installed but no declared formula shares its short name.
    if [ -n "$installed_request" ]; then
        while IFS= read -r pkg; do
            [ -z "$pkg" ] && continue
            local declared_match=
            while IFS= read -r d; do
                [ -z "$d" ] && continue
                if [ "${d##*/}" = "$pkg" ]; then
                    declared_match=1
                    break
                fi
            done <<< "$declared"
            [ -n "$declared_match" ] && continue
            emit_extra_or_ignored "FORMULA" "$pkg"
        done <<< "$installed_request"
    fi
}

diff_category "TAP" "$DECLARED_TAPS" "$INSTALLED_TAPS"
diff_formulae "$DECLARED_FORMULAE" "$INSTALLED_FORMULAE" "$INSTALLED_FORMULAE_ALL"
diff_category "CASK" "$DECLARED_CASKS" "$INSTALLED_CASKS"

echo "SUMMARY: missing=$MISSING_COUNT extra=$EXTRA_COUNT ignored=$IGNORED_COUNT"
if [ "$MISSING_COUNT" = "0" ] && [ "$EXTRA_COUNT" = "0" ]; then
    echo "IN_SYNC: declared packages match installed packages — no action needed"
fi
if [ "$MISSING_COUNT" -gt 0 ]; then
    echo "NEXT: run 'chezmoi apply' to install the $MISSING_COUNT missing package(s)"
fi
if [ "$SHOW_IGNORED" = "0" ] && [ "$IGNORED_COUNT" -gt 0 ]; then
    echo "NEXT: re-run with --ignored to list the $IGNORED_COUNT ignored package(s)"
fi
