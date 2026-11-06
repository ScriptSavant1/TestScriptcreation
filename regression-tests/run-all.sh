#!/usr/bin/env bash
# regression-tests/run-all.sh
# Runs all pipeline-level regression tests and reports pass/fail.
# Usage:  bash regression-tests/run-all.sh
# Exit 0 = all pass; non-zero = at least one failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PASS=0; FAIL=0

# ── Helpers ────────────────────────────────────────────────────────────────────

# run_test NAME INPUT_JSON EXPECTED_FILE [--vugen]
#   Generates a script from INPUT_JSON and diffs against EXPECTED_FILE.
#   Pass --vugen to use the VuGen generator instead of DevWeb.
run_test() {
  local name="$1"
  local input="$2"
  local expected="$3"
  local protocol="${4:-devweb}"

  if [ ! -f "${ROOT_DIR}/${input}" ]; then
    echo "SKIP (no input): ${name}"
    return
  fi

  if [ ! -f "${ROOT_DIR}/${expected}" ]; then
    echo "SKIP (no expected): ${name}"
    return
  fi

  local actual
  actual=$(node "${ROOT_DIR}/scripts/generate-for-test.js" \
    "--input=${ROOT_DIR}/${input}" \
    "--protocol=${protocol}" 2>/dev/null) || {
      echo "FAIL (generator error): ${name}"; ((FAIL++)); return
  }

  if diff -q <(echo "$actual") "${ROOT_DIR}/${expected}" >/dev/null 2>&1; then
    echo "PASS: ${name}"; ((PASS++))
  else
    echo "FAIL: ${name}"
    diff <(echo "$actual") "${ROOT_DIR}/${expected}" | head -30
    ((FAIL++))
  fi
}

# ── Test cases ────────────────────────────────────────────────────────────────
# Add entries here as regression test inputs and expected outputs are captured.
# Format: run_test "suite/name" "regression-tests/suite/name/inputs/file.json" \
#                 "regression-tests/suite/name/expected/main.js"

# (No test cases yet — see regression-tests/README.md for how to add them)

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "Regression tests: ${PASS} passed, ${FAIL} failed"

if [ "${PASS}" -eq 0 ] && [ "${FAIL}" -eq 0 ]; then
  echo "(No test cases registered yet — see README.md)"
  exit 0
fi

[ "${FAIL}" -eq 0 ]
