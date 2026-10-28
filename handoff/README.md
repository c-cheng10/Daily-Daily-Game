# handoff/

Shared memory for everyone (human or Claude) working on this repo. Claude sessions on different machines don't share memory, so anything the next person needs to know goes here and gets committed.

## Files

| File | What it is |
|---|---|
| `HANDOFF.md` | The original brief: the model bake-off spec, rules and "done means". Read it first. |
| `LOG.md` | Running session log, newest entry at the top. What was done, what was decided, what's next. |
| `DECISIONS.md` | Decisions that are settled, with the date and who made them. Don't re-litigate these. |

New handoffs (e.g. a round-2 brief) go in this folder as their own file, dated: `HANDOFF-2026-11-03-round2.md`.

## Rules

- **Before working:** read every file in this folder.
- **While working:** add to `LOG.md` and `DECISIONS.md` as you go, not batched at the end.
- **Before pushing:** make sure `LOG.md` has an entry for your session, and commit the `handoff/` changes together with your code changes.
- Never put API keys, `.env` contents or personal info in these files.
