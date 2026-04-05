# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

This is a [chezmoi](https://www.chezmoi.io/) dotfiles repository. The **repo** (chezmoi "source state") lives at the repo root and gets applied to **this machine** (chezmoi "target state", i.e. `~/`).

## Key Concepts

- The **repo** holds the declared dotfiles and maps to **this machine** (`~/`) via chezmoi's naming conventions
- Files use special prefixes: `dot_` (→ `.`), `private_` (mode 0600), `executable_` (mode 0755), `readonly_` (mode 0444)
- Directories use: `exact_` (removes extra files on this machine), `private_` prefixes
- Templates end in `.tmpl` and use Go's `text/template` syntax with chezmoi's extra functions
- `run_` prefixed scripts execute during `chezmoi apply` (e.g., `run_once_install-packages.sh`)
- `.chezmoiignore` controls which files are skipped during apply

## Common Commands

```bash
chezmoi add ~/.<file>          # Pull a dotfile from this machine into the repo
chezmoi edit ~/.<file>         # Edit the repo version, then apply
chezmoi diff                   # Preview changes before applying
chezmoi apply                  # Write repo state to this machine
chezmoi apply --dry-run        # Dry run (no changes)
chezmoi cd                     # cd into the repo directory
chezmoi data                   # Show template data (useful for debugging .tmpl files)
chezmoi cat <path>             # Show what the repo would write for a file
chezmoi managed                # List all managed files
```

## Homebrew Package Management

Packages are managed declaratively via `.chezmoidata/packages.yaml`. Structure:

- Three categories: `taps`, `formulae`, `casks`
- Each has `common`, `personal`, and `work` sub-keys — **all sub-keys must exist** (even if empty) or template rendering will fail
- The `run_onchange_install-packages.sh.tmpl` script installs declared packages during `chezmoi apply`
- `.brew-ignored` (gitignored, local-only) lists packages the user doesn't want to manage declaratively — the `/reconcile` skill reads this to skip known-unmanaged packages

## Working With This Repo

- Edit files in the repo, then run `chezmoi apply` to sync them to this machine
- When adding new dotfiles, use chezmoi naming conventions (e.g., `dot_bashrc` for `~/.bashrc`)
- Templates (`.tmpl` files) can use `{{ .chezmoi.os }}`, `{{ .chezmoi.hostname }}`, and custom data from `~/.config/chezmoi/chezmoi.toml`
- Scripts prefixed `run_once_` run only once; `run_onchange_` re-run when their content changes
- Be careful with `exact_` directories — they delete unmanaged files on this machine
- **Never commit sensitive or proprietary files** — this is a public repo. Do not add API keys, tokens, credentials, `.env` files, private keys, or proprietary work configuration. Always review staged changes before committing to ensure no secrets or sensitive data are included. Use encrypted files or templates with secrets sourced from a password manager to keep sensitive values out of the repo.
