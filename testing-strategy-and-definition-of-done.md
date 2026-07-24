# Testing Strategy & Definition of Done (generic — reuse across projects)

Pairs with the playbook and documentation-automation-system files. This one
fills two gaps: the *test pyramid* (you only had the top layer covered), and a
single **Definition of Done** checklist that ties everything together so
nothing gets skipped.

---

## Part 1 — The three test layers (you only had layer 3)

| Layer | What it checks | Example for this kind of project |
|---|---|---|
| **1. Unit tests** | One function/module in isolation, including edge cases | Does the correlation function handle an empty response body? A malformed JSON payload? A missing header? |
| **2. Integration tests** | Multiple pieces working together correctly | Does the parser's output feed correctly into the generator without losing fields? |
| **3. Regression tests** | Whole pipeline, known input → known-good output, catches "did I break something that used to work" | (Already covered in earlier files — sample collection in, expected VuGen/LRE script out) |

Regression tests alone won't catch a bug in a code path nobody happened to
regression-test. Unit tests are what force explicit thinking about edge cases
*per function*, which is exactly the "each and every scenario" coverage
you're asking for.

### Rule to add to AI_RULES.md

```
- Every new function or modified function gets unit tests covering: the
  normal case, at least one empty/missing-input case, and at least one
  malformed/invalid-input case — not just the happy path.
- When a bug is fixed, add a unit test that reproduces the bug first, so it
  can't silently regress later — this test stays in the suite permanently.
- Integration tests are added when two or more modules are wired together
  for the first time, or when the way they connect changes.
- Regression tests (whole-pipeline, input-file based) remain the final gate
  before a task is marked done — but they do not replace unit tests.
- If a function is genuinely hard to unit test as written (tightly coupled,
  hidden dependencies), flag that as a design issue rather than skipping
  tests for it.
```

---

## Part 2 — Definition of Done (the actual gate, per task)

This is the single checklist that pulls together everything across all four
files. Have the agent run through this explicitly before calling any
non-trivial task complete:

```
DEFINITION OF DONE — check before marking any task complete:

[ ] Impact analysis was done and approved (for anything beyond a trivial fix)
[ ] Code change is scoped to what was approved — nothing extra touched
[ ] Unit tests written/updated for new or changed functions (happy path +
    empty/missing + malformed input)
[ ] Integration tests updated if module wiring changed
[ ] Regression tests run for all affected areas — all passing, or failures
    explicitly reported and blocking
[ ] Documentation updated per the update matrix (not more, not less)
[ ] CHANGELOG.md entry added
[ ] No known TODOs or placeholder code left silently — flagged if any remain
```

Trivial fixes can skip most of this (see the playbook's "scale to size of
change" rule) — but the agent should say *which* items it's skipping and why,
not silently shorten the checklist.

---

## Part 3 — A few more things worth having, now that the system's this
complete

- **Semantic versioning (semver)** — if you ever expect other people (or even
  future-you) to depend on a specific version's behavior, adopt
  MAJOR.MINOR.PATCH now rather than later. Cheap to start, painful to
  retrofit. Ties directly into RELEASE_NOTES.md.
- **A LICENSE file** — even for a personal/internal tool, worth deciding
  explicitly (private/proprietary vs. open) rather than leaving it undefined.
- **Dependency awareness** — when the agent adds a new library/package,
  it should note what it is and why, in CHANGELOG.md or DECISIONS.md if it's
  a meaningful addition — not just silently added to a package file.
- **A lightweight CI thought, even if manual for now** — you mentioned
  GitLab; even without full pipeline automation, having "run unit +
  regression tests" as a documented manual step before pushing is worth
  writing down in TESTING.md so it's not just tribal knowledge in your head.
- **"Flaky test" handling rule** — worth stating once: if a test fails
  intermittently, that gets investigated and fixed, never just re-run until
  it passes and ignored.

Nothing above needs to be built today — but they're the kind of gaps that
don't bite you until a project's a year old, so better to have the rule
written down now while it costs nothing.

---

## Part 4 — Add to the kickoff prompt (Part 6 of the playbook)

Append this line:

```
Also read testing-strategy-and-definition-of-done.md. Apply its Definition
of Done checklist before marking any non-trivial task complete, and write
unit tests (happy path, empty/missing input, malformed input) for every new
or changed function — not just regression tests at the pipeline level.
```
