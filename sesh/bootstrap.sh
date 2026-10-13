#!/bin/sh
set -eu
: "${PI_SESH_SESSION_ID:?pi-sesh container identity is required}"
: "${HOME:?Container HOME is required}"
agent="$HOME/.pi/agent"
[ -f "$agent/settings.json" ] || { printf 'Staged Pi settings are missing\n' >&2; exit 1; }
mkdir -p /home/session/output/sessions /home/session/output/analytics
ln -s /home/session/output/analytics "$agent/analytics"
export PI_CODING_AGENT_DIR="$agent"
if [ "${PI_SESH_NETWORK:-none}" = none ]; then
  export PI_OFFLINE=1
fi
export PATH="/home/session/runtime/pi:$PATH"
exec /home/session/runtime/pi/pi "$@"
