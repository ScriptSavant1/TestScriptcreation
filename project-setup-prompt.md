# How to use this file

Run this after `project-audit-prompt.md` (existing project) or as your first
step (brand-new project). This builds the actual knowledge structure. Paste
the section below into your AI coding agent.

Let it finish Phase 0 (design) before approving Phase 1+ (creation). Don't let
it run all phases unattended — review the proposed plan first.

---

# PASTE THIS INTO YOUR AI CODING AGENT

You are acting as Principal Software Architect for this project. I use more
than one AI coding tool across different machines, so everything you build
must be **tool-agnostic** — no tool-specific filenames or assumptions baked
into the knowledge itself.

I have three reference files in this project's root that define how you
should work going forward:
- `ai-assisted-development-playbook.md`
- `documentation-automation-system.md`
- `testing-strategy-and-definition-of-done.md`

Read all three now, before doing anything else, and confirm you've understood
them — including the code-level guardrails (fail loudly, retrofit tests on
legacy high-risk code, scrutinize inverted conditions, never commit secrets,
flag sensitive data handling) and the periodic doc-audit cadence.

## Ground rules for this task

- Do NOT implement everything in one pass. Work in phases. After Phase 0, stop
  and show me the folder/file plan before creating anything.
- Every folder and file you create must have a one-line stated purpose — no
  filler.
- Nothing here should assume one specific AI product will always be the one
  reading it.
- Reuse anything relevant that already exists in the repo (or from the audit
  report, if one was run) instead of duplicating it.

## Phase 0 — Design (stop here for my review)

Propose this structure, adjusted to what you found already in the repo or in
the audit report. Locations follow documentation-automation-system.md Part 1
exactly — don't invent a different split:

```
/ai-brain/
  ARCHITECTURE.md
  CONVENTIONS.md
  AI_RULES.md              (per the playbook's Part 3 starter)
  FEATURES.md
  CHANGELOG.md
  BUGS.md
  DECISIONS.md
  CONFIGURATION.md
  GLOSSARY.md
  vendor/                  (if this project depends on external/vendor APIs)
    <vendor-name>/
      <version-or-area>.md

/regression-tests/
  README.md
  <feature-or-module>/
    inputs/
    expected-outputs/

/unit-tests/
  README.md                (how unit tests are organized/run for this stack)
```

Root-level docs (README.md, DEPLOYMENT.md, TESTING.md, CONTRIBUTING.md,
RELEASE_NOTES.md, BUSINESS_CONTEXT.md, SECURITY.md) are created only as they
become relevant per documentation-automation-system.md Part 1 — don't
scaffold empty placeholders for all of them now unless I ask for that.

Entry-point pointer file (tiny, tool-specific, one per machine/tool — see
`CLAUDE.md` template):
- Points the AI tool at the three reference files plus `/ai-brain/`.

## Phase 1 — AI_RULES.md

Draft using the starter in `ai-assisted-development-playbook.md` Part 3,
adjusted for anything specific this project needs.

## Phase 2 — Regression and unit test scaffolding

Set up the folder structure per `testing-strategy-and-definition-of-done.md`.
Leave `inputs/`/`expected-outputs/` empty except a placeholder — I'll add real
sample files myself.

## Phase 3 — Populate FEATURES.md, ARCHITECTURE.md, BUGS.md

Scan the existing codebase (or use the audit report if one exists) and draft
first-pass versions. Flag anything you're inferring vs. anything stated
explicitly in existing docs, so I can correct assumptions. If BUGS.md
history already exists elsewhere in the repo under a different name, migrate
it here rather than starting fresh.

## Now stop

Show me the Phase 0 plan before creating any files.
