---
name: reconcile
description: Reconcile differences between chezmoi source state and target state (home directory), including Homebrew packages. Use this skill when the user wants to review pending dotfile changes, sync their chezmoi source with what's actually in their home directory, resolve drift between managed files, reconcile packages, or decide file-by-file whether to apply or update source. Trigger on phrases like "reconcile", "sync dotfiles", "chezmoi diff", "what changed in my dotfiles", "dotfile drift", "reconcile packages", "brew drift", "package drift", or any mention of source vs target state differences.
allowed-tools:
  - Bash(bash "$(chezmoi source-path)/.claude/skills/reconcile/brew-diff.sh")
  - Bash(chezmoi diff *)
  - Bash(chezmoi data *)
  - Bash(chezmoi cat *)
  - Bash(chezmoi source-path *)
---

# Reconcile

Guide the user through reconciling differences between their chezmoi source state (this repo) and their target state (`~/`), including Homebrew package drift.

## Workflow

### Step 1: Reconcile Homebrew packages

Compare declaratively managed packages (from `.chezmoidata/packages.yaml`) against what is actually installed via Homebrew.

#### 1a. Run the diff script

Run the helper script to compute package drift:

```bash
bash "$(chezmoi source-path)/.claude/skills/reconcile/brew-diff.sh"
```

This script handles all data gathering (chezmoi data, brew list, .brew-ignored) and outputs structured lines:
- `PROFILE: <name>` — the active chezmoi profile
- `MISSING TAP/FORMULA/CASK: <pkg>` — declared but not installed (will be installed on next `chezmoi apply`)
- `EXTRA TAP/FORMULA/CASK: <pkg>` — installed but not declared (needs user decision)
- `IGNORED TAP/FORMULA/CASK: <pkg>` — installed, not declared, but user chose to ignore (no action needed)

If the script exits with code 1, Homebrew is not installed — skip package reconciliation.

#### 1b. Present summary

Summarize the script output to the user:
- **Missing packages** (will be installed on next `chezmoi apply`): list them, grouped by category
- **Extra packages** (installed but not declared): list them, grouped by category
- **Ignored packages**: mention the count but don't list them unless the user asks

If there are no MISSING or EXTRA lines, report that packages are in sync and move on to file reconciliation.

#### 1c. Walk through extra packages

For each EXTRA package, ask the user what to do:

1. **Add** — Add to `packages.yaml`. Ask whether to add under `common` (all profiles) or the active profile's key. Edit `.chezmoidata/packages.yaml` to insert the package in the appropriate list, maintaining alphabetical order.

2. **Ignore** — The user doesn't want to manage this package declaratively. Append the package name to `.brew-ignored` in the chezmoi source directory (create the file if it doesn't exist). Use `chezmoi source-path` to locate it. It will never be prompted about again.

3. **Uninstall** — Remove the package via `brew uninstall <package>` (or `brew uninstall --cask <package>` for casks, `brew untap <tap>` for taps).

4. **Skip** — Leave for this session only. The package will appear again on the next reconcile.

Process packages in batches by category (taps, then formulae, then casks). For large lists, offer a bulk "ignore all remaining" option to avoid tedium.

Missing packages need no action — they will be installed automatically on next `chezmoi apply`.

### Step 2: Discover file differences

Run `chezmoi diff --no-pager` to see all pending changes. This shows what `chezmoi apply` would do -- i.e., what the source state wants to write to the target.

The diff output uses unified diff format:
- Lines prefixed with `-` show what's currently in the **target** (home directory)
- Lines prefixed with `+` show what the **source** (this repo) wants to write

If there are no differences, tell the user everything is in sync and stop.

### Step 3: Summarize the changes

Present a clear, concise summary of each file that has differences. Group them logically (e.g., fish config, git config, etc.) and for each file explain:
- The **target path** (e.g., `~/.config/fish/config.fish`)
- A brief description of what changed (e.g., "source adds a new alias for `ll`", "target has a manually-added PATH entry that source would remove")
- The **direction** of the change: is the source ahead (you made changes in the repo), or is the target ahead (you made changes directly in `~/`)

Use your judgment about how much detail to show. For small diffs, show them inline. For large diffs, summarize and offer to show details on request.

### Step 4: Walk through each file

For each file with differences, ask the user what they want to do. Present these options clearly:

1. **Apply** -- Write the source state to the target (this is what `chezmoi apply` would do for this file). No action needed now; it will happen when they run `chezmoi apply`.

2. **Update source** -- The target has the version they want to keep. Update the source state to match the target by running `chezmoi add <target-path>`, which copies the target file back into the source state. For template files (`.tmpl`), this is more nuanced -- explain that `chezmoi add` will capture the rendered output and they may need to manually update the template. Offer to help edit the template directly.

3. **Merge** -- They want parts of both. Help them edit the source file in this repo to incorporate the desired parts from the target. Use `chezmoi cat <target-path>` to see what the source would render, and read the actual target file to compare. Then edit the source file together.

4. **Skip** -- Leave this file for later, no action now.

Process files one at a time or in small batches if there are many. Let the user set the pace.

#### Profile-scoped changes

This repo supports multiple profiles (e.g., "personal" and "work") configured via `.chezmoi.toml.tmpl`. Template files (`.tmpl`) can conditionally include content based on `{{ .profile }}`.

When a conflict involves a template file, or when updating source / merging changes, always ask the user whether the change should:
- Apply to **all profiles** (add it outside any `{{ if }}` block)
- Apply only to a **specific profile** (wrap it in `{{ if eq .profile "personal" }}` or `{{ if eq .profile "work" }}`)

This is especially important when the target has changes that were made on a specific machine -- those changes may only be relevant to the profile that machine uses. Run `chezmoi data` to check which profile is active on the current machine so you can give informed suggestions about scoping.

### Step 5: Apply the resolution

After walking through all files, summarize what was decided:
- Files to apply (source wins)
- Files with source updated (target wins)
- Files merged (source edited)
- Files skipped

If any files were marked for "apply," remind the user to run `chezmoi apply` (or offer to run it for them). If source was updated or files were merged, those changes are already in the source state and the user may want to commit them.

## Important notes

- The chezmoi source directory can be found with `chezmoi source-path` (this repo)
- Source files use chezmoi naming conventions: `dot_` prefix becomes `.`, `private_` sets permissions, `exact_` removes unmanaged files, `.tmpl` suffix means it's a Go template
- When editing source files, respect the chezmoi naming conventions. Edit the file as it exists in this repo (e.g., `private_dot_config/private_fish/config.fish.tmpl`), not the target path.
- Template files (`.tmpl`) may contain Go template directives. When merging or updating source, be careful not to break template syntax. If the user wants to update source from a rendered config into a template, help them preserve template expressions where appropriate.
- Use `chezmoi data` if you need to see what template variables are available for debugging templates.