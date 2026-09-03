#!/bin/bash
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
mkdir -p -m 700 "$state_dir"
chmod 700 "$state_dir"

# Serialize concurrent writers; bounded wait.
exec 9>"$lock"
flock -w 2 9

# Random, exclusive temp file (mktemp uses O_EXCL); atomic rename replaces the
# destination without following a pre-existing symlink.
tmp=$(mktemp "$state_dir/$kind.XXXXXX")
printf '%s' "$payload" >"$tmp"
chmod 600 "$tmp"
mv -T "$tmp" "$file"

flock -u 9
