#!/usr/bin/env bash
# Control script for the Loopbreaker Herdr plugin (the delivery-gate visualizer service).
# Invoked by the plugin's actions and usable directly. The visualizer runs as a systemd --user
# service (NOT a Herdr plugin pane) so it survives Herdr restarts and is supervised independently.
# Modeled on Collie's collie-ctl.sh; adapted for loopbreaker (Node + pnpm, `loopbreaker serve`).
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT="loopbreaker"
UNIT_FILE="${HOME}/.config/systemd/user/${UNIT}.service"
PLUGIN_ID="herdr.loopbreaker"

# Resolve the plugin config dir (where .env lives) the same way regardless of entry point.
# Herdr injects HERDR_PLUGIN_CONFIG_DIR for its actions; a direct call doesn't get it, so we
# ask Herdr (`herdr plugin config-dir`), then fall back to the conventional path, then ~/.config.
resolve_config_dir() {
  if [ -n "${HERDR_PLUGIN_CONFIG_DIR:-}" ]; then echo "$HERDR_PLUGIN_CONFIG_DIR"; return; fi
  if command -v herdr >/dev/null; then
    local d; d="$(herdr plugin config-dir "$PLUGIN_ID" 2>/dev/null || true)"
    if [ -n "$d" ]; then echo "$d"; return; fi
  fi
  local conventional="${HOME}/.config/herdr/plugins/config/${PLUGIN_ID}"
  if [ -f "${conventional}/.env" ]; then echo "$conventional"; return; fi
  echo "${HOME}/.config/loopbreaker"
}
CONFIG_DIR="$(resolve_config_dir)"

# Source the plugin .env so this script and the systemd unit share one config source.
if [ -f "${CONFIG_DIR}/.env" ]; then set -a; . "${CONFIG_DIR}/.env"; set +a; fi

PORT="${LOOPBREAKER_PORT:-7331}"
SOCKET="${HERDR_SOCKET_PATH:-${HOME}/.config/herdr/herdr.sock}"
# The one database this host-global service serves. Loopbreaker's DB is per-repo, so point this
# at whichever repo's .loopbreaker/loopbreaker.db you want the herd to watch. Multi-DB serving is
# a tracked follow-up (docs/backlog/rordi-parity.md).
LOOPBREAKER_DB="${LOOPBREAKER_DB:-${HOME}/.config/loopbreaker/loopbreaker.db}"
# How tailscale serve exposes the visualizer: "https" (default) or "http" (Headscale/.internal).
SERVE_MODE="${LOOPBREAKER_SERVE_MODE:-https}"
NODE="$(command -v node || true)"
PNPM="$(command -v pnpm || true)"
WEB_DIST="${PLUGIN_ROOT}/web-dist/index.html"

have_systemd() { command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; }

# Build the CLI + web visualizer + bundles (pnpm build → dist/, web-dist/, mcp/). The server
# serves web-dist/; without it the API runs but the UI 503s. Safe to call repeatedly.
cmd_build() {
  [ -n "$PNPM" ] || { echo "error: pnpm not found on PATH" >&2; exit 1; }
  ( cd "${PLUGIN_ROOT}" && "$PNPM" install --frozen-lockfile && "$PNPM" build )
}

ensure_build() {
  [ -f "$WEB_DIST" ] && [ -f "${PLUGIN_ROOT}/dist/cli.js" ] && return 0
  [ -n "$PNPM" ] || { echo "note: pnpm not found; cannot build" >&2; return 1; }
  echo "building loopbreaker (first run)…"
  cmd_build || { echo "warn: build failed; visualizer will 503 until built" >&2; return 1; }
}

ensure_db() {
  [ -f "$LOOPBREAKER_DB" ] && return 0
  echo "note: no database at ${LOOPBREAKER_DB} — creating an empty one (loopbreaker init)."
  mkdir -p "$(dirname "$LOOPBREAKER_DB")"
  ( cd "${PLUGIN_ROOT}" && LOOPBREAKER_DB="$LOOPBREAKER_DB" "$NODE" dist/cli.js init --db "$LOOPBREAKER_DB" >/dev/null )
}

self_dnsname() {
  tailscale status --json 2>/dev/null | node -e \
    "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d).Self.DNSName.replace(/\.\$/,''))}catch{}})"
}

visualizer_url() {
  local name; name="$(self_dnsname)"
  if [ -z "$name" ]; then echo "http://127.0.0.1:${PORT} (Tailscale name unavailable)"; return; fi
  if [ "$SERVE_MODE" = "http" ]; then echo "http://${name}:${PORT}"; else echo "https://${name}"; fi
}

bridge_ready() {
  local i
  for i in $(seq 1 25); do
    if (exec 3<>"/dev/tcp/127.0.0.1/${PORT}" && exec 3>&- 3<&-) 2>/dev/null; then return 0; fi
    sleep 0.2
  done
  return 1
}

print_status_banner() {
  local svc
  if have_systemd; then
    svc="systemd --user (${UNIT}) · $(systemctl --user is-active "$UNIT" 2>/dev/null || echo unknown)"
  elif [ -f "${CONFIG_DIR}/loopbreaker.pid" ]; then
    svc="pid $(cat "${CONFIG_DIR}/loopbreaker.pid" 2>/dev/null) (no systemd)"
  else
    svc="not supervised"
  fi
  echo
  if bridge_ready; then
    echo "  ✓ Loopbreaker visualizer is running"
  else
    echo "  ⚠ Visualizer isn't answering on :${PORT} yet — check 'loopbreaker-ctl.sh logs'"
  fi
  echo "    service   ${svc}"
  echo "    database  ${LOOPBREAKER_DB}"
  echo "    local     http://127.0.0.1:${PORT}"
  echo "    tailnet   $(visualizer_url)"
  echo
}

write_unit() {
  [ -n "$NODE" ] || { echo "error: node not found on PATH" >&2; exit 1; }
  mkdir -p "$(dirname "$UNIT_FILE")" "$CONFIG_DIR"
  cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Loopbreaker delivery visualizer
After=default.target
StartLimitIntervalSec=0

[Service]
Type=simple
WorkingDirectory=${PLUGIN_ROOT}
ExecStart=${NODE} ${PLUGIN_ROOT}/dist/cli.js serve --port ${PORT}
Restart=on-failure
RestartSec=5
NoNewPrivileges=yes
PrivateTmp=yes
Environment=HERDR_SOCKET_PATH=${SOCKET}
Environment=LOOPBREAKER_PORT=${PORT}
Environment=LOOPBREAKER_DB=${LOOPBREAKER_DB}
Environment=HERDR_PLUGIN_CONFIG_DIR=${CONFIG_DIR}
EnvironmentFile=-${CONFIG_DIR}/.env

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
}

cmd_start() {
  ensure_build || true
  ensure_db
  if have_systemd; then
    write_unit
    systemctl --user enable --now "$UNIT"
    echo "visualizer started (systemd --user: ${UNIT})"
  else
    mkdir -p "$CONFIG_DIR"
    [ -n "$NODE" ] || { echo "error: node not found" >&2; exit 1; }
    HERDR_SOCKET_PATH="$SOCKET" LOOPBREAKER_PORT="$PORT" LOOPBREAKER_DB="$LOOPBREAKER_DB" \
      HERDR_PLUGIN_CONFIG_DIR="$CONFIG_DIR" \
      nohup "$NODE" "${PLUGIN_ROOT}/dist/cli.js" serve --port "$PORT" >>"${CONFIG_DIR}/loopbreaker.log" 2>&1 &
    echo $! > "${CONFIG_DIR}/loopbreaker.pid"
    echo "visualizer started (pid $(cat "${CONFIG_DIR}/loopbreaker.pid"), no systemd)"
  fi
  cmd_serve
  print_status_banner
}

cmd_stop() {
  if have_systemd; then
    systemctl --user disable --now "$UNIT" 2>/dev/null || true
  elif [ -f "${CONFIG_DIR}/loopbreaker.pid" ]; then
    kill "$(cat "${CONFIG_DIR}/loopbreaker.pid")" 2>/dev/null || true
    rm -f "${CONFIG_DIR}/loopbreaker.pid"
  fi
  echo "visualizer stopped"
}

cmd_restart() { cmd_stop; cmd_start; }

cmd_uninstall() {
  cmd_stop
  cmd_unserve
  if have_systemd; then
    rm -f "$UNIT_FILE"
    systemctl --user daemon-reload 2>/dev/null || true
    systemctl --user reset-failed "$UNIT" 2>/dev/null || true
  fi
  rm -f "${CONFIG_DIR}/loopbreaker.pid"
  echo "✓ uninstalled: service stopped & disabled, systemd unit removed, tailscale serve mapping removed"
  echo "  kept: ${CONFIG_DIR}/.env and the checkout — delete those to remove every trace"
}

cmd_update() {
  echo "updating Loopbreaker (git pull --ff-only)…"
  git -C "$PLUGIN_ROOT" pull --ff-only
  exec bash "${PLUGIN_ROOT}/scripts/loopbreaker-ctl.sh" _apply-update
}

refresh_registry() {
  command -v herdr >/dev/null || return 0
  if herdr plugin link "$PLUGIN_ROOT" >/dev/null 2>&1; then
    echo "herdr registry refreshed (re-linked)"
  else
    echo "note: couldn't refresh the Herdr registry — run: herdr plugin link \"$PLUGIN_ROOT\""
  fi
}

cmd_apply_update() {
  cmd_build
  cmd_restart
  refresh_registry
  echo "✓ update complete"
}

cmd_serve() {
  if [ "${LOOPBREAKER_SKIP_SERVE:-}" = "1" ]; then
    echo "tailscale serve skipped (LOOPBREAKER_SKIP_SERVE=1) — visualizer is on 127.0.0.1:${PORT} only"
    return
  fi
  command -v tailscale >/dev/null || { echo "note: tailscale not found; visualizer is on 127.0.0.1:${PORT} only"; return; }
  local out="${CONFIG_DIR}/serve.out"
  if [ "$SERVE_MODE" = "http" ]; then
    if tailscale serve --bg --http="$PORT" "$PORT" >"$out" 2>&1; then
      echo "tailscale serve (http) → tailnet :${PORT} -> 127.0.0.1:${PORT}"
    else
      echo "note: tailscale serve failed (try 'sudo tailscale set --operator=\$USER'):"; cat "$out"
    fi
  else
    if tailscale serve --bg "$PORT" >"$out" 2>&1; then
      echo "tailscale serve (https) → tailnet :443 -> 127.0.0.1:${PORT}"
    else
      echo "note: tailscale serve (https) failed — on Headscale/.internal use LOOPBREAKER_SERVE_MODE=http:"; cat "$out"
    fi
  fi
}

cmd_unserve() {
  command -v tailscale >/dev/null || { echo "note: tailscale not found; no serve mapping to remove"; return; }
  if [ "$SERVE_MODE" = "http" ]; then
    tailscale serve --http="$PORT" off >/dev/null 2>&1 || true
    echo "tailscale serve: removed http :${PORT} mapping"
  else
    tailscale serve --https=443 off >/dev/null 2>&1 || true
    echo "tailscale serve: removed https :443 mapping"
  fi
}

cmd_status() {
  print_status_banner
  if [ "${LOOPBREAKER_SKIP_SERVE:-}" = "1" ]; then
    echo "  serve config: skipped (LOOPBREAKER_SKIP_SERVE=1)"
  else
    echo "  serve config:"; tailscale serve status 2>/dev/null | sed 's/^/    /' || true
  fi
}

cmd_logs() {
  if have_systemd; then journalctl --user -u "$UNIT" -n "${1:-50}" --no-pager
  else tail -n "${1:-50}" "${CONFIG_DIR}/loopbreaker.log" 2>/dev/null || echo "(no log)"; fi
}

# Read-only substrate readout for a Herdr popup pane: the active issue's prime block if one is
# linked, otherwise the all-issues dashboard. Holds the pane open until the operator dismisses it.
cmd_substrate() {
  [ -n "$NODE" ] || { echo "error: node not found on PATH" >&2; exit 1; }
  local active
  active="$( ( cd "${PLUGIN_ROOT}" && LOOPBREAKER_DB="$LOOPBREAKER_DB" "$NODE" dist/cli.js link --show --db "$LOOPBREAKER_DB" 2>/dev/null ) || true )"
  if echo "$active" | grep -q 'active_issue'; then
    ( cd "${PLUGIN_ROOT}" && LOOPBREAKER_DB="$LOOPBREAKER_DB" "$NODE" dist/cli.js prime --db "$LOOPBREAKER_DB" ) || true
  else
    ( cd "${PLUGIN_ROOT}" && LOOPBREAKER_DB="$LOOPBREAKER_DB" "$NODE" dist/cli.js --db "$LOOPBREAKER_DB" ) || true
  fi
  echo; read -rp "press enter to close…" _ || true
}

case "${1:-}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_restart ;;
  uninstall) cmd_uninstall ;;
  update)  cmd_update ;;
  _apply-update) cmd_apply_update ;;  # internal: second half of `update`, run post-pull
  build)   cmd_build ;;
  serve)   cmd_serve; echo "open: $(visualizer_url)" ;;
  unserve) cmd_unserve ;;
  status)  cmd_status ;;
  url)     visualizer_url ;;
  substrate) cmd_substrate ;;
  logs)    cmd_logs "${2:-50}" ;;
  *) echo "usage: loopbreaker-ctl.sh {start|stop|restart|uninstall|update|build|serve|unserve|status|url|substrate|logs}" >&2; exit 2 ;;
esac
