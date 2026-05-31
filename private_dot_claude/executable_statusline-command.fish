#!/usr/bin/env fish

# Read JSON input from stdin
read -lz input

# Extract values from JSON
set -l json_values (echo $input | jq -r '[.workspace.current_dir, .model.display_name, .context_window.used_percentage // "", .rate_limits.five_hour.used_percentage // "", (.cost.total_cost_usd // 0 | tostring)] | @tsv')
set -l cwd (echo $json_values | cut -f1)
set -l model (echo $json_values | cut -f2)
set -l ctx_pct (echo $json_values | cut -f3)
set -l quota_pct (echo $json_values | cut -f4)
set -l session_cost (echo $json_values | cut -f5)

# Color codes
# tide_git_color_branch: 5FD700 (RGB: 95, 215, 0)
set -l COLOR_BRANCH '\033[38;2;95;215;0m'
set -l COLOR_ANCHOR_BOLD '\033[1;38;2;0;175;255m'
set -l COLOR_DIR '\033[38;2;0;135;175m'
set -l COLOR_RESET '\033[0m'
set -l COLOR_CLAUDE '\033[38;2;217;119;6m'

# JJ colors matching tide's _tide_item_vcs (tide_jj_bg_color = normal)
set -l JJ_COLOR '\033[38;2;95;215;0m'  # tide_jj_color 5FD700 — parens
set -l AT_COLOR '\033[32m'              # green — @ symbol
set -l BOLD '\033[1m'                   # bold on
set -l CID_COLOR '\033[95m'            # brmagenta — change_id and bookmarks
set -l COMMIT_COLOR '\033[94m'         # brblue — commit_id
set -l DIRTY_COLOR '\033[33m'          # yellow — dirty *
set -l CLEAN_COLOR '\033[92m'          # brgreen — (empty) / clean
set -l ARROW_COLOR '\033[90m'          # brblack — ahead/behind arrows
set -l FG_RESET '\033[39m'             # foreground-only reset (preserves bold)

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

# Get VCS info — tide-style jj format if in a jj repo, else git fallback
set -l git_branch ""

# Find jj repo root by walking up from $cwd looking for a .jj directory.
# This works regardless of whether $cwd is the root or a subdirectory, and avoids
# spawning a subprocess just for detection.
set -l jj_root ""
set -l _search $cwd
while test -n "$_search"
    if test -d "$_search/.jj"
        set jj_root $_search
        break
    end
    set -l _parent (string replace -r '/[^/]+$' '' $_search)
    test "$_parent" = "$_search"; and break
    set _search $_parent
end
if test -n "$jj_root"
    # Optimization: single jj log call covers @, ahead count, behind count, and
    # ancestor-bookmark lines — replacing 4 separate calls with 1.
    #
    # Revset: @ | trunk()..@ | trunk()..@ ~ @
    #   simplifies to: trunk()..@ | @
    #   which is just:  trunk()..@ (since @ is always in trunk()..@ unless @ IS trunk())
    #   so use:         @ | trunk()..@
    #
    # Template encodes each rev's role:
    #   @ line  → "AT\t<change_id>\t<bookmarks>\t<commit_id>\t<status>\t<desc>"
    #   other   → "ANC\t<change_id>\t<bookmarks>\t.\t.\t."  (only if has bookmarks)
    #   all     → also emit a "CNT\t.\n" for counting ahead
    #
    # We split the output afterwards in pure fish (no extra subprocesses).
    # Every commit emits a ROW line; @ gets "AT" tag, ancestors with bookmarks get "ANC" tag.
    # Format: "<tag>\t<change_id>\t<extra...>\n"
    # ROW lines (all): "ROW\t<change_id>\n"   — used for counting + depth calculation
    # AT  lines (@):   "AT\t<cid>\t<bms>\t<commit_id>\t<status>\t<desc>"
    # ANC lines (anc with bookmarks): "ANC\t<cid>\t<bms>"
    # A commit may emit both a ROW line and an AT/ANC line (template emits both for @/ancestors).
    set -l combined_tmpl '"ROW\t" ++ change_id.shortest() ++ "\n" ++ if(current_working_copy, "AT\t" ++ change_id.shortest() ++ "\t" ++ coalesce(if(local_bookmarks, local_bookmarks.join(",")), ".") ++ "\t" ++ commit_id.shortest() ++ "\t" ++ coalesce(if(empty, "(empty)"), "*") ++ "\t" ++ if(description, description.first_line(), "(no desc)") ++ "\n") ++ if(!current_working_copy, if(local_bookmarks, "ANC\t" ++ change_id.shortest() ++ "\t" ++ local_bookmarks.join(",") ++ "\n"))'

    # Call 1 of 2: combined query for @-info + ancestor bookmarks + ahead/depth data.
    # --ignore-working-copy is intentionally NOT used here so the dirty flag is fresh.
    set -l combined_out (jj -R $jj_root log -r '@ | trunk()..@' --no-graph --color=never -T $combined_tmpl 2>/dev/null)

    # Call 2 of 2: behind count — commits on trunk() not yet in @'s ancestry.
    # Uses --ignore-working-copy since we only need revision graph data.
    set -l behind (jj -R $jj_root log -r '@..trunk()' --no-graph --ignore-working-copy --color=never -T '".\n"' 2>/dev/null | wc -l | string trim)

    # Parse combined output into: raw (@ fields), anc_bm_lines, ordered_cids (for depth), ahead count
    set -l raw ""
    set -l anc_bm_lines
    set -l ordered_cids  # ROW order: first = nearest to trunk, last = @
    set -l ahead 0
    set -l TAB (printf "\t")

    for line in $combined_out
        test -z "$line"; and continue
        # Use real tab in glob prefix matching (fish \t in double-quotes is literal backslash-t)
        if string match -q "ROW$TAB*" -- $line
            set -l row_cid (string sub -s 5 -- $line | string trim)
            set -a ordered_cids $row_cid
            set ahead (math $ahead + 1)
        else if string match -q "AT$TAB*" -- $line
            set raw (string sub -s 4 -- $line)
        else if string match -q "ANC$TAB*" -- $line
            set -a anc_bm_lines (string sub -s 5 -- $line)
        end
    end

    # ahead = total ROW lines = commits in trunk()..@ (@ is always within that range)

    # Ancestor bookmark depth: count hops from each ancestor to @ using ordered_cids.
    # ordered_cids is already populated by the parse loop above (ROW lines, trunk-first order).
    set -l display_bookmarks
    for anc_line in $anc_bm_lines
        test -z "$anc_line"; and continue
        set -l ap (string split \t -- $anc_line)
        test (count $ap) -lt 2; and continue
        set -l anc_cid $ap[1]

        # Count how many steps from this ancestor up to @ in the ordered list
        set -l depth 0
        set -l counting 0
        for oc in $ordered_cids
            if test "$oc" = $anc_cid
                set counting 1
            else if test $counting -eq 1
                set depth (math $depth + 1)
            end
        end

        for bm in (string split ',' -- $ap[2])
            set bm (string trim -- $bm)
            test -n "$bm"; and set -a display_bookmarks "\033[35m$bm\033[22m\033[35m↑$depth\033[39m"
        end
    end

    if test -n "$raw"
        set -l parts (string split (printf "\t") -- $raw)

        if test (count $parts) -ge 4
            set -l cid $parts[1]
            set -l bookmarks $parts[2]
            set -l commit_id $parts[3]
            set -l jj_st $parts[4]
            set -l desc ""
            test (count $parts) -ge 5; and set desc $parts[5]

            # Status color: yellow for dirty *, brgreen for empty/clean
            set -l st_color $DIRTY_COLOR
            test "$jj_st" != "*"; and set st_color $CLEAN_COLOR

            # Description: truncate to match tide's _tide_item_vcs (tide_jj_description_length,
            # default 24; tide_jj_show_description, default true). Placeholder colored like
            # status, real desc plain.
            set -l show_desc true
            set -q tide_jj_show_description; and set show_desc $tide_jj_show_description
            set -l desc_length 24
            set -q tide_jj_description_length; and set desc_length $tide_jj_description_length
            set -l desc_label ""
            if test -n "$desc"; and test "$show_desc" = true
                if test "$desc" = "(no desc)"
                    set desc_label " $st_color$desc$FG_RESET"
                else
                    if test $desc_length -gt 0; and test (string length -- $desc) -gt $desc_length
                        set desc (string sub -l $desc_length -- $desc)"…"
                    end
                    set desc_label " $desc"
                end
            end

            # Ancestor bookmark labels (magenta, matching tide's display_bookmarks)
            set -l anc_bm_label ""
            test (count $display_bookmarks) -gt 0; and set anc_bm_label " "(string join ' ' $display_bookmarks)

            # Ahead/behind arrows: non-bold gray matching tide
            set -l arrows ""
            test "$ahead" -gt 0 2>/dev/null; and set arrows "$arrows \033[22m$ARROW_COLOR↑$ahead$FG_RESET"
            test "$behind" -gt 0 2>/dev/null; and set arrows "$arrows \033[22m$ARROW_COLOR↓$behind$FG_RESET"

            # Format bookmarks with optional GitHub hyperlink
            set -l bm_str ""
            if test "$bookmarks" != "."
                # Prefer jj's remote list; fall back to git only if jj returns nothing.
                # Both use --ignore-working-copy / --no-optional-locks to avoid any snapshot.
                set -l remote_url (jj -R $jj_root git remote list --ignore-working-copy 2>/dev/null | head -1 | string replace -r '^[^\t]+\t' '')
                test -z "$remote_url"; and set remote_url (git -C $jj_root --no-optional-locks remote get-url origin 2>/dev/null)

                set -l first_bm (string split ',' -- $bookmarks)[1]
                set first_bm (string trim -- $first_bm)
                set -l display_bm $first_bm
                test (string length $first_bm) -gt 24; and set display_bm (string sub -l 23 $first_bm)"…"

                if string match -q '*github.com*' $remote_url
                    set -l github_url (string replace -r '^[^@]+@github\.com:' 'https://github.com/' $remote_url | string replace -r '\.git$' '')
                    set bm_str " \033]8;;$github_url/tree/$first_bm\a$CID_COLOR$display_bm$FG_RESET\033]8;;\a"
                else
                    set bm_str " $CID_COLOR$display_bm$FG_RESET"
                end
            end

            # Tide format: (@ cid [at-bookmarks] commit_id status [desc] [ancestor-bms] [↑ahead] [↓behind])
            set git_branch " $FG_RESET$JJ_COLOR($FG_RESET$BOLD$AT_COLOR@$FG_RESET $CID_COLOR$cid$FG_RESET$bm_str $COMMIT_COLOR$commit_id$FG_RESET $st_color$jj_st$FG_RESET$desc_label$anc_bm_label$arrows$COLOR_RESET$JJ_COLOR)$COLOR_RESET"
        end
    end
else
    # Fall back to git
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
end

# Format model string with Claude Code orange ✻
set -l model_str "$COLOR_CLAUDE✻$COLOR_RESET $model"

# Format session cost string
set -l cost_str ""
if test -n "$session_cost"; and test "$session_cost" != "0"
    set -l formatted_cost (printf '$%.2f' $session_cost)
    set cost_str "   \033[38;2;218;165;32m$formatted_cost\033[0m"
end

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

    # Add partial block (eighths): fg = usage color, bg = empty-track gray so the eighths glyph is visible
    if test $remainder -gt 0
        set bar "$bar"(printf '\033[38;2;%s;48;2;80;80;80m' $usage_color)
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

    set bar "$bar"(printf '\033[0m')  # Reset colors (concat, not list-append, to avoid stray joining space)

    set ctx "  \uf472 $pct% $bar"
end

# Build quota usage string with golden progress bar (no gradient)
set -l quota ""
if test -n "$quota_pct"
    set -l pct (math -s0 $quota_pct)

    # Golden color: RGB(218, 165, 32)
    set -l GOLD "218;165;32"

    # Calculate progress across 5 characters using eighths blocks
    # Total eighths: 5 characters × 8 eighths = 40 eighths
    set -l total_eighths 40
    set -l filled_eighths (math -s0 "$pct * $total_eighths / 100")

    # Calculate full blocks and remainder eighths
    set -l full_blocks (math -s0 "$filled_eighths / 8")
    set -l remainder (math -s0 "$filled_eighths % 8")
    set -l empty_blocks (math -s0 "5 - $full_blocks - "(test $remainder -gt 0; and echo 1; or echo 0))

    # Build progress bar with solid golden color
    set -l bar (printf '\033[38;2;%s;48;2;%sm' $GOLD $GOLD)

    # Add full blocks
    test $full_blocks -gt 0; and set bar "$bar"(string repeat -n $full_blocks '█')

    # Add partial block: fg = gold, bg = empty-track gray
    if test $remainder -gt 0
        set bar "$bar"(printf '\033[38;2;%s;48;2;80;80;80m' $GOLD)
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

    set bar "$bar"(printf '\033[0m')

    set quota "  \uf4de $pct% $bar"
end

# Output final status line: line 1 = model + context + cost, line 2 = directory + branch
printf "%b\n%b" $model_str$ctx$quota$cost_str $dir$git_branch
