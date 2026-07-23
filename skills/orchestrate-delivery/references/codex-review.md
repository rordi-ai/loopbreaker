# Pinned independent reviewer invocation (Codex CLI)

Verified against Codex CLI 0.144.5. The reviewer runs non-interactively with the
Loopbreaker MCP server injected per invocation, so it works without any Codex-side
plugin installation and records its own passes, findings, and evidence.

## Invocation

From the repository root, with `ISSUE`, `DB` (absolute path), and `SHA` set:

```sh
git worktree add --detach .review-wt "$SHA"
codex exec --ephemeral --cd .review-wt \
  --dangerously-bypass-approvals-and-sandbox \
  -c 'mcp_servers.loopbreaker.command="node"' \
  -c "mcp_servers.loopbreaker.args=[\"$PWD/mcp/server.bundle.mjs\"]" \
  -c "mcp_servers.loopbreaker.env={LOOPBREAKER_DB=\"$DB\"}" \
  -o .review-wt/review-report.md \
  "Review issue $ISSUE at the checked-out commit. Follow the loopbreaker
review protocol: call delivery_readiness and review_substrate first, treat the
behavior children as the frozen acceptance surface, run only the next allowed
pass, and record results yourself with review_record_pass,
review_upsert_finding, and review_record_evidence. Do not modify source files.
Report the persisted state verbatim."
git worktree remove --force .review-wt
```

For the pre-implementation planning review, use the same invocation with the
planning prompt: run only the next allowed planning pass and record with
`planning_review_record_pass` and `planning_review_upsert_finding`.

## Why the bypass flag is required

Open Codex defects cancel every MCP tool call in `exec` mode under a managed
sandbox ("user cancelled MCP tool call"): the exec runtime hits an approval and
user-input path that has no non-interactive handler, and no `approval_policy` or
trust configuration suppresses it. See
[openai/codex#16685](https://github.com/openai/codex/issues/16685) and
[openai/codex#24135](https://github.com/openai/codex/issues/24135).

`--dangerously-bypass-approvals-and-sandbox` is documented as intended for
externally sandboxed environments. This invocation approximates that boundary:

- The reviewer runs in a **disposable detached worktree**, removed afterwards, so
  stray writes never reach the working tree or index.
- The Loopbreaker database is the only intended shared mutable state, passed as
  an explicit absolute path.
- `--ephemeral` keeps the session out of persisted Codex state.

When the upstream defects are fixed, replace the bypass flag with
`--sandbox read-only` (MCP mutations are server-side and unaffected by the shell
sandbox) and drop the worktree if desired. Re-verify before tightening.

## Verification probe

To confirm the wiring on a new machine without touching real state, copy the
database to a temporary path, point `LOOPBREAKER_DB` at the copy, and ask the
reviewer to call `planning_health` plus one `planning_review_upsert_finding` on a
probe finding ID. Both must return `ok: true` and the finding must appear in
`loopbreaker substrate` against the copy.
