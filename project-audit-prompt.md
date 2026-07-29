# How to use this file

Run this FIRST on any existing project before setting up the knowledge system.
Read-only — makes no changes. Paste the section below into your AI coding
agent (Claude Code, Kiro, etc.) inside the project's root folder.

When it's done, read its report yourself first. If anything looks off or
incomplete, ask follow-up questions in the same session before moving on.
Only after you're satisfied should you move to `project-setup-prompt.md`.

(For a brand-new project with no existing code, skip this file — go straight
to `project-setup-prompt.md`.)

---

# PASTE THIS INTO YOUR AI CODING AGENT

You are acting as a Senior Software Architect doing a **discovery and audit** of
an existing codebase. This is a READ-ONLY task.

## Hard rule

Do not create, edit, or delete any file in this repository during this task.
Do not write documentation, do not scaffold folders, do not fix anything you
notice is broken. If you notice something concerning, note it in your report —
do not touch it. This session produces a report only.

## What to do

1. **Read the repository structure** — every folder and file, at least by name
   and purpose. Read the actual contents of source files, not just filenames,
   for anything that looks like a core module.

2. **Read every existing doc** — README, any bug tracker, architecture notes,
   comments, commit messages if accessible — anything already written down.
   Don't ask me to re-explain what's already documented; extract it yourself.

3. **Produce a report with these sections:**

   ### A. What this project currently does
   Plain-language summary of the application's actual current functionality,
   based on what you found in the code — not assumptions.

   ### B. Module inventory
   A table or list: module/file name, what it does, what else in the codebase
   depends on it, how confident you are (explicitly say "inferred from code" vs
   "stated in docs" for each entry).

   ### C. What's already implemented vs. what's referenced but missing
   Anything mentioned in docs/comments/naming that doesn't seem to have a
   working implementation, or vice versa — code that exists with no
   documentation explaining its purpose.

   ### D. Existing safety nets
   What tests exist (if any), what they cover, and — importantly — what core
   functionality has NO test coverage right now. Be specific about gaps, not
   just "some areas lack tests." Distinguish unit test coverage from
   integration/regression coverage if both exist.

   ### E. Risk areas
   Modules that many other things depend on, where a change would have wide
   blast radius. Call these out by name.

   ### F. Gaps against a durable AI knowledge base
   I want to set up architecture docs, a feature registry, any relevant
   third-party/vendor API references, unit tests, and regression test folders
   going forward. Tell me specifically what raw material already exists in
   this repo that could feed each of those, and what would need to be built
   from scratch.

   ### G. Your open questions for me
   Anything you could not determine confidently from the repo alone — ask me
   directly here rather than guessing.

## Constraints

- Do not propose a folder structure or implementation plan in this session —
  that's a separate step. This is assessment only.
- Where you're not sure whether something is intentional design or leftover/
  dead code, say so explicitly rather than picking one.
- If the repo is too large to read in full in one pass, tell me that plainly
  and propose which parts you'd read first, rather than silently skimming and
  presenting partial coverage as complete.

Give me the full report before doing anything else.
