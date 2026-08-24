# NowTutors — Advisory Notes

Standing context for the advisory seat (the chat that authors prompts and makes decisions), as
distinct from the five build docs — `SPEC.md`, `DECISIONS.md`, `PROGRESS.md`, `RUNBOOK.md`,
`WORKFLOW.md` — which record what the project is and has done, and distinct from the session
handoff note, which is one session's baton pass and is written fresh each time. This file
accumulates rather than resets: it holds things that are true across all sessions and do not
belong in the build docs. Updated in the same pass as the other five at session end.

## 1. Verify, do not trust the record

This project's own records have twice asserted things that were not true: a session handoff said
doc commits had "landed" when they sat on local `main` and never reached origin across four
sessions; and a closed-PR carry-forward was recorded as complete when two sections had never been
ported and no record mentioned them.

The standing rule: before accepting that anything landed, verify it — local vs origin, branch
content vs `main`'s actual files. A prose claim of completeness is not evidence of completeness.
This is the same standard the project already applies to test results (a claimed pass with no
captured output is not a pass); apply it to the project's own bookkeeping too.

## 2. Main is PR-only

Branch protection on `main` requires a pull request and a passing `verify` status check. Direct
pushes are rejected with `GH013`. Any plan that assumes a direct push to `main` is wrong before it
starts.

## 3. Documentation work can hide

Doc-only commits produce no build failure, no test failure, and no deploy error when they fail to
reach origin. Nothing surfaces the problem. Check explicitly at session end rather than assuming a
commit means published.

## 4. Autocomplete suggestions are not findings

Claude Code's input field suggests next actions. One suggested deleting the exact two branches
whose contents had not yet been verified — which would have destroyed the only copies of content
that was in fact missing from `main`. Suggestions carry no evidence; treat them as noise.

## 5. Stale artefacts mislead before they break

Stale branches, stale docs, and stale copies in project knowledge rarely cause direct damage; they
cause wasted work and wrong decisions by looking current. Delete them when found, after verifying
their content is superseded.

## 6. Production runs on the dev Supabase project

The deployed Vercel app authenticates against `mipnoxlhurdbaahmvhhx`, dashboard title
"nowtutors-dev" — the same project used for local development, testing, seeding, and migrations.
Not urgent while the rebuild has no real users; a hard blocker before cutover. Recorded in
`RUNBOOK.md` as a launch-blocker checklist item.
