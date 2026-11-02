#!/bin/bash
set -euo pipefail

if [ -x /opt/homebrew/bin/brew ]; then
    exit 0
fi

echo "==> Installing Homebrew (and the Xcode Command Line Tools if missing)..."
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
