# Documentation Automation System (generic — reuse across projects)

Pairs with `ai-assisted-development-playbook.md`. That file governs *how* an
agent implements changes safely; this one governs *which documents* get
touched, *when*, and *who owns the final call* on each. Copy into any
project's root (new or existing) and let the agent read it before starting
work.

The core idea: not every doc updates on every change. Doc updates are tied to
the *type* of change, not fired blindly on every task. This keeps docs
accurate instead of bloated, and keeps you from burning tokens rewriting a
deployment guide because you renamed a variable.

---

## Part 1 — The full document set and what each is for

| Document | Purpose | Owner |
|---|---|---|
| `README.md` | First-contact overview: what it is, quick setup, quick usage | AI drafts, you approve |
| `ARCHITECTURE.md` | Module map, data flow, how pieces fit together | AI maintains |
| `CONVENTIONS.md` | Coding standards, naming, patterns to follow | You set once, AI follows |
| `FEATURES.md` | Feature registry — one entry per feature, status, owner module, tests | AI maintains |
| `CHANGELOG.md` | Append-only technical log: what changed, when | AI maintains, append-only |
| `RELEASE_NOTES.md` | User/business-facing summary per version — "what's new," not implementation detail | AI drafts, you approve before publishing |
| `BUGS.md` (or `ISSUES.md`) | Known bugs, history, root cause, fix status | AI maintains |
| `DECISIONS.md` (ADR log) | Short record of *why* a significant technical choice was made — industry-standard practice ("Architecture Decision Records") | AI drafts at decision time, you approve |
| `DEPLOYMENT.md` | How to build, deploy, roll back; environments; required config | AI drafts, **you verify before trusting it** — wrong deployment docs are dangerous |
| `CONFIGURATION.md` | Every config value/env var, what it does, default, required vs optional | AI maintains |
| `TESTING.md` | Test strategy, how to run regression tests, how to add new test cases | AI maintains |
| `GLOSSARY.md` | Domain terms (protocol names, vendor-specific jargon, internal terminology) | AI maintains |
| `CONTRIBUTING.md` | For future-you or anyone else touching the repo: setup, PR process, standards | AI drafts, you approve |
| `BUSINESS_CONTEXT.md` | Why this exists, who uses it, what problem it solves, non-goals | **You own this — AI should not invent business rationale** |
| `SECURITY.md` | How secrets/credentials are handled, anything explicitly NOT to hardcode or log | You review carefully; AI flags concerns but you decide policy |

Not every project needs every file on day one. Create them as they become
relevant — an empty `DEPLOYMENT.md` before you've deployed anything is just
noise. But when the relevant milestone hits (first deploy, first real
decision, first external contributor), the agent should be the one to notice
and say "this doc should exist now," not wait for you to ask.

---

## Part 2 — What triggers what (the update matrix)

This is the part that makes automation *safe* instead of noisy.

| Change type | Docs to update in the same session |
|---|---|
| Trivial fix (typo, isolated one-line bug) | `CHANGELOG.md` only |
| Bug fix (non-trivial) | `CHANGELOG.md`, `BUGS.md` |
| New feature | `CHANGELOG.md`, `FEATURES.md`, `ARCHITECTURE.md` (if it adds a module/data flow), `README.md` (if it changes usage) |
| Changed/removed existing behavior | `CHANGELOG.md`, `FEATURES.md`, `ARCHITECTURE.md`, and flag in `RELEASE_NOTES.md` as a breaking change |
| New config/env var | `CONFIGURATION.md` |
| Significant architectural or technical decision (e.g. "why SQLite vs. markdown," "why this library") | `DECISIONS.md` |
| First deployment / deployment process changes | `DEPLOYMENT.md` |
| Vendor/third-party API change absorbed into the project | `CHANGELOG.md`, `FEATURES.md`, plus whatever vendor reference doc your project keeps |
| New domain term introduced | `GLOSSARY.md` |
| Release cut (you're about to ship/tag a version) | `RELEASE_NOTES.md` (human-readable), review `README.md` for staleness |

**Rule for the agent: before finishing any task, check this table, identify
which row applies, update exactly those docs — not more, not fewer.** If a
change doesn't clearly match a row, it should ask you rather than guess.

---

## Part 3 — Ownership: what AI drafts vs. what you must personally approve

Three tiers, and the agent should know which tier it's operating in:

1. **AI maintains freely** — CHANGELOG.md, BUGS.md, FEATURES.md,
   CONFIGURATION.md, GLOSSARY.md, TESTING.md, ARCHITECTURE.md. These are
   derived from what the code actually does — low risk if imperfect, easy to
   correct.
2. **AI drafts, you approve before it's treated as final** — README.md,
   CONTRIBUTING.md, RELEASE_NOTES.md, DECISIONS.md. These represent judgment
   calls or external-facing communication — worth a human pass.
3. **You own, AI never invents** — BUSINESS_CONTEXT.md, and the *policy*
   content of SECURITY.md. Why the project exists, who it serves, what
   tradeoffs were accepted for business reasons — an AI inferring this from
   code will get it wrong or make it up. If this doc doesn't exist yet, the
   agent should ask you to write it, not draft one from guesses.

---

## Part 4 — Rules to append to AI_RULES.md

```
- After finishing any task, consult the documentation update matrix and
  update exactly the docs that match the change type — not a blanket
  "update everything" pass.
- Never draft BUSINESS_CONTEXT.md or SECURITY.md policy content from
  inference — ask instead.
- Treat README.md, RELEASE_NOTES.md, CONTRIBUTING.md, and DECISIONS.md as
  drafts requiring my approval, not final on save.
- When a milestone is reached that implies a new doc should exist
  (first deployment, first real architectural decision, first external
  contributor) — say so explicitly rather than silently skipping it or
  silently creating it unasked.
- CHANGELOG.md entries are append-only — never rewritten or summarized away.
- If a change doesn't clearly match a row in the update matrix, ask which
  docs should be touched rather than guessing.
```

---

## Part 5 — Add to the generic kickoff prompt (Part 6 of the playbook)

Append this paragraph to that template:

```
Also read documentation-automation-system.md in the project root. After every
task, consult its update matrix and update only the documents that match the
type of change made — do not blanket-update all documentation on every task.
Treat README.md, RELEASE_NOTES.md, CONTRIBUTING.md, and DECISIONS.md as
drafts I need to approve, not final. Never invent content for
BUSINESS_CONTEXT.md or SECURITY.md policy — ask me instead.
```

---

## What you were still missing (worth knowing, not necessarily building today)

- **Architecture Decision Records (ADRs)** — the `DECISIONS.md` row above is
  a lightweight version of this. Industry-standard practice for capturing
  *why*, not just *what* — genuinely useful on a long-lived project, cheap to
  maintain, and the thing people miss most until they need it ("why did we
  choose X over Y two years ago?").
- **A periodic doc audit, separate from per-task updates.** Even with the
  matrix above, docs drift slowly. Every so often (monthly, or per release),
  explicitly ask the agent to review all docs against current code and flag
  inconsistencies — a dedicated audit pass, not something folded into a
  feature task.
- **Versioning your docs alongside your releases**, if this project will ever
  ship distinct versions people rely on — otherwise "the docs" describe
  whatever's on main, which confuses anyone on an older version.
- **A basic CONTRIBUTING.md even if you're the only contributor right now** —
  future-you, six months from now, is effectively a new contributor.
- **Not automating what shouldn't be automated**: business rationale and
  security policy are the two things worth deliberately keeping human-owned,
  covered in Part 3 above.

Nothing here is exotic — it's the same discipline real teams use, scaled down
to a solo/two-tool setup. The main thing to hold onto is Part 2's matrix:
that's what keeps "everything updates automatically" from becoming
"everything updates sloppily."
