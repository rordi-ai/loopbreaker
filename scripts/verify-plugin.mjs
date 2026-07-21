import { existsSync, readFileSync, readdirSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dirname, "..");
const expectedSkills = ["shape-strategy", "plan-feature", "review-planning", "implement-feature", "review-invariants", "orchestrate-delivery"];
const manifest = JSON.parse(readFileSync(resolve(root, ".codex-plugin/plugin.json"), "utf8"));
const claudeManifest = JSON.parse(readFileSync(resolve(root, ".claude-plugin/plugin.json"), "utf8"));
const mcp = JSON.parse(readFileSync(resolve(root, ".mcp.json"), "utf8"));
const packageManifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

if (manifest.name !== "loopbreaker" || manifest.skills !== "./skills/" || manifest.mcpServers !== "./.mcp.json") {
  throw new Error("Codex plugin manifest does not register Loopbreaker skills and MCP.");
}
if (manifest.version !== packageManifest.version) throw new Error("Codex plugin and package versions must match.");
if (claudeManifest.name !== "loopbreaker") throw new Error("Claude plugin manifest must be named loopbreaker.");
if (claudeManifest.version !== packageManifest.version) throw new Error("Claude plugin and package versions must match.");
if (claudeManifest.mcpServers?.loopbreaker?.args?.[0] !== "${CLAUDE_PLUGIN_ROOT}/mcp/server.bundle.mjs") {
  throw new Error("Claude plugin MCP config does not target the bundled server via CLAUDE_PLUGIN_ROOT.");
}
if (mcp.mcpServers?.loopbreaker?.args?.[0] !== "./mcp/server.bundle.mjs") {
  throw new Error("Plugin MCP config does not target the bundled server.");
}
if (!existsSync(resolve(root, "mcp/server.bundle.mjs"))) throw new Error("Bundled MCP server is missing.");
if (!existsSync(resolve(root, "mcp/hook.bundle.mjs"))) throw new Error("Bundled hook entry point is missing.");

// --- Hook registration (LB-18-B5) ----------------------------------------
//
// The Claude plugin manifest must register SessionStart and PreToolUse
// hooks against the packaged, committed CLI bundle (mcp/hook.bundle.mjs),
// never against dist/cli.js -- plugins install by git clone and dist/ is
// gitignored, so a dist/-targeting hook command would be broken for every
// consumer of the plugin.
function firstHookCommand(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return undefined;
  return entries[0]?.hooks?.[0]?.command;
}

const sessionStartEntries = claudeManifest.hooks?.SessionStart;
const preToolUseEntries = claudeManifest.hooks?.PreToolUse;
const sessionStartCommand = firstHookCommand(sessionStartEntries);
const preToolUseCommand = firstHookCommand(preToolUseEntries);

if (!Array.isArray(sessionStartEntries) || sessionStartEntries.length === 0) {
  throw new Error("Claude plugin manifest does not register a SessionStart hook.");
}
if (!Array.isArray(preToolUseEntries) || preToolUseEntries.length === 0) {
  throw new Error("Claude plugin manifest does not register a PreToolUse hook.");
}
if (typeof sessionStartCommand !== "string" || !sessionStartCommand.includes("${CLAUDE_PLUGIN_ROOT}/mcp/hook.bundle.mjs")) {
  throw new Error("SessionStart hook does not invoke the bundled hook entry point via CLAUDE_PLUGIN_ROOT.");
}
if (!sessionStartCommand.trim().endsWith("session-start")) {
  throw new Error("SessionStart hook command does not end with the session-start event name.");
}
if (typeof preToolUseCommand !== "string" || !preToolUseCommand.includes("${CLAUDE_PLUGIN_ROOT}/mcp/hook.bundle.mjs")) {
  throw new Error("PreToolUse hook does not invoke the bundled hook entry point via CLAUDE_PLUGIN_ROOT.");
}
if (!preToolUseCommand.trim().endsWith("pre-tool-use")) {
  throw new Error("PreToolUse hook command does not end with the pre-tool-use event name.");
}
if (preToolUseEntries[0]?.matcher !== "Edit|Write|MultiEdit|NotebookEdit") {
  throw new Error("PreToolUse hook matcher must be exactly Edit|Write|MultiEdit|NotebookEdit.");
}
const workerAgent = readFileSync(resolve(root, "agents/impl-worker.md"), "utf8");
if (!workerAgent.startsWith("---\nname: impl-worker\n") || !workerAgent.includes("model: sonnet")) {
  throw new Error("impl-worker agent definition is missing or does not pin the sonnet model.");
}

for (const name of expectedSkills) {
  const skill = readFileSync(resolve(root, "skills", name, "SKILL.md"), "utf8");
  const metadata = readFileSync(resolve(root, "skills", name, "agents/openai.yaml"), "utf8");
  if (!skill.startsWith(`---\nname: ${name}\ndescription:`)) throw new Error(`${name} has invalid frontmatter.`);
  if (/\bTODO\b|\[TODO:/i.test(skill)) throw new Error(`${name} contains a placeholder.`);
  if (!metadata.includes(`$${name}`)) throw new Error(`${name} metadata does not name the skill in its default prompt.`);
}

// --- State-authority deduplication (LB-18-B6) ---------------------------
//
// The state-authority litany (mandatory state header now fed by the
// composed prime block, "persisted state is the only authority / copy
// verbatim / never predict unpersisted state", "there is no pass 4", and
// "review completion is not shipping readiness") must be defined exactly
// once and referenced — not restated — by every skill that needs it.
//
// Heuristic (deliberately simple and robust rather than a full semantic
// diff):
//   (a) exactly one file anywhere under skills/ is named
//       "state-authority.md", and it lives at the canonical path
//       skills/shared/state-authority.md;
//   (b) every expected skill's SKILL.md contains the literal reference
//       marker "../shared/state-authority.md";
//   (c) no SKILL.md contains any of a handful of fingerprint phrases taken
//       verbatim from the canonical file's body. A skill that pasted the
//       full litany back in (instead of linking to it) would reintroduce
//       one of these phrases; a skill that only links to the shared file,
//       or states its own specific header line list, will not.
const STATE_AUTHORITY_MARKER = "../shared/state-authority.md";
const STATE_AUTHORITY_FINGERPRINTS = [
  "is the only authority for shape, planning, planning",
  "decision packet rather than expanding the audit",
  "two separate, independently persisted",
];

function findFilesNamed(dir, filename) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || entry.name !== filename) continue;
    found.push(resolve(entry.parentPath ?? entry.path, entry.name));
  }
  return found;
}

function checkStateAuthorityDedup(skillsRoot, skillNames) {
  const canonicalPath = resolve(skillsRoot, "shared", "state-authority.md");
  const matches = findFilesNamed(skillsRoot, "state-authority.md");
  if (matches.length !== 1) {
    throw new Error(`Canonical state-authority litany must be defined in exactly one file, found ${matches.length}.`);
  }
  if (matches[0] !== canonicalPath) {
    throw new Error(`Canonical state-authority litany must live at skills/shared/state-authority.md, found ${matches[0]}.`);
  }

  for (const name of skillNames) {
    const skillPath = resolve(skillsRoot, name, "SKILL.md");
    const skill = readFileSync(skillPath, "utf8");
    if (!skill.includes(STATE_AUTHORITY_MARKER)) {
      throw new Error(`${name}/SKILL.md is missing the shared state-authority reference (${STATE_AUTHORITY_MARKER}).`);
    }
    for (const fingerprint of STATE_AUTHORITY_FINGERPRINTS) {
      if (skill.includes(fingerprint)) {
        throw new Error(
          `${name}/SKILL.md appears to restate the canonical state-authority litany instead of referencing it ("${fingerprint}").`,
        );
      }
    }
  }
}

// Prove the check actually fails on a violation before trusting it to gate
// the real tree. Builds a disposable fixture under os.tmpdir() (never under
// the repo), exercises two violations, then removes the fixture.
function selfTestStateAuthorityDedupFailsOnViolation() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "loopbreaker-verify-state-authority-"));
  try {
    const names = ["skill-a", "skill-b"];
    const validSkill = (skillName) =>
      `---\nname: ${skillName}\ndescription: fixture\n---\n\nSee [state authority](${STATE_AUTHORITY_MARKER}).\n`;

    // Baseline: valid fixture must pass.
    mkdirSync(join(fixtureRoot, "shared"), { recursive: true });
    writeFileSync(join(fixtureRoot, "shared", "state-authority.md"), "# State authority\n\nCanonical litany.\n");
    for (const name of names) {
      mkdirSync(join(fixtureRoot, name), { recursive: true });
      writeFileSync(join(fixtureRoot, name, "SKILL.md"), validSkill(name));
    }
    checkStateAuthorityDedup(fixtureRoot, names); // must not throw

    // Violation 1: one skill is missing the reference marker.
    writeFileSync(join(fixtureRoot, "skill-b", "SKILL.md"), "---\nname: skill-b\ndescription: fixture\n---\n\nNo reference here.\n");
    let threwOnMissingReference = false;
    try {
      checkStateAuthorityDedup(fixtureRoot, names);
    } catch {
      threwOnMissingReference = true;
    }
    if (!threwOnMissingReference) throw new Error("Self-test failed: missing reference marker did not throw.");
    writeFileSync(join(fixtureRoot, "skill-b", "SKILL.md"), validSkill("skill-b")); // restore

    // Violation 2: the canonical litany is duplicated in a second file.
    writeFileSync(join(fixtureRoot, "skill-b", "state-authority.md"), "# State authority\n\nDuplicated canonical litany.\n");
    let threwOnDuplicateDefinition = false;
    try {
      checkStateAuthorityDedup(fixtureRoot, names);
    } catch {
      threwOnDuplicateDefinition = true;
    }
    if (!threwOnDuplicateDefinition) throw new Error("Self-test failed: duplicated canonical definition did not throw.");
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

selfTestStateAuthorityDedupFailsOnViolation();
checkStateAuthorityDedup(resolve(root, "skills"), expectedSkills);

process.stdout.write(`Plugin verified: ${expectedSkills.length} skills, Codex and Claude manifests, bundled Loopbreaker MCP, SessionStart/PreToolUse hooks registered.\n`);
