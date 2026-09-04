#!/usr/bin/bash
# Atomically persist FocusPlease state (bases or births) as a locked, 0600 file
# inside a 0700 directory. Writes are bounded and fail closed on hostile paths.
#
# Usage: write-state.sh <bases|births> <json>
set -euo pipefail

kind="${1:-}"
payload="${2:-}"

case "$kind" in
  bases|births) ;;
  *) exit 0 ;;
esac

# Bound the payload and require a JSON object prefix.
[[ ${#payload} -le 1048576 ]] || exit 0
[[ $payload == \{* ]] || exit 0

state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/omarchy/focusplease"
file="$state_dir/$kind.json"
lock="$state_dir/$kind.lock"

umask 077
/usr/bin/mkdir -p -m 700 "$state_dir"
/usr/bin/chmod 700 "$state_dir"

# Serialize concurrent writers; bounded wait.
exec 9>"$lock"
/usr/bin/flock -w 2 9

# Random, exclusive temp file (mktemp uses O_EXCL); atomic rename replaces the
# destination without following a pre-existing symlink.
tmp=$(/usr/bin/mktemp "$state_dir/$kind.XXXXXX")
/usr/bin/printf '%s' "$payload" >"$tmp"
/usr/bin/chmod 600 "$tmp"
/usr/bin/mv -T "$tmp" "$file"

/usr/bin/flock -u 9
