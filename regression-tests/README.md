# Regression Tests

Pipeline-level regression tests: known input → known-good expected output.

These complement the unit tests in `tests/unit/`. Unit tests verify individual
functions in isolation; regression tests verify the full conversion pipeline
end-to-end. A regression test catches "I changed something unrelated and
accidentally broke the DevWeb output for this collection."

---

## Structure

```
regression-tests/
  README.md                    ← this file
  run-all.sh                   ← shell script to run all tests and report results
  postman/
    basic-auth/
      inputs/
        collection.json         ← the Postman/Bruno/JMX input
        environment.json        ← optional environment file
      expected/
        main.js                 ← expected DevWeb main.js output
        Action.c                ← expected VuGen C output (if applicable)
    oauth-jwt/
      inputs/ ...
      expected/ ...
  har-studio/
    single-har-correlation/
      inputs/
        recording.har
      expected/
        main.js
  jmx/
    multi-thread-group/
      inputs/
        script.jmx
        data.csv
      expected/
        script1/main.js
        script2/main.js
```

---

## How to add a regression test

1. Create a subfolder under the relevant converter (`postman/`, `har-studio/`, `jmx/`)
2. Put the input file(s) in `inputs/`
3. Run the converter manually and save the output to `expected/`
4. Add an entry to `run-all.sh` following the pattern of existing entries
5. Commit both the inputs and expected outputs

**Rule (from `ai-assisted-development-playbook.md`):** The agent must NEVER
update `expected/` files to make a failing test pass. A test failure means
either the expected output is wrong (intentional behavior change, requires
human review) or a regression was introduced (requires a code fix).

When a behavior change is intentional, update `expected/` in a dedicated
commit with a note explaining what changed and why.

---

## How to run

### Run all regression tests (manual)

```bash
bash regression-tests/run-all.sh
```

The script exits 0 if all comparisons match, non-zero otherwise.

### Run a single test

```bash
node -e "
const { generateScript } = require('./src/generators/advancedScriptGenerator');
// ... load input, generate, compare to expected
"
```

---

## run-all.sh skeleton

The actual test runner is in `run-all.sh`. When a test case is added,
add a call to the `run_test` function:

```bash
#!/usr/bin/env bash
# run-all.sh — skeleton, no test cases yet
set -euo pipefail
PASS=0; FAIL=0

run_test() {
  local name="$1"; local input="$2"; local expected="$3"
  local actual
  actual=$(node scripts/generate-for-test.js "$input" 2>/dev/null)
  if diff -q <(echo "$actual") "$expected" >/dev/null 2>&1; then
    echo "PASS: $name"; ((PASS++))
  else
    echo "FAIL: $name"; diff <(echo "$actual") "$expected" | head -20; ((FAIL++))
  fi
}

# Add test cases here:
# run_test "postman/basic-auth DevWeb" \
#          regression-tests/postman/basic-auth/inputs/collection.json \
#          regression-tests/postman/basic-auth/expected/main.js

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
```

---

## Inputs already known to work (smoke-test candidates)

These are real-world scenarios that have been manually verified. Capture them
as regression tests to prevent silent regressions:

| Priority | Scenario | Converter | Reason |
|----------|----------|-----------|--------|
| High | Postman collection with OAuth2 + JWT | Postman → DevWeb | JWT detection is complex |
| High | Bruno YAML with `bru.setEnv` post-script | Bruno → DevWeb | Event Storage Rule regression |
| High | JMX with CSVDataSet + multi-thread-group | JMX → VuGen | Multi-group routing |
| High | HAR with authenticity_token CSRF | Studio single-HAR | Phase 2.5 CSRF scan |
| Medium | HAR with DPoP flow | Studio → DevWeb | DPoP sentinel handling |
| Medium | HAR with array correlation (SelectAll) | Studio → DevWeb | Array reconstruction |

---

## Relationship to unit tests

```
Unit tests (tests/unit/)
  → Per-function isolation
  → Fast (< 5s total)
  → Run on every commit

Regression tests (regression-tests/)
  → Full-pipeline end-to-end
  → Slower (seconds per case)
  → Run before releases and after significant changes
  → Required gate: agent must run these before marking any
     multi-file change as Done (per testing-strategy-and-definition-of-done.md)
```
