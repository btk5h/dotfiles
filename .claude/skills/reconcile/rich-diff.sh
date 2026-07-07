#!/bin/bash
# rich-diff.sh — Enriched chezmoi diff with explicit side labels.
# Wraps `chezmoi diff` output, replacing the ambiguous -/+ prefixes with
# [MACHINE] and [REPO] labels so there is zero confusion about which side
# each line belongs to.
#
# Terminology:
#   "repo"         = chezmoi source state (this git repo)
#   "this machine" = chezmoi target state (home directory, what's actually on disk)
#
# For repo files: uses git commit time unless the file has uncommitted changes,
# in which case file mtime is used (since local edits are more recent).
# For machine files: always uses file mtime.
#
# Usage: bash .claude/skills/reconcile/rich-diff.sh [--full] [path]
#   --full  Disable per-file truncation
#   path    Restrict the diff to one target path (implies --full)
#
# Output format — summary line, then labeled per-file diffs:
#
#   SUMMARY: files=2 machine_newer=1 repo_newer=1 same_time=0 new_file=0
#
#   === .config/ghostty/config (MACHINE_NEWER) ===
#   @@ -1,6 +1,6 @@
#    font-family = JetBrainsMono Nerd Font Propo
#   [MACHINE] font-size = 14
#   [REPO]    font-size = 13
#    theme = catppuccin-mocha
#
# Labels:
#   [MACHINE] — this line is content on this machine (home directory)
#   [REPO]    — this line is content from the repo (what apply would write)
#   (unlabeled, indented) — context lines present on both sides
#
# Direction values (in the === header):
#   MACHINE_NEWER — this machine's file was modified more recently than repo
#   REPO_NEWER    — repo file was modified more recently than this machine
#   SAME_TIME     — both have the same modification time
#   NEW_FILE      — file exists on one side only
#
# Per-file diffs longer than 60 lines are truncated with a
# "TRUNCATED: ..." line telling you how to get the full diff.
#
# When there is no drift, prints "NO_DRIFT: ..." (never empty output).
#
# Exit codes:
#   0 — completed (with or without drift)
#   2 — unknown flag

set -euo pipefail

MAX_LINES_PER_FILE=60
FULL=0
FILTER_PATH=""
for arg in "$@"; do
    case "$arg" in
        --full) FULL=1 ;;
        --*)
            echo "ERROR: unknown flag '$arg' (supported: --full, or a target path)"
            exit 2
            ;;
        *) FILTER_PATH="$arg"; FULL=1 ;;
    esac
done

CHEZMOI_SOURCE="$(chezmoi source-path)"
TARGET_HOME="$(chezmoi target-path)"

# Capture full diff output
if [ -n "$FILTER_PATH" ]; then
    diff_output=$(chezmoi diff --no-pager "$FILTER_PATH" 2>/dev/null) || true
else
    diff_output=$(chezmoi diff --no-pager 2>/dev/null) || true
fi

if [ -z "$diff_output" ]; then
    if [ -n "$FILTER_PATH" ]; then
        echo "NO_DRIFT: $FILTER_PATH matches the repo — nothing to reconcile"
    else
        echo "NO_DRIFT: repo and this machine are in sync — nothing to reconcile"
    fi
    exit 0
fi

# Get list of dirty source files (uncommitted changes)
dirty_source=$(cd "$CHEZMOI_SOURCE" && {
    git diff --name-only HEAD 2>/dev/null || true
    git diff --name-only --cached 2>/dev/null || true
} | sort -u)

# Compute direction for a target-relative path
direction_for() {
    local target_rel=$1
    local target_path="$TARGET_HOME/$target_rel"
    local source_path
    source_path=$(chezmoi source-path "$target_path" 2>/dev/null) || true

    if [ -z "$source_path" ] || [ ! -f "$source_path" ] || [ ! -f "$target_path" ]; then
        echo "NEW_FILE"
        return
    fi

    # Determine source timestamp
    local source_rel="${source_path#$CHEZMOI_SOURCE/}"
    local source_ts
    if echo "$dirty_source" | grep -qFx "$source_rel"; then
        source_ts=$(stat -f '%m' "$source_path" 2>/dev/null || echo 0)
    else
        source_ts=$(cd "$CHEZMOI_SOURCE" && git log -1 --format=%ct -- "$source_rel" 2>/dev/null || echo 0)
        if [ "$source_ts" = "0" ]; then
            source_ts=$(stat -f '%m' "$source_path" 2>/dev/null || echo 0)
        fi
    fi

    local target_ts
    target_ts=$(stat -f '%m' "$target_path" 2>/dev/null || echo 0)

    if [ "$source_ts" -gt "$target_ts" ]; then
        echo "REPO_NEWER"
    elif [ "$target_ts" -gt "$source_ts" ]; then
        echo "MACHINE_NEWER"
    else
        echo "SAME_TIME"
    fi
}

FILE_COUNT=0
MACHINE_NEWER_COUNT=0
REPO_NEWER_COUNT=0
SAME_TIME_COUNT=0
NEW_FILE_COUNT=0
BODY=""
current_file=""
current_lines=0
current_hidden=0

flush_file() {
    if [ -n "$current_file" ] && [ "$current_hidden" -gt 0 ]; then
        BODY+="TRUNCATED: $current_hidden more line(s) — run rich-diff.sh $current_file for the full diff"$'\n'
    fi
    current_lines=0
    current_hidden=0
}

append_line() {
    if [ "$FULL" = "1" ] || [ "$current_lines" -lt "$MAX_LINES_PER_FILE" ]; then
        BODY+="$1"$'\n'
        current_lines=$((current_lines + 1))
    else
        current_hidden=$((current_hidden + 1))
    fi
}

# Process diff output line by line, replacing -/+ with labels
while IFS= read -r line; do
    if [[ "$line" == "diff --git a/"* ]]; then
        flush_file
        # Extract target-relative path from diff header
        target_rel=$(echo "$line" | sed 's|^diff --git a/\(.*\) b/.*|\1|')
        direction=$(direction_for "$target_rel")
        current_file="$target_rel"
        FILE_COUNT=$((FILE_COUNT + 1))
        case "$direction" in
            MACHINE_NEWER) MACHINE_NEWER_COUNT=$((MACHINE_NEWER_COUNT + 1)) ;;
            REPO_NEWER) REPO_NEWER_COUNT=$((REPO_NEWER_COUNT + 1)) ;;
            SAME_TIME) SAME_TIME_COUNT=$((SAME_TIME_COUNT + 1)) ;;
            NEW_FILE) NEW_FILE_COUNT=$((NEW_FILE_COUNT + 1)) ;;
        esac
        BODY+=$'\n'"=== $target_rel ($direction) ==="$'\n'
    elif [[ "$line" == "--- a/"* ]] || [[ "$line" == "--- /dev/null" ]]; then
        # Skip the old --- header (replaced by === header)
        continue
    elif [[ "$line" == "+++ b/"* ]] || [[ "$line" == "+++ /dev/null" ]]; then
        # Skip the old +++ header (replaced by === header)
        continue
    elif [[ "$line" == "index "* ]]; then
        # Skip index line
        continue
    elif [[ "$line" == "@@"* ]]; then
        # Keep hunk headers for context
        append_line "$line"
    elif [[ "$line" == "-"* ]]; then
        # Machine content (chezmoi diff: - = current target state)
        append_line "[MACHINE] ${line:1}"
    elif [[ "$line" == "+"* ]]; then
        # Repo content (chezmoi diff: + = desired source state)
        append_line "[REPO]    ${line:1}"
    elif [[ "$line" == " "* ]]; then
        # Context line (same on both sides) — keep leading space for alignment
        append_line "         ${line:1}"
    else
        append_line "$line"
    fi
done <<< "$diff_output"
flush_file

echo "SUMMARY: files=$FILE_COUNT machine_newer=$MACHINE_NEWER_COUNT repo_newer=$REPO_NEWER_COUNT same_time=$SAME_TIME_COUNT new_file=$NEW_FILE_COUNT"
printf '%s' "$BODY"
