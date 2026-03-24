eval (/opt/homebrew/bin/brew shellenv)

fish_add_path "$HOME/.local/bin"

# Proto toolchain manager
set -gx PROTO_HOME "$HOME/.proto"
fish_add_path "$PROTO_HOME/shims"
fish_add_path "$PROTO_HOME/bin"
