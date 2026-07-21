# Loopbreaker

**A local review graph that lets agent review stop without pretending the code is ready to ship.**

Loopbreaker is the small public demo extracted from a deeper review-and-shipping
feature embedded in [Rordi](https://github.com/rordi-ai). It stores an issue's
acceptance behaviors, attributable evidence, findings, bounded review passes,
and human waivers in local SQLite; exposes the same substrate to agents through
MCP; and renders the decision as a plain visual graph.

The hard-won lesson behind it: **review convergence and shipping readiness are
different facts**. A reviewer can finish checking a repair while a required
behavior still lacks production-relevant proof. Conflating those facts caused
review loops to grow indefinitely. Loopbreaker makes both states explicit.

It now packages the complete public workflow as four reusable agent skills:

- `shape-strategy` — frame appetite, reversibility, smallest slice, and success.
- `plan-feature` — freeze enforced behavior children and proportionate proof.
- `implement-feature` — build only the contract and record attributable evidence.
- `review-invariants` — run the two-plus-one review and explicit ship decision.

![Loopbreaker visual decision view](docs/loopbreaker.png)

## Try the incident

Requires Node.js 22.5+ and pnpm.

```sh
git clone https://github.com/rordi-ai/loopbreaker.git
cd loopbreaker
pnpm install
pnpm build

node dist/cli.js demo
node dist/cli.js
node dist/cli.js substrate DEMO-1
node dist/cli.js serve
```

Open <http://127.0.0.1:7331>. The seeded incident starts here:

- One comprehensive pass compresses thirteen legacy review iterations.
- Two of three enforced behaviors are verified.
- A unit test exists for the third behavior, but wired replay proof does not.
- Review's next action is repair verification; shipping is held.

Use **Record repair pass**. Review becomes complete, but shipping remains held.
Then use **Add wired proof**. The behavior becomes verified and the disposition
changes to ship. The two decisions never overwrite one another.

CLI stdout uses [TOON](https://toonformat.dev/) so agents receive compact,
regular data. The database defaults to `.loopbreaker/loopbreaker.db`; override
it with `--db PATH` or `LOOPBREAKER_DB`.

## Install as a Codex plugin

The repository is a complete plugin: [.codex-plugin/plugin.json](.codex-plugin/plugin.json)
registers the four skills and [.mcp.json](.mcp.json) starts the bundled local MCP
server. No TypeScript runtime is needed after the repository has been built.

```sh
pnpm install
pnpm build
```

The generated `mcp/server.bundle.mjs` is the plugin entry point. Set
`LOOPBREAKER_DB` in your MCP environment when you want an explicit database path;
otherwise the server uses `.loopbreaker/loopbreaker.db` under its working directory.

## Use it with any MCP client

Build the repo, then add this local stdio server to your MCP client config:

```json
{
  "mcpServers": {
    "loopbreaker": {
      "command": "node",
      "args": [
        "/absolute/path/to/loopbreaker/dist/cli.js",
        "mcp",
        "--db",
        "/absolute/path/to/review.db"
      ]
    }
  }
}
```

The server tells agents to load the substrate before reviewing and to check the
ship status separately. It exposes nine focused tools:

| Tool | Purpose |
| --- | --- |
| `review_import_contract` | Import behavior children; enforced unless explicitly advisory |
| `review_list_issues` | List derived review and shipping states |
| `review_substrate` | Read the complete frozen review surface |
| `review_upsert_finding` | Preserve one stable row per review root cause |
| `review_record_pass` | Record the next pass, limited to 1–3 |
| `review_record_evidence` | Attach unit, wired, or live proof |
| `review_verify_behavior` | Verify a behavior using attached passing evidence |
| `review_create_waiver` | Accept named debt with an approver and rationale |
| `review_ship_status` | Read the authoritative ship disposition |

The MCP results are TOON text blocks. Run a real client/server handshake with:

```sh
pnpm verify:mcp
```

## Import your own issue

Start from [examples/issue-contract.json](examples/issue-contract.json):

```sh
node dist/cli.js import examples/issue-contract.json --db my-review.db
node dist/cli.js substrate APP-42 --db my-review.db
```

Every behavior is enforced by default. Set `"advisory": true` only when a
behavior genuinely is not part of the ship gate. Once the first review pass is
recorded, changing the contract is rejected: parent context can interpret the
behavior children, but cannot silently add requirements mid-review.

## The decision model

Review is bounded to a two-plus-one budget:

1. **Comprehensive** — find the coherent set of issues against the frozen contract.
2. **Repair verification** — check admitted repairs and repair regressions.
3. **Decision only** — ship, ship with debt, split/re-scope, or hold for one named critical risk.

There is no automatic pass 4. A passing pass can complete review early. Neither
case grants permission to ship.

Shipping is derived independently:

- `ship`: every enforced behavior is verified.
- `ship_with_debt`: every unverified enforced behavior has an explicit waiver.
- `hold`: at least one enforced behavior is neither verified nor waived.

This keeps reviewer verdicts as evidence supporting the acceptance contract,
instead of creating a hidden parallel gate.

## Architecture

```text
CLI (TOON) ─┐
            ├── domain rules ── SQLite/WAL
MCP (stdio) ┤        │
            └── HTTP API ── visual decision view
```

The project deliberately uses one domain layer for every interface. The browser
cannot call a more permissive mutation than the MCP server, and an agent cannot
manufacture a fourth pass through a lower-level endpoint. The UI is plain HTML,
CSS, and browser JavaScript served by Node's HTTP module; there is no frontend
framework or cloud dependency.

## Commands

```text
loopbreaker                         live issue dashboard
loopbreaker init                    initialize SQLite
loopbreaker demo                    seed the synthetic incident
loopbreaker import FILE             import a behavior contract
loopbreaker substrate ISSUE         inspect the complete substrate
loopbreaker pass ISSUE ...          record pass 1, 2, or 3
loopbreaker evidence ISSUE ...      attach proportionate proof
loopbreaker verify BEHAVIOR ...     verify with passing evidence
loopbreaker waive ISSUE ...         accept named debt
loopbreaker serve                   run the visual view
loopbreaker mcp                     run the stdio MCP server
```

Run `loopbreaker help COMMAND` for exact flags. Commands are non-interactive,
idempotent where practical, and return structured errors.

## Verify

```sh
pnpm verify
```

This runs strict TypeScript checking, domain tests, a production build, MCP tool
discovery against the bundled plugin server, and a real MCP `review_ship_status`
call. The visual flow is also
small enough to inspect with any browser automation tool against the local
server.

## Scope

Loopbreaker is intentionally a reference implementation, not the full Rordi
entity graph or production synchronization layer. SQLite mirrors the important
review semantics locally so builders can inspect, reuse, and challenge the
pattern without standing up Rordi's Postgres services.

MIT licensed.
