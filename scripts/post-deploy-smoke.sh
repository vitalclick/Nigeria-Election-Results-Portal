#!/usr/bin/env bash
# OpenBallot Nigeria - post-deploy smoke tests
#
# Runs the eight checks documented in docs/DEPLOYMENT_INFO.md against a
# running deployment. Exits non-zero on the first failure so this can be
# wired into a deploy pipeline as a release gate.
#
# Usage:
#   WEB_BASE=https://openballot.ng API_BASE=https://api.openballot.ng ./scripts/post-deploy-smoke.sh
#
# Defaults assume local docker-compose stack.

set -euo pipefail

WEB_BASE="${WEB_BASE:-http://localhost:3000}"
API_BASE="${API_BASE:-http://localhost:8000}"
ELECTION_ID="${ELECTION_ID:-2023-presidential}"
TIMEOUT="${TIMEOUT:-10}"

PASS=0
FAIL=0
FAILED_CHECKS=()

# ─── helpers ────────────────────────────────────────────────────────────────

c_red() { printf '\033[31m%s\033[0m' "$1"; }
c_grn() { printf '\033[32m%s\033[0m' "$1"; }
c_yel() { printf '\033[33m%s\033[0m' "$1"; }
c_bld() { printf '\033[1m%s\033[0m' "$1"; }

ok()   { printf "  %s  %s\n" "$(c_grn '✓')" "$1"; PASS=$((PASS + 1)); }
fail() { printf "  %s  %s\n" "$(c_red '✗')" "$1"; FAIL=$((FAIL + 1)); FAILED_CHECKS+=("$1"); }
skip() { printf "  %s  %s\n" "$(c_yel '·')" "$1"; }

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    printf "%s\n" "$(c_red 'jq is required - install with: sudo apt-get install jq')" >&2
    exit 2
  fi
}

http_status() {
  curl -s -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "$1" 2>/dev/null || true
}

http_body() {
  curl -s --max-time "$TIMEOUT" "$1" 2>/dev/null || true
}

# ─── checks ─────────────────────────────────────────────────────────────────

check_web_health() {
  local url="$WEB_BASE/api/v1/health"
  local body; body=$(http_body "$url")
  if [[ -z "$body" ]] || ! echo "$body" | jq -e '.status == "ok"' >/dev/null 2>&1; then
    fail "web /api/v1/health  ($url did not return status=ok)"
    return
  fi
  ok "web /api/v1/health"
}

check_worker_health() {
  local url="$API_BASE/v1/health"
  local body; body=$(http_body "$url")
  if [[ -z "$body" ]] || ! echo "$body" | jq -e '.status == "ok"' >/dev/null 2>&1; then
    fail "worker /v1/health  ($url did not return status=ok)"
    return
  fi
  ok "worker /v1/health"
}

check_audit_chain() {
  local url="$API_BASE/v1/audit/verify?limit=10000"
  local body; body=$(http_body "$url")
  if [[ -z "$body" ]]; then
    fail "audit chain verifier  ($url returned empty body)"
    return
  fi
  local chain_ok; chain_ok=$(echo "$body" | jq -r '.ok // false')
  if [[ "$chain_ok" != "true" ]]; then
    local broken; broken=$(echo "$body" | jq -r '.first_broken_seq // "unknown"')
    fail "audit chain BROKEN at seq=$broken"
    return
  fi
  local checked; checked=$(echo "$body" | jq -r '.events_checked // 0')
  ok "audit chain verified ($checked events)"
}

check_tile_endpoint() {
  local url="$WEB_BASE/api/v1/tiles/$ELECTION_ID/0/0/0.mvt"
  local code; code=$(http_status "$url")
  if [[ "$code" != "200" && "$code" != "204" ]]; then
    fail "tile endpoint  ($url returned $code; expected 200 or 204)"
    return
  fi
  ok "tile endpoint $url  (HTTP $code)"
}

check_tls_cert() {
  if [[ "$WEB_BASE" != https://* ]]; then
    skip "TLS cert  (skipped - $WEB_BASE is not https)"
    return
  fi
  local host; host=${WEB_BASE#https://}; host=${host%%/*}
  local enddate
  enddate=$(echo \
    | openssl s_client -servername "$host" -connect "${host}:443" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null \
    | cut -d= -f2)
  if [[ -z "$enddate" ]]; then
    fail "TLS cert  (could not retrieve certificate from $host)"
    return
  fi
  local expiry_epoch; expiry_epoch=$(date -d "$enddate" +%s 2>/dev/null || echo 0)
  local now_epoch;    now_epoch=$(date +%s)
  local days_left=$(( (expiry_epoch - now_epoch) / 86400 ))
  if (( days_left < 30 )); then
    fail "TLS cert  (only $days_left days remaining for $host)"
    return
  fi
  ok "TLS cert valid for $days_left days ($host)"
}

check_rls_enforced() {
  # /api/v1/elections should return data for anonymous callers
  local body; body=$(http_body "$WEB_BASE/api/v1/elections")
  if ! echo "$body" | jq -e '.data | type == "array"' >/dev/null 2>&1; then
    fail "RLS public read  ($WEB_BASE/api/v1/elections did not return an array)"
    return
  fi
  ok "RLS public read  (anonymous can read /api/v1/elections)"

  # Hitting the auth me endpoint without a token must be 401
  local code; code=$(http_status "$API_BASE/v1/auth/me")
  if [[ "$code" != "401" && "$code" != "403" ]]; then
    fail "RLS auth-required  ($API_BASE/v1/auth/me returned $code; expected 401/403)"
    return
  fi
  ok "RLS auth-required  ($API_BASE/v1/auth/me requires Bearer token)"
}

check_otp_rate_limit() {
  if [[ "${SKIP_OTP_CHECK:-0}" == "1" ]]; then
    skip "OTP rate limit  (SKIP_OTP_CHECK=1)"
    return
  fi
  local phone="${OTP_TEST_PHONE:-+2348000000000}"
  local url="$API_BASE/v1/auth/request-otp"
  local last=0
  for _ in 1 2 3 4; do
    last=$(curl -s -o /dev/null -w '%{http_code}' \
      --max-time "$TIMEOUT" \
      -H 'Content-Type: application/json' \
      -d "{\"phone\":\"$phone\"}" \
      "$url" 2>/dev/null || true)
  done
  if [[ "$last" != "429" ]]; then
    fail "OTP rate limit  (fourth request to $url returned $last; expected 429)"
    return
  fi
  ok "OTP rate limit  (fourth request returns 429)"
}

check_sentry() {
  if [[ -z "${SENTRY_DSN:-}" && -z "${NEXT_PUBLIC_SENTRY_DSN:-}" ]]; then
    skip "Sentry  (no DSN configured)"
    return
  fi
  ok "Sentry DSN present  (manual verification: trigger an error and watch the dashboard)"
}

# ─── main ───────────────────────────────────────────────────────────────────

main() {
  require_jq

  printf "\n%s\n" "$(c_bld 'OpenBallot post-deploy smoke')"
  printf "  Web:     %s\n" "$WEB_BASE"
  printf "  Worker:  %s\n" "$API_BASE"
  printf "  Election: %s\n\n" "$ELECTION_ID"

  check_web_health
  check_worker_health
  check_audit_chain
  check_tile_endpoint
  check_tls_cert
  check_rls_enforced
  check_otp_rate_limit
  check_sentry

  printf "\n%s\n" "$(c_bld 'Summary')"
  printf "  %s passed, %s failed\n" "$(c_grn "$PASS")" "$(c_red "$FAIL")"

  if (( FAIL > 0 )); then
    printf "\n%s\n" "$(c_red 'Failing checks:')"
    for c in "${FAILED_CHECKS[@]}"; do printf "  - %s\n" "$c"; done
    printf "\n%s  Deploy verification FAILED. Roll back or investigate before declaring the deploy complete.\n\n" "$(c_red '✗')"
    exit 1
  fi

  printf "\n%s  Deploy verified.\n\n" "$(c_grn '✓')"
}

main "$@"
