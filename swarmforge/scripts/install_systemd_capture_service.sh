#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
unit_template="$root/swarmforge/systemd/agents-analysis-capture.service"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unit_file="$unit_dir/agents-analysis-capture.service"
binary=${AGENTS_ANALYSIS_BINARY:-}
systemctl_command=${SYSTEMCTL:-systemctl}

if [ -z "$binary" ]; then
  binary=$(command -v agents-analysis || true)
fi
if [ -z "$binary" ]; then
  printf '%s\n' 'agents-analysis binary not found in PATH' >&2
  exit 1
fi

mkdir -p "$unit_dir"
escaped_binary=$(printf '%s' "$binary" | sed 's/[\\&|]/\\&/g')
sed "s|@BINARY@|$escaped_binary|g" "$unit_template" > "$unit_file"
"$systemctl_command" --user daemon-reload
"$systemctl_command" --user enable --now agents-analysis-capture.service
