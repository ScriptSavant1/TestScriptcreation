# Regression Tests

Pipeline-level regression tests: known input → known-good expected output.

These complement the unit tests in `tests/unit/`. Unit tests verify individual
functions in isolation; regression tests verify the full conversion pipeline
end-to-end. A regression test catches "I changed something unrelated and
accidentally broke the DevWeb output for this collection."

## Status

**Skeleton only — no test cases yet.** The folder holds this README,
`run-all.sh` and empty `postman/`, `har-studio/` and `jmx/` folders (each with a
`.gitkeep`). `run-all.sh` calls `scripts/generate-for-test.js`, which **does not
exist yet** — it has to be written (a small Node script that takes
`--input=<file>` and `--protocol=devweb|web-http` and prints the generated
script) before the first test case can run. With no cases registered,
`run-all.sh` prints a note and exits 0.

## Structure

The planned layout (only the top-level folders exist today):

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

## How to run

### Run all regression tests (manual)

```bash
bash regression-tests/run-all.sh
```

The script exits 0 if all comparisons match, non-zero otherwise.

### Run a single test

Until `scripts/generate-for-test.js` exists, generate the output with the CLI
and compare it by hand, for example:

```bash
node src/cli.js convert -i regression-tests/postman/basic-auth/inputs/collection.json \
  -o ./tmp-out --protocol devweb
diff ./tmp-out/main.js regression-tests/postman/basic-auth/expected/main.js
```

## How run-all.sh works

`run-all.sh` defines a `run_test` function and a "Test cases" section where
each case is one call:

```bash
run_test "postman/basic-auth DevWeb" \
         "regression-tests/postman/basic-auth/inputs/collection.json" \
         "regression-tests/postman/basic-auth/expected/main.js"

# 4th argument = protocol (default devweb); use web-http for VuGen C
run_test "postman/basic-auth VuGen" \
         "regression-tests/postman/basic-auth/inputs/collection.json" \
         "regression-tests/postman/basic-auth/expected/Action.c" web-http
```

Paths are relative to the repository root. For each case, `run_test`:

- prints `SKIP (no input)` or `SKIP (no expected)` if a file is missing;
- runs `node scripts/generate-for-test.js --input=<input> --protocol=<protocol>`
  and prints `FAIL (generator error)` if it fails;
- otherwise diffs the output against the expected file and prints `PASS` or
  `FAIL` with the first 30 lines of the difference.

At the end it prints "Regression tests: N passed, M failed" and exits non-zero
if anything failed.

## Related checks that already exist

The portal redesign is guarded by output-parity checks, not by this folder:

- unit tests `tests/unit/recorderCoreParity.test.js`,
  `studioPageParity.test.js`, `converterPageParity.test.js` and
  `helpPageParity.test.js` (run with `npm test`);
- local golden-output harnesses for the Recorder, Script Studio, the
  converters and Help, kept outside the repository (see `CLAUDE.md`).

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
