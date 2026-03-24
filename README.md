# dotfiles

Personal dotfiles managed with [chezmoi](https://www.chezmoi.io/), shared across personal and work machines.

## Setup

```bash
# Install chezmoi and apply dotfiles
chezmoi init --apply <repo-url>
```

## Usage

```bash
chezmoi add ~/.<file>    # Track a new dotfile
chezmoi diff             # Preview pending changes
chezmoi apply            # Apply changes to home directory
```

## Automation

Configuration management is assisted by [Claude Code](https://claude.ai/code), which helps maintain and evolve dotfiles across machines.