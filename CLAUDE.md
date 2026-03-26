# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

This is a [chezmoi](https://www.chezmoi.io/) dotfiles repository. The source state lives at the repo root and gets applied to `~/`.

## Key Concepts

- **Source state** lives at the repo root and maps to **target state** (`~/`) via chezmoi's naming conventions
- Files use special prefixes: `dot_` (→ `.`), `private_` (mode 0600), `executable_` (mode 0755), `readonly_` (mode 0444)
- Directories use: `exact_` (removes extra files in target), `private_` prefixes
- Templates end in `.tmpl` and use Go's `text/template` syntax with chezmoi's extra functions
- `run_` prefixed scripts execute during `chezmoi apply` (e.g., `run_once_install-packages.sh`)
- `.chezmoiignore` controls which files are skipped during apply

## Common Commands

```bash
chezmoi add ~/.<file>          # Add a dotfile to source state
chezmoi edit ~/.<file>         # Edit source version, then apply
chezmoi diff                   # Preview changes before applying
chezmoi apply                  # Apply source state to home directory
chezmoi apply --dry-run        # Dry run (no changes)
chezmoi cd                     # cd into the source directory
chezmoi data                   # Show template data (useful for debugging .tmpl files)
chezmoi cat <target>           # Show what chezmoi would write for a target file
chezmoi managed                # List all managed files
```

## Homebrew Package Management

Packages are managed declaratively via `.chezmoidata/packages.yaml`. Structure:

- Three categories: `taps`, `formulae`, `casks`
- Each has `common`, `personal`, and `work` sub-keys — **all sub-keys must exist** (even if empty) or template rendering will fail
- The `run_onchange_install-packages.sh.tmpl` script installs declared packages during `chezmoi apply`
- `.brew-ignored` (gitignored, local-only) lists packages the user doesn't want to manage declaratively — the `/reconcile` skill reads this to skip known-unmanaged packages

## Working With This Repo

- Edit files at the repo root (source state), then run `chezmoi apply` to sync to `~/`
- When adding new dotfiles, use chezmoi naming conventions (e.g., `dot_bashrc` for `~/.bashrc`)
- Templates (`.tmpl` files) can use `{{ .chezmoi.os }}`, `{{ .chezmoi.hostname }}`, and custom data from `~/.config/chezmoi/chezmoi.toml`
- Scripts prefixed `run_once_` run only once; `run_onchange_` re-run when their content changes
- Be careful with `exact_` directories — they delete unmanaged files in the target
- **Never commit sensitive or proprietary files** — this is a public repo. Do not add API keys, tokens, credentials, `.env` files, private keys, or proprietary work configuration. Always review staged changes before committing to ensure no secrets or sensitive data are included. Use encrypted files or templates with secrets sourced from a password manager to keep sensitive values out of the repo.
