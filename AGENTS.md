# Loopbreaker agent guide

Loopbreaker is an agent-facing CLI and local MCP server. Keep machine output
compact and stable. CLI stdout is TOON; diagnostics belong on stderr.

Before completing a change, run:

```sh
pnpm verify
```

This also verifies the seven plugin skills, both plugin manifests (Codex and
Claude Code), the bundled MCP entry point, tool discovery, and one real MCP call.
When the Codex skill/plugin validators are installed, also run their validators
against each `skills/*` directory and the repository root.

For the live demo, initialize a disposable database and exercise both surfaces:

```sh
loopbreaker demo --db /tmp/loopbreaker-demo.db
loopbreaker substrate DEMO-1 --db /tmp/loopbreaker-demo.db
loopbreaker serve --db /tmp/loopbreaker-demo.db
```

The domain rules are non-negotiable:

- A shape cannot reach `proceed` without a founder-approved discovery record.
  Discovery is the first ordered authority; the premise must come from a human.
- Behavior children are enforced by default unless explicitly advisory.
- An issue's behavior children freeze its acceptance contract.
- Implementation requires shape `proceed`, healthy planning, and independent
  planning-review approval in that order.
- Planning review and implementation review each use at most three passes:
  comprehensive, repair verification, and decision only. Neither has pass four.
- Review completion and shipping readiness are separate facts.
- Shipping requires every enforced behavior to be verified or explicitly waived.
- Evidence is executed, never asserted. An enforced behavior can only be verified
  on a proof loopbreaker ran itself (`loopbreaker prove`), whose verdict comes
  from the harness exit code. `not_run` is the fail-closed default: failing to
  observe a pass is never the same as passing.
- A behavior's harness is bound in two directions. The behavior names a registry
  entry (`loopbreaker bind`, outside the contract freeze) and the entry names the
  behavior back in its `proves` list (a reviewed change to `harnesses.json`).
  Neither half alone is sufficient.
- Build a behavior's harness and prove it RED against current HEAD before
  implementing. A harness that is green before the work exists proves nothing.
