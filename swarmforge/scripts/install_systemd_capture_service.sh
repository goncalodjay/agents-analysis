#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
unit_template="$root/swarmforge/systemd/agents-analysis-capture.service"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unit_file="$unit_dir/agents-analysis-capture.service"
binary=${AGENTS_ANALYSIS_BINARY:-$(command -v agents-analysis)}

if [ -z "$binary" ]; then
  printf '%s\n' 'agents-analysis binary not found in PATH' >&2
  exit 1
fi

mkdir -p "$unit_dir"
sed "s|@BINARY@|$binary|g" "$unit_template" > "$unit_file"
systemctl --user daemon-reload
systemctl --user enable --now agents-analysis-capture.service
