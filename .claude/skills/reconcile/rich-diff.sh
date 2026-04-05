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
# Usage: bash .claude/skills/reconcile/rich-diff.sh
#
# Output format — labeled diff with direction headers:
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
        echo "REPO_NEWER"
    elif [ "$target_ts" -gt "$source_ts" ]; then
        echo "MACHINE_NEWER"
    else
        echo "SAME_TIME"
    fi
}

# Process diff output line by line, replacing -/+ with labels
while IFS= read -r line; do
    if [[ "$line" == "diff --git a/"* ]]; then
        # Extract target-relative path from diff header
        target_rel=$(echo "$line" | sed 's|^diff --git a/\(.*\) b/.*|\1|')
        direction=$(direction_for "$target_rel")
        echo ""
        echo "=== $target_rel ($direction) ==="
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
        echo "$line"
    elif [[ "$line" == "-"* ]]; then
        # Machine content (chezmoi diff: - = current target state)
        echo "[MACHINE] ${line:1}"
    elif [[ "$line" == "+"* ]]; then
        # Repo content (chezmoi diff: + = desired source state)
        echo "[REPO]    ${line:1}"
    elif [[ "$line" == " "* ]]; then
        # Context line (same on both sides) — keep leading space for alignment
        echo "         ${line:1}"
    else
        echo "$line"
    fi
done <<< "$diff_output"
