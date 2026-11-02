#!/bin/bash
# defaults-diff.sh — Compare declared macOS defaults against this machine's values.
# Outputs a structured diff that the reconcile skill can parse.
#
# Usage: bash .claude/skills/reconcile/defaults-diff.sh
#
# Output format (one setting per line):
#   PROFILE: <active profile>
#   DRIFT <domain> <key> [<type>]: machine=<value> repo=<value>
#       — prefixed with "-currentHost " before <domain> for per-host settings;
#         machine=<unset> when the key doesn't exist on this machine
#   SUMMARY: drift=<n> checked=<n>
#   IN_SYNC: ...                      — when drift=0
#
# Bools are shown as true/false on both sides; `defaults read` prints them as 1/0.
#
# Exit codes:
#   0 — diff computed (may or may not have differences)
#   2 — unknown flag

set -euo pipefail

if [ "$#" -gt 0 ]; then
    echo "ERROR: unknown flag '$1' (no flags supported)"
    exit 2
fi

PROFILE=$(chezmoi execute-template '{{ .profile }}')
echo "PROFILE: $PROFILE"

DECLARED=$(chezmoi execute-template '{{ range concat .macos.defaults.common (index .macos.defaults .profile) }}{{ .domain }}	{{ .key }}	{{ .type }}	{{ .value }}	{{ if get . "currentHost" }}-currentHost{{ end }}
{{ end }}')

normalize() {
    local type=$1 value=$2
    if [ "$type" = "bool" ]; then
        case "$value" in
            1 | true | TRUE | YES) echo true ;;
            0 | false | FALSE | NO) echo false ;;
            *) echo "$value" ;;
        esac
    else
        echo "$value"
    fi
}

DRIFT_COUNT=0
CHECKED_COUNT=0

while IFS=$'\t' read -r domain key type value host_flag; do
    [ -z "$domain" ] && continue
    CHECKED_COUNT=$((CHECKED_COUNT + 1))

    if machine=$(defaults $host_flag read "$domain" "$key" 2>/dev/null); then
        machine=$(normalize "$type" "$machine")
    else
        machine="<unset>"
    fi
    repo=$(normalize "$type" "$value")

    if [ "$machine" != "$repo" ]; then
        echo "DRIFT ${host_flag:+$host_flag }$domain $key [$type]: machine=$machine repo=$repo"
        DRIFT_COUNT=$((DRIFT_COUNT + 1))
    fi
done <<< "$DECLARED"

echo "SUMMARY: drift=$DRIFT_COUNT checked=$CHECKED_COUNT"
if [ "$DRIFT_COUNT" = "0" ]; then
    echo "IN_SYNC: declared macOS defaults match this machine — no action needed"
fi
