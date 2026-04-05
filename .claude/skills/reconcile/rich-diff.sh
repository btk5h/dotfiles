#!/bin/bash
# rich-diff.sh — Enriched chezmoi diff that includes timestamp direction for each file.
# Wraps `chezmoi diff` output, injecting a DIRECTION header before each file's diff.
#
# For source files: uses git commit time unless the file has uncommitted changes,
# in which case file mtime is used (since local edits are more recent).
# For target files: always uses file mtime.
#
# Usage: bash .claude/skills/reconcile/rich-diff.sh
#
# Output format: standard chezmoi diff output, with a direction line before each file:
#   # SOURCE_AHEAD: .config/ghostty/config.ghostty (source: 1775369903, target: 1775369800)
#   diff --git a/.config/ghostty/config.ghostty b/.config/ghostty/config.ghostty
#   ...
#
# Direction values:
#   SOURCE_AHEAD — source file was modified more recently than target
#   TARGET_AHEAD — target file was modified more recently than source
#   SAME_TIME    — both have the same modification time
#   NEW_FILE     — file exists on one side only (no timestamp comparison possible)
#
# Exit codes:
#   0 — completed (empty output means no drift)

set -euo pipefail

CHEZMOI_SOURCE="$(chezmoi source-path)"
TARGET_HOME="$(chezmoi target-path)"

# Capture full diff output
diff_output=$(chezmoi diff --no-pager 2>/dev/null) || true

if [ -z "$diff_output" ]; then
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
        echo "SOURCE_AHEAD (source: $source_ts, target: $target_ts)"
    elif [ "$target_ts" -gt "$source_ts" ]; then
        echo "TARGET_AHEAD (source: $source_ts, target: $target_ts)"
    else
        echo "SAME_TIME"
    fi
}

# Process diff output line by line, injecting direction headers
while IFS= read -r line; do
    if [[ "$line" == "diff --git a/"* ]]; then
        # Extract target-relative path from diff header
        target_rel=$(echo "$line" | sed 's|^diff --git a/\(.*\) b/.*|\1|')
        direction=$(direction_for "$target_rel")
        echo "# $direction: $target_rel"
    fi
    echo "$line"
done <<< "$diff_output"
