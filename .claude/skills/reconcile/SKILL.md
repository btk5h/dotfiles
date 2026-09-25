---
name: reconcile
description: Reconcile drift between the chezmoi repo and this machine, covering both dotfiles and Homebrew packages. Use when the user wants to reconcile or sync their dotfiles or packages, review pending `chezmoi diff` changes, find out what changed in their dotfiles, or decide file-by-file whether to apply the repo or update it from this machine.
allowed-tools:
  - Bash(bash "$(chezmoi source-path)/.claude/skills/reconcile/brew-diff.sh")
  - Bash(bash "$(chezmoi source-path)/.claude/skills/reconcile/brew-diff.sh" *)
  - Bash(bash "$(chezmoi source-path)/.claude/skills/reconcile/rich-diff.sh")
  - Bash(bash "$(chezmoi source-path)/.claude/skills/reconcile/rich-diff.sh" *)
  - Bash(chezmoi diff *)
  - Bash(chezmoi data *)
  - Bash(chezmoi cat *)
  - Bash(chezmoi source-path *)
  - Bash(git fetch *)
  - Bash(git status *)
  - Bash(git log *)
---

# Reconcile

Guide the user through reconciling differences between the chezmoi **repo** and what's on **this machine**, including Homebrew package drift.

## Terminology

Chezmoi uses "source state" and "target state" but those terms are easy to mix up. Throughout this skill:

| Term | Chezmoi equivalent | What it means |
|---|---|---|
| **repo** | source state | This git repo — the declared, version-controlled dotfiles |
| **this machine** | target state | The home directory (`~/`) — what's actually on disk right now |
| **Apply** | `chezmoi apply` | Write repo → this machine |
| **Update repo** | `chezmoi add` | Pull this machine → repo |

When running chezmoi commands, "source" = repo and "target" = this machine.

## Workflow

### Step 0: Pull latest from origin

Reconciling against a stale local branch wastes effort — upstream commits may already declare packages or update files you'd otherwise flag as drift — so bring the branch up to date before Step 1.

Run `git fetch origin` and check `git status -sb`. If the branch is behind `origin/main`, pull before proceeding:

- **Clean working tree, behind only**: `git pull --rebase origin main`
- **Behind and ahead** (diverged): show the local commits with `git log --oneline HEAD..origin/main` and `git log --oneline origin/main..HEAD`, then ask the user how to handle it (rebase, merge, or pause)
- **Uncommitted changes**: stash them (`git stash push -m "reconcile-wip"`), pull/rebase, then `git stash pop`

### Step 1: Reconcile Homebrew packages

Compare declaratively managed packages (from `.chezmoidata/packages.yaml`) against what is actually installed on this machine via Homebrew.

#### 1a. Run the diff script

Run the helper script to compute package drift:

```bash
bash "$(chezmoi source-path)/.claude/skills/reconcile/brew-diff.sh"
```

This script handles all data gathering (chezmoi data, brew list, .brew-ignored) and outputs structured lines:
- `PROFILE: <name>` — the active chezmoi profile
- `MISSING TAP/FORMULA/CASK: <pkg>` — declared in repo but not installed on this machine (will be installed on next `chezmoi apply`)
- `EXTRA TAP/FORMULA/CASK: <pkg>` — installed on this machine but not declared in repo (needs user decision)
- `SUMMARY: missing=<n> extra=<n> ignored=<n>` — always present; trust these counts instead of re-counting
- `IN_SYNC: ...` — emitted when missing=0 and extra=0; packages need no further work
- `NEXT: ...` — suggested follow-up commands (e.g. `chezmoi apply` for missing packages)

Ignored packages are reported as a count only. Re-run with `--ignored` if the user asks to see them individually.

Exit codes: `0` success, `1` Homebrew not installed (skip package reconciliation), `2` unknown flag.

#### 1b. Present summary

Summarize the script output to the user:
- **Missing packages** (will be installed on next `chezmoi apply`): list them, grouped by category
- **Extra packages** (installed but not declared): list them, grouped by category
- **Ignored packages**: mention the count but don't list them unless the user asks

If there are no MISSING or EXTRA lines, report that packages are in sync and move on to file reconciliation.

#### 1c. Walk through extra packages

For each EXTRA package, ask the user what to do:

1. **Add** — Add to `packages.yaml`. Ask whether to add under `common` (all profiles) or the active profile's key. Edit `.chezmoidata/packages.yaml` to insert the package in the appropriate list, maintaining alphabetical order.

2. **Ignore** — The user doesn't want to manage this package declaratively. Append the package name to `.brew-ignored` in the repo directory (create the file if it doesn't exist). Use `chezmoi source-path` to locate it. It will never be prompted about again.

3. **Uninstall** — Remove the package via `brew uninstall <package>` (or `brew uninstall --cask <package>` for casks, `brew untap <tap>` for taps).

4. **Skip** — Leave for this session only. The package will appear again on the next reconcile.

Process packages in batches by category (taps, then formulae, then casks). For large lists, offer a bulk "ignore all remaining" option to avoid tedium.

Missing packages need no action — they will be installed automatically on next `chezmoi apply`.

### Step 2: Discover file differences

Run the rich-diff helper script to see all pending changes with timestamp-based direction indicators:

```bash
bash "$(chezmoi source-path)/.claude/skills/reconcile/rich-diff.sh"
```

This wraps `chezmoi diff` output with **explicit side labels** — no ambiguous `-`/`+` prefixes. Output starts with a summary line you can trust without re-counting:

```
SUMMARY: files=2 machine_newer=1 repo_newer=1 same_time=0 new_file=0
```

Each file's diff follows:

```
=== .config/fish/config.fish (MACHINE_NEWER) ===
@@ -10,7 +10,7 @@
          set -gx EDITOR nvim
[MACHINE] set -gx PATH $HOME/.local/bin $HOME/.cargo/bin $PATH
[REPO]    set -gx PATH $HOME/.cargo/bin $PATH
          # Aliases
```

- `[MACHINE]` — this line exists on **this machine** (the home directory)
- `[REPO]`    — this line exists in the **repo** (what `chezmoi apply` would write)
- Unlabeled indented lines are context (same on both sides)

The `=== header ===` includes the direction:
- **REPO_NEWER** — repo was modified more recently
- **MACHINE_NEWER** — this machine was modified more recently
- **SAME_TIME** — both have the same modification time
- **NEW_FILE** — file exists on one side only

Timestamp logic:
- **Repo files**: uses `git log` commit time (stable across checkouts), unless the file has uncommitted local changes, in which case file mtime is used
- **Machine files**: always uses file mtime

Large per-file diffs are truncated at 60 lines with a `TRUNCATED: <n> more line(s) — run rich-diff.sh <path> for the full diff` marker. When you need the full content of one file (e.g. before merging), re-run the script with that path as an argument; `--full` disables truncation entirely.

If there is no drift, the script prints `NO_DRIFT: ...` (it never produces empty output) — tell the user everything is in sync and stop. Exit code `2` means an unknown flag was passed.

### Step 3: Summarize the changes

Present a clear, concise summary of each file that has differences. Group them logically (e.g., fish config, git config, etc.) and for each file explain:
- The **file path** on this machine (e.g., `~/.config/fish/config.fish`)
- A brief description of what changed (e.g., "repo adds a new alias for `ll`", "this machine has a manually-added PATH entry that the repo would remove")
- The **direction** of the change, as reported by the `rich-diff.sh` direction headers:
  - **REPO_NEWER** — you made changes in the repo; default suggestion is **Apply**
  - **MACHINE_NEWER** — you made changes directly on this machine; default suggestion is **Update repo**
  - **SAME_TIME** or **NEW_FILE** — use diff content to judge

Describe both sides factually from the `[MACHINE]`/`[REPO]` labels (e.g. "machine has `X`, repo has `Y`"), and when presenting options, state the concrete effect using actual values from the diff:
- "**Apply** — writes repo content to this machine (replaces `X` with `Y`)"
- "**Update repo** — pulls this machine's content into the repo (keeps `X`)"

Use your judgment about how much detail to show. For small diffs, show them inline. For large diffs, summarize and offer to show details on request.

### Step 4: Walk through each file

For each file with differences, ask the user what they want to do. Present these options clearly:

1. **Apply** (repo → this machine) -- Write the repo version to this machine (run `chezmoi apply <path>` for this file). Use the direction-aware descriptions from Step 3 to explain what this concretely does (e.g., for MACHINE_NEWER, this reverts this machine back to the repo version).

2. **Update repo** (this machine → repo) -- This machine has the version they want to keep. Update the repo to match this machine by running `chezmoi add <path>`, which copies the file from this machine back into the repo. For template files (`.tmpl`), this is more nuanced -- explain that `chezmoi add` will capture the rendered output and they may need to manually update the template. Offer to help edit the template directly.

3. **Merge** -- They want parts of both. Help them edit the repo file to incorporate the desired parts from this machine. Use `chezmoi cat <path>` to see what the repo would render, and read the actual file on this machine to compare. Then edit the repo file together.

4. **Skip** -- Leave this file for later, no action now.

Process files one at a time or in small batches if there are many. Let the user set the pace.

#### Profile-scoped changes

This repo supports multiple profiles (e.g., "personal" and "work") configured via `.chezmoi.toml.tmpl`. Template files (`.tmpl`) can conditionally include content based on `{{ .profile }}`.

When a conflict involves a template file, or when updating the repo / merging changes, always ask the user whether the change should:
- Apply to **all profiles** (add it outside any `{{ if }}` block)
- Apply only to a **specific profile** (wrap it in `{{ if eq .profile "personal" }}` or `{{ if eq .profile "work" }}`)

This is especially important when this machine has changes that were made locally -- those changes may only be relevant to the profile this machine uses. Run `chezmoi data` to check which profile is active so you can give informed suggestions about scoping.

### Step 5: Apply the resolution

After walking through all files, summarize what was decided:
- Files to apply (repo wins — written to this machine)
- Files with repo updated (this machine wins — pulled into repo)
- Files merged (repo edited to incorporate parts from this machine)
- Files skipped

If any files were marked for "apply," remind the user to run `chezmoi apply` (or offer to run it for them). If the repo was updated or files were merged, those changes are already in the repo and the user may want to commit them.

## Important notes

- The repo directory can be found with `chezmoi source-path`
- Edit the file as it exists in this repo (e.g., `private_dot_config/private_fish/config.fish.tmpl`), not the path on this machine.
- When updating a template (`.tmpl`) from a rendered config on this machine, preserve its template expressions rather than overwriting them with rendered values.