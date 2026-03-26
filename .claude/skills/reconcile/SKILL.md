---
name: reconcile
description: Reconcile differences between chezmoi source state and target state (home directory). Use this skill when the user wants to review pending dotfile changes, sync their chezmoi source with what's actually in their home directory, resolve drift between managed files, or decide file-by-file whether to apply or pull back changes. Trigger on phrases like "reconcile", "sync dotfiles", "chezmoi diff", "what changed in my dotfiles", "dotfile drift", or any mention of source vs target state differences.
---

# Reconcile

Guide the user through reconciling differences between their chezmoi source state (this repo) and their target state (`~/`).

## Workflow

### Step 1: Discover differences

Run `chezmoi diff --no-pager` to see all pending changes. This shows what `chezmoi apply` would do -- i.e., what the source state wants to write to the target.

The diff output uses unified diff format:
- Lines prefixed with `-` show what's currently in the **target** (home directory)
- Lines prefixed with `+` show what the **source** (this repo) wants to write

If there are no differences, tell the user everything is in sync and stop.

### Step 2: Summarize the changes

Present a clear, concise summary of each file that has differences. Group them logically (e.g., fish config, git config, etc.) and for each file explain:
- The **target path** (e.g., `~/.config/fish/config.fish`)
- A brief description of what changed (e.g., "source adds a new alias for `ll`", "target has a manually-added PATH entry that source would remove")
- The **direction** of the change: is the source ahead (you made changes in the repo), or is the target ahead (you made changes directly in `~/`)

Use your judgment about how much detail to show. For small diffs, show them inline. For large diffs, summarize and offer to show details on request.

### Step 3: Walk through each file

For each file with differences, ask the user what they want to do. Present these options clearly:

1. **Apply** -- Write the source state to the target (this is what `chezmoi apply` would do for this file). No action needed now; it will happen when they run `chezmoi apply`.

2. **Pull back** -- The target has the version they want to keep. Update the source state to match the target by running `chezmoi add <target-path>`, which copies the target file back into the source state. For template files (`.tmpl`), this is more nuanced -- explain that `chezmoi add` will capture the rendered output and they may need to manually update the template. Offer to help edit the template directly.

3. **Merge** -- They want parts of both. Help them edit the source file in this repo to incorporate the desired parts from the target. Use `chezmoi cat <target-path>` to see what the source would render, and read the actual target file to compare. Then edit the source file together.

4. **Skip** -- Leave this file for later, no action now.

Process files one at a time or in small batches if there are many. Let the user set the pace.

#### Profile-scoped changes

This repo supports multiple profiles (e.g., "personal" and "work") configured via `.chezmoi.toml.tmpl`. Template files (`.tmpl`) can conditionally include content based on `{{ .profile }}`.

When a conflict involves a template file, or when pulling back / merging changes, always ask the user whether the change should:
- Apply to **all profiles** (add it outside any `{{ if }}` block)
- Apply only to a **specific profile** (wrap it in `{{ if eq .profile "personal" }}` or `{{ if eq .profile "work" }}`)

This is especially important when the target has changes that were made on a specific machine -- those changes may only be relevant to the profile that machine uses. Run `chezmoi data` to check which profile is active on the current machine so you can give informed suggestions about scoping.

### Step 4: Apply the resolution

After walking through all files, summarize what was decided:
- Files to apply (source wins)
- Files pulled back (target wins, source updated)
- Files merged (source edited)
- Files skipped

If any files were marked for "apply," remind the user to run `chezmoi apply` (or offer to run it for them). If files were pulled back or merged, those changes are already in the source state and the user may want to commit them.

## Important notes

- The chezmoi source directory is `/Users/bryan/.local/share/chezmoi` (this repo)
- Source files use chezmoi naming conventions: `dot_` prefix becomes `.`, `private_` sets permissions, `exact_` removes unmanaged files, `.tmpl` suffix means it's a Go template
- When editing source files, respect the chezmoi naming conventions. Edit the file as it exists in this repo (e.g., `private_dot_config/private_fish/config.fish.tmpl`), not the target path.
- Template files (`.tmpl`) may contain Go template directives. When merging or pulling back, be careful not to break template syntax. If the user wants to pull back a rendered config into a template, help them preserve template expressions where appropriate.
- Use `chezmoi data` if you need to see what template variables are available for debugging templates.