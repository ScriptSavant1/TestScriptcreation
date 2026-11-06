# Development rules

How changes are made in PerfX Studio. `CLAUDE.md` has the file map and the architecture rules; this page has the working rules, and they apply to people and AI agents alike.

## Before changing code

Scale the process to the size of the change.

- **Small and isolated** (a typo, a fix with no callers elsewhere): make the change and name the files touched.
- **Anything else** (shared code, a new feature, changed behaviour): write an impact analysis first, with the files and features affected, the risk and any compatibility concern. Wait for approval, then implement.
- Never remove or change existing behaviour without saying so and naming what is affected.
- Never guess how a vendor engine behaves. Check it on the real engine, or say it is not confirmed.
- If the request is unclear, ask.

## Tests

- Every new or changed function gets unit tests in `tests/unit/`: the normal case, an empty or missing input, and a malformed input.
- A bug fix starts with a test that reproduces the bug. That test stays.
- Generated scripts and redesigned pages are also compared old against new with the tools in `regression-tests/tools/`, and on the real VuGen and DevWeb engines where the script text changes.
- Never change an expected result to make a test pass unless the change in behaviour was approved.
- A test that fails now and then gets investigated, not re-run until it passes.
- Results Analyser tests use synthetic data only.

## Code

- Fail loudly. Malformed or unexpected input must throw, log, or return a value the caller has to check, never output that looks valid but is not.
- Read back any negated condition that guards a file, network or write operation in plain words, and check it means what it should.
- Untested code with a wide reach gets its own task for tests. It does not wait for an unrelated change.

## Data and secrets

- Never commit passwords, tokens, keys or certificates. Use environment variables or an obviously fake example value.
- Documents, comments, tests and commit messages stay generic. They must not contain company or client names, internal host names or addresses, user names, local folder paths, repository names or URLs, branch names or commit IDs. Use `example.com` style names and refer to a version number or describe the change.
- Scan the change for all of the above before every commit. A secret already committed needs rotating as well as removing, and that is the owner's decision.
- Any new handling of personal or sensitive data is flagged for the owner, who decides the policy.

## Documents to update

Update only what the change calls for, in the same piece of work. If no row fits, ask.

| Change | Update |
|---|---|
| Small fix | `CHANGELOG.md` |
| Bug fix | `CHANGELOG.md`, `BUGS.md` |
| New feature | `CHANGELOG.md`, `Docs/FUNCTIONAL-SPEC.md`, `CLAUDE.md` if it adds files or data flow, `README.md` if usage changes, Help if users see it |
| Changed or removed behaviour | As for a new feature, and mention it in the changelog entry |
| Correlation logic | `Docs/CORRELATION-LOGIC-EXPLAINED.md` as well |
| New setting or environment variable | `Docs/deployment/CONFIGURATION.md`, and the environment table in `README.md` |
| Significant technical decision | `Docs/DECISIONS.md` |
| Deployment process | `Docs/deployment/DEPLOYMENT-IIS.md` |
| Release | Version in `package.json` and `package-lock.json`, `CHANGELOG.md`, `BUGS.md`, `README.md`, version lines in `Docs/`; then rebuild the documentation site |

`Docs/` is kept locally and never committed. The business reasons for the project and the security policy belong to the owner: ask rather than infer them.

## Keeping documents accurate

- Before every release, and after a major refactor, re-read the code behind `CLAUDE.md` and report every mismatch, starting with tables that claim something is always true.
- Old entries are never summarised away. When `BUGS.md` or `CHANGELOG.md` gets too long, older versions move to `BUGS-ARCHIVE.md` or `CHANGELOG-ARCHIVE.md`.
- Before archiving a file, check that no copy exists already and that nothing still needs it. Keep one copy of anything, and do not keep files nobody needs.

## Definition of done

- [ ] Impact analysis approved, and only what was approved changed
- [ ] Unit tests added or updated, and `npm test` passes
- [ ] Old-against-new comparison run for anything that changes generated scripts or a page
- [ ] Failure paths fail loudly, and negated conditions read back
- [ ] Change scanned for secrets, company names, local paths and repository details
- [ ] Documents updated as in the table above
- [ ] No placeholder or unfinished code left without saying so

Commit and push only when the owner asks. For a small fix most of this list will not apply; say which items were skipped and why.
