#!/usr/bin/env fish

# Read JSON input from stdin
read -lz input

# Extract values from JSON
set -l json_values (echo $input | jq -r '[.workspace.current_dir, .model.display_name, .context_window.used_percentage // ""] | @tsv')
set -l cwd (echo $json_values | cut -f1)
set -l model (echo $json_values | cut -f2)
set -l ctx_pct (echo $json_values | cut -f3)

# Color codes
# tide_git_color_branch: 5FD700 (RGB: 95, 215, 0)
set -l COLOR_BRANCH '\033[38;2;95;215;0m'
set -l COLOR_ANCHOR_BOLD '\033[1;38;2;0;175;255m'
set -l COLOR_DIR '\033[38;2;0;135;175m'
set -l COLOR_RESET '\033[0m'
set -l COLOR_CLAUDE '\033[38;2;217;119;6m'

# Get parent process ID
function get_parent_pid -a pid
    ps -o ppid= -p $pid 2>/dev/null | string trim
end

# Get TTY for a process
function get_tty_for_process -a pid
    set -l tty (ps -o tty= -p $pid 2>/dev/null | string trim)

    # Return failure if tty is empty or invalid
    if test -z "$tty"; or string match -q '?*' $tty
        return 1
    end
    echo $tty
end

# Get width for a TTY device
function get_width_for_tty -a tty
    stty size </dev/$tty 2>/dev/null | string split ' ' | tail -n1
end

# Probe terminal width by walking up parent processes
function probe_terminal_width
    set -l pid %self

    # Walk up to 8 parent processes to find one with a real TTY
    for depth in (seq 8)
        set -l parent_pid (get_parent_pid $pid)
        test -z "$parent_pid"; and break

        set pid $parent_pid
        if set -l tty (get_tty_for_process $pid)
            if set -l width (get_width_for_tty $tty)
                if test "$width" -gt 0
                    echo $width
                    return 0
                end
            end
        end
    end

    # Fallback to tput cols or return 80
    if set -l width (tput cols 2>/dev/null)
        test "$width" -gt 0; and echo $width; or echo 80
    else
        echo 80
    end
end

# Get terminal width using probe (works around Claude Code's piped stdio limitation)
set -l total_cols (probe_terminal_width)

# Calculate max directory width as 60% of terminal width
# This tells tide when to start truncating directories
set -l dist_btwn_sides (math "$total_cols * 60 / 100")

# Get formatted directory path using tide if available, with proper environment
set -l dir ""
if functions -q _tide_pwd
    # Save current directory, switch to target, get formatted path, then switch back
    set -l saved_pwd $PWD
    if cd $cwd 2>/dev/null
        # Set environment variables for tide's truncation logic
        set -gx COLUMNS $total_cols
        set -gx dist_btwn_sides $dist_btwn_sides

        # Get the formatted path from tide
        set dir (_tide_pwd)

        # Ensure output is properly terminated with reset
        set dir "$dir$COLOR_RESET"

        # Restore original directory
        cd $saved_pwd
    end
end

# If tide failed or returned empty, fall back to simple colored path
if test -z "$dir"
    set -l fallback_path (string replace -r "^$HOME" "~" $cwd)
    set dir (printf "%b%s%b" $COLOR_ANCHOR_BOLD $fallback_path $COLOR_RESET)
end

# Get git branch if in a git repository
set -l git_branch ""
if set -l branch (git -C $cwd --no-optional-locks branch --show-current 2>/dev/null; or git -C $cwd --no-optional-locks rev-parse --short HEAD 2>/dev/null)
    if test -n "$branch"
        set -l full_branch $branch
        # Truncate branch name to 24 characters for display only
        if test (string length $branch) -gt 24
            set branch (string sub -l 23 $branch)"…"
        end

        # Check if remote is a GitHub URL and make branch name a clickable link
        set -l remote_url (git -C $cwd --no-optional-locks remote get-url origin 2>/dev/null)
        if string match -q '*github.com*' $remote_url
            set -l github_url (string replace -r '^[^@]+@github\.com:' 'https://github.com/' $remote_url | string replace -r '\.git$' '')
            set git_branch " \033]8;;$github_url/tree/$full_branch\a$COLOR_BRANCH$branch$COLOR_RESET\033]8;;\a"
        else
            set git_branch " $COLOR_BRANCH$branch$COLOR_RESET"
        end
    end
end

# Format model string with Claude Code orange ✻
set -l model_str "$COLOR_CLAUDE✻$COLOR_RESET $model"

# Function to get color for usage percentage
function get_usage_color -a pct
    # Color gradient based on usage level:
    # 0-30%: Green (RGB: 0, 200, 0)
    # 30-50%: Yellow-green transition
    # 50-70%: Yellow to Orange transition
    # 70-90%: Orange to Red transition
    # 90-100%: Red (RGB: 220, 0, 0)

    if test $pct -le 30
        # Green
        echo "0;200;0"
    else if test $pct -le 50
        # Green to Yellow (add red component)
        set -l progress (math -s0 "($pct - 30) * 100 / 20")
        set -l red (math -s0 "$progress * 200 / 100")
        echo "$red;200;0"
    else if test $pct -le 70
        # Yellow to Orange (reduce green)
        set -l progress (math -s0 "($pct - 50) * 100 / 20")
        set -l green (math -s0 "200 - $progress * 50 / 100")
        echo "200;$green;0"
    else if test $pct -le 90
        # Orange to Red (reduce green to 0)
        set -l progress (math -s0 "($pct - 70) * 100 / 20")
        set -l green (math -s0 "150 - $progress * 150 / 100")
        echo "220;$green;0"
    else
        # Red
        echo "220;0;0"
    end
end

# Build context usage string with color-graded progress bar
set -l ctx ""
if test -n "$ctx_pct"
    set -l pct (math -s0 $ctx_pct)

    # Calculate progress across 5 characters using eighths blocks
    # Total eighths: 5 characters × 8 eighths = 40 eighths
    set -l total_eighths 40
    set -l filled_eighths (math -s0 "$pct * $total_eighths / 100")

    # Calculate full blocks and remainder eighths
    set -l full_blocks (math -s0 "$filled_eighths / 8")
    set -l remainder (math -s0 "$filled_eighths % 8")
    set -l empty_blocks (math -s0 "5 - $full_blocks - "(test $remainder -gt 0; and echo 1; or echo 0))

    # Get color for current usage level
    set -l usage_color (get_usage_color $pct)

    # Build progress bar
    # Set both foreground AND background to the same color for solid blocks
    set -l bar (printf '\033[38;2;%s;48;2;%sm' $usage_color $usage_color)

    # Add full blocks
    test $full_blocks -gt 0; and set bar "$bar"(string repeat -n $full_blocks '█')

    # Add partial block (eighths)
    if test $remainder -gt 0
        switch $remainder
            case 1; set bar "$bar▏"
            case 2; set bar "$bar▎"
            case 3; set bar "$bar▍"
            case 4; set bar "$bar▌"
            case 5; set bar "$bar▋"
            case 6; set bar "$bar▊"
            case 7; set bar "$bar▉"
        end
    end

    # Add empty blocks with gray color
    if test $empty_blocks -gt 0
        set bar "$bar"(printf '\033[38;2;80;80;80;48;2;80;80;80m')(string repeat -n $empty_blocks '░')
    end

    set -a bar (printf '\033[0m')  # Reset colors

    set ctx "   ⛁ $pct% $bar"
end

# Output final status line: line 1 = model + context, line 2 = directory + branch
printf "%b\n%b" $model_str$ctx $dir$git_branch
