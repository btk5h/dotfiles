#!/bin/bash

if command -v proto &>/dev/null || [ -x "$HOME/.proto/bin/proto" ]; then
    echo "proto is already installed, skipping."
    exit 0
fi

echo "Installing proto..."
curl -fsSL https://moonrepo.dev/install/proto.sh | bash -s -- --yes --no-profile
