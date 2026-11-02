#!/bin/bash
set -euo pipefail

FISH=/opt/homebrew/bin/fish

if [ ! -x "$FISH" ]; then
    echo "fish is not installed yet; run chezmoi apply again once it is."
    exit 1
fi

if ! grep -qxF "$FISH" /etc/shells; then
    echo "==> Adding $FISH to /etc/shells..."
    echo "$FISH" | sudo tee -a /etc/shells >/dev/null
fi

if [ "$(dscl . -read "/Users/$USER" UserShell | awk '{print $2}')" != "$FISH" ]; then
    echo "==> Setting fish as the login shell..."
    chsh -s "$FISH"
fi
