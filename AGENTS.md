# Loopbreaker agent guide

Loopbreaker is an agent-facing CLI and local MCP server. Keep machine output
compact and stable. CLI stdout is TOON; diagnostics belong on stderr.

Before completing a change, run:

```sh
pnpm verify
```

For the live demo, initialize a disposable database and exercise both surfaces:

```sh
loopbreaker demo --db /tmp/loopbreaker-demo.db
loopbreaker substrate DEMO-1 --db /tmp/loopbreaker-demo.db
loopbreaker serve --db /tmp/loopbreaker-demo.db
```

The domain rules are non-negotiable:

- Behavior children are enforced by default unless explicitly advisory.
- An issue's behavior children freeze its acceptance contract.
- Review has at most three passes: comprehensive, repair verification, decision.
- Review completion and shipping readiness are separate facts.
- Shipping requires every enforced behavior to be verified or explicitly waived.
