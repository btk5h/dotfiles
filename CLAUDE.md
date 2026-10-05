# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A public [chezmoi](https://www.chezmoi.io/) dotfiles repository. The repo root is the chezmoi source state, applied to this machine's home directory (the target state). "Repo" and "this machine" are the names used for the two sides, since "source" and "target" are easy to mix up.

## Layout

- `.chezmoi.toml.tmpl` prompts once for `profile` (`personal` or `work`) and `email`; templates branch on `{{ .profile }}`.
- `.chezmoiscripts/` holds the `run_once_`/`run_onchange_` scripts, including `run_onchange_install-packages.sh.tmpl`, which installs the declared Homebrew packages during `chezmoi apply`.
- `.claude/skills/reconcile/` is the `/reconcile` skill for repo ↔ machine drift in both dotfiles and Homebrew packages.
- `.claude/skills/chezmoi-status/` is a Claude Code plugin that loads in sessions in this repo: a status pane with drift badges, AI diff summaries, a Reconcile wizard built on the reconcile skill's `brew-diff.sh` and `rich-diff.sh`, and Clawd fishing by the pond. Run its tests with `claude plugin test .claude/skills/chezmoi-status`.

## Homebrew Packages

`.chezmoidata/packages.yaml` has `taps`, `formulae`, and `casks`, each split into `common`, `personal`, and `work` lists kept in alphabetical order. Every sub-key must exist, even as `[]`, or template rendering fails.

`.brew-ignored` (gitignored, local-only) lists installed packages the user has chosen not to manage declaratively; `/reconcile` skips them.

## Working With This Repo

Edit the file as it exists in the repo (e.g. `private_dot_config/private_fish/config.fish.tmpl`), not the rendered file on this machine, then `chezmoi apply` to sync. `exact_` directories delete unmanaged files on this machine when applied, so check what's there before applying one.

This repo is public: don't commit API keys, tokens, credentials, `.env` files, private keys, or proprietary work configuration, and review the diff for them before committing. Keep secrets in encrypted files or in templates that read them from a password manager.

The `chezmoi-status` plugin sends the raw `chezmoi diff`, and each drifted file's `rich-diff.sh` output during Reconcile, to the model to summarize them. No template reads a secret today; when one starts to, make the plugin skip or redact that file's diff first, since chezmoi renders the secret into it.
