import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NodeMouseHandler } from "@xyflow/react";
import type { IssueRow, Substrate } from "../../src/types";
import { Canvas } from "./components/ai-elements/canvas";
import { Controls } from "./components/ai-elements/controls";
import { WorkflowEdgeLine } from "./components/ai-elements/edge";
import { WorkflowNodeCard, type WorkflowNode } from "./components/ai-elements/node";
import { Panel } from "./components/ai-elements/panel";
import { buildReviewGraph } from "./graph";

type LiveState = "connecting" | "live" | "polling";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const value = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(value.error?.message ?? `Request failed: ${response.status}`);
  return value;
}

const nodeTypes = { workflow: WorkflowNodeCard };
const edgeTypes = { workflow: WorkflowEdgeLine };

interface InboxItem {
  issue_id: string;
  title: string;
  description: string;
  status: string;
  answers: Array<{ field: string; question: string; answer: string }>;
}

/**
 * The approval inbox.
 *
 * A separate route rather than a control on the graph page: approving a premise
 * requires READING it, and the graph has nowhere to put eight questions and
 * their answers. A bare button on text you cannot see is the rubber-stamping
 * this gate exists to prevent. Sized for a phone, because that is where the
 * founder is when this is waiting on them.
 */
function Inbox({ onApproved }: { onApproved: () => void }) {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [approver, setApprover] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setItems(await requestJson<InboxItem[]>("/api/inbox"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const approve = useCallback(async (issueId: string) => {
    if (!approver.trim()) {
      setNotice("Your name is required — it is recorded as the approver.");
      return;
    }
    setNotice(`Approving ${issueId}…`);
    try {
      await requestJson(`/api/issues/${encodeURIComponent(issueId)}/discovery/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved_by: approver.trim() }),
      });
      setNotice(`${issueId} approved. The shape gate is released.`);
      await load();
      onApproved();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, [approver, load, onApproved]);

  return (
    <main className="app-shell inbox-shell">
      <h1 className="inbox-title">Premise approvals</h1>

      {items === null ? <p className="inbox-empty">Loading…</p> : null}
      {items?.length === 0 ? (
        <p className="inbox-empty">Nothing is waiting on you. Premises appear here once an interview is recorded.</p>
      ) : null}

      {items?.map((item) => (
        <section className="inbox-card" key={item.issue_id}>
          <div className="inbox-card-head">
            <span className="inbox-issue">{item.issue_id}</span>
            <h2>{item.title}</h2>
            <p className="inbox-ask">
              Read every answer below. Approving records you as the human behind this premise, and
              every downstream gate then treats it as settled.
            </p>
          </div>
          <dl className="inbox-answers">
            {item.answers.map((answer) => (
              <div className="inbox-answer" key={answer.field}>
                <dt>{answer.field.replaceAll("_", " ")}</dt>
                <dd className="inbox-question">{answer.question}</dd>
                <dd className="inbox-text">{answer.answer}</dd>
              </div>
            ))}
          </dl>
          <div className="inbox-actions">
            <input
              className="inbox-name"
              placeholder="Your name"
              value={approver}
              onChange={(event) => setApprover(event.target.value)}
              aria-label="Approver name"
            />
            <button onClick={() => void approve(item.issue_id)}>Approve the premise</button>
          </div>
        </section>
      ))}
      <div className="action-notice" aria-live="polite">{notice}</div>
    </main>
  );
}

type View = "graph" | "inbox";

function currentView(): View {
  return window.location.pathname.replace(/\/+$/, "") === "/inbox" ? "inbox" : "graph";
}

/**
 * One app, two views.
 *
 * The inbox began as a separate page with its own header and no way back, which
 * read as a different product. It is the same substrate seen from the other end:
 * the graph is "what is the state", the inbox is "what needs me". A shared shell
 * with a pending count is what makes the second discoverable at all — nobody
 * visits a URL they were never told about.
 */
export function App() {
  const [view, setView] = useState<View>(currentView);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const onPop = () => setView(currentView());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const refreshPending = useCallback(async () => {
    try {
      setPending((await requestJson<unknown[]>("/api/inbox")).length);
    } catch {
      // Advisory badge only; a failed count must never break the view.
    }
  }, []);

  useEffect(() => {
    void refreshPending();
    const timer = window.setInterval(() => void refreshPending(), 10_000);
    return () => window.clearInterval(timer);
  }, [refreshPending]);

  const go = useCallback((next: View) => {
    window.history.pushState({}, "", next === "inbox" ? "/inbox" : "/");
    setView(next);
  }, []);

  const embed = new URLSearchParams(window.location.search).get("embed") === "1";
  return (
    <div className={`app-root${embed ? " embed" : ""}`}>
      <nav className="app-nav">
        <span className="app-brand">Loopbreaker</span>
        <div className="app-tabs">
          <button className={view === "graph" ? "app-tab is-active" : "app-tab"} onClick={() => go("graph")}>
            Graph
          </button>
          <button className={view === "inbox" ? "app-tab is-active" : "app-tab"} onClick={() => go("inbox")}>
            Needs you{pending > 0 ? <span className="app-badge">{pending}</span> : null}
          </button>
        </div>
      </nav>
      {view === "inbox" ? <Inbox onApproved={refreshPending} /> : <GraphApp />}
    </div>
  );
}

function GraphApp() {
  const pollingOnly = new URLSearchParams(window.location.search).get("transport") === "poll";
  const embed = new URLSearchParams(window.location.search).get("embed") === "1";
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [activeIssue, setActiveIssue] = useState("");
  const activeIssueRef = useRef("");
  const [substrate, setSubstrate] = useState<Substrate | null>(null);
  const [liveState, setLiveState] = useState<LiveState>("connecting");
  const liveStateRef = useRef<LiveState>("connecting");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const setConnection = useCallback((state: LiveState) => {
    liveStateRef.current = state;
    setLiveState(state);
  }, []);

  const loadIssues = useCallback(async () => {
    const next = await requestJson<IssueRow[]>("/api/issues");
    setIssues(next);
    if (!activeIssueRef.current && next[0]) {
      activeIssueRef.current = next[0].id;
      setActiveIssue(next[0].id);
    }
  }, []);

  const loadSubstrate = useCallback(async (issueId = activeIssueRef.current) => {
    if (!issueId) return;
    const next = await requestJson<Substrate>(`/api/issues/${encodeURIComponent(issueId)}/substrate`);
    setSubstrate(next);
    setLastUpdate(new Date());
  }, []);

  useEffect(() => {
    void loadIssues();
  }, [loadIssues]);

  useEffect(() => {
    activeIssueRef.current = activeIssue;
    setSelectedNodeId(null);
    if (activeIssue) void loadSubstrate(activeIssue);
  }, [activeIssue, loadSubstrate]);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (disposed) return;
      setConnection("connecting");
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/events`);
      socket.addEventListener("open", () => {
        setConnection("live");
        void loadIssues();
        void loadSubstrate();
      });
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as { type?: string; issue_id?: string | null };
        if (message.type !== "substrate_changed") return;
        void loadIssues();
        if (!message.issue_id || message.issue_id === activeIssueRef.current) void loadSubstrate();
      });
      socket.addEventListener("close", () => {
        if (disposed) return;
        setConnection("polling");
        reconnect = setTimeout(connect, 1500);
      });
      socket.addEventListener("error", () => socket?.close());
    };
    if (pollingOnly) setConnection("polling");
    else connect();

    const poll = setInterval(() => {
      if (liveStateRef.current === "live") return;
      void loadIssues();
      void loadSubstrate();
    }, 1500);

    return () => {
      disposed = true;
      clearInterval(poll);
      if (reconnect) clearTimeout(reconnect);
      socket?.close();
    };
  }, [loadIssues, loadSubstrate, pollingOnly, setConnection]);

  const graph = useMemo(() => substrate ? buildReviewGraph(substrate) : { nodes: [], edges: [] }, [substrate]);
  const selectedNode = useMemo(
    () => graph.nodes.find((node) => node.id === selectedNodeId) as WorkflowNode | undefined,
    [graph.nodes, selectedNodeId],
  );
  const selectNode: NodeMouseHandler = useCallback((_event, node) => setSelectedNodeId(node.id), []);

  const act = useCallback(async (action: string) => {
    if (!activeIssue) return;
    setNotice("Applying through the domain authority…");
    try {
      await requestJson(`/api/issues/${encodeURIComponent(activeIssue)}/actions/${action}`, { method: "POST" });
      await loadSubstrate(activeIssue);
      setNotice("Recorded. The graph will also receive the live event.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, [activeIssue, loadSubstrate]);


  const demoActions = substrate?.issue.id === "DEMO-1";
  // LB-29: the approval affordance is NOT demo-gated. It is the one act with no
  // agent-facing equivalent — absent from MCP by design — so the browser is
  // where a human is actually expected to perform it.
  const heldAtDiscovery = substrate?.shipping.gate === "discovery";
  const decisionTone = substrate?.shipping.disposition ?? "hold";

  return (
    <main className={`app-shell${embed ? " embed" : ""}`}>
      <header className="app-header">
        <div>
          <span className="product-kicker">LOCAL REVIEW GRAPH</span>
          <h1>Loopbreaker</h1>
          <p>Inspect shape, planning health, independent planning approval, review convergence, and the active shipping gate.</p>
        </div>
        <div className="header-controls">
          <label>
            <span>ISSUE</span>
            <select value={activeIssue} onChange={(event) => setActiveIssue(event.target.value)}>
              {issues.map((issue) => <option key={issue.id} value={issue.id}>{issue.id} — {issue.title}</option>)}
            </select>
          </label>
          <div className={`live-badge state-${liveState}`} aria-live="polite" data-testid="connection-status">
            <i /> {liveState === "live" ? "WebSocket live" : liveState === "polling" ? "Polling recovery" : "Connecting"}
          </div>
        </div>
      </header>

      {substrate ? (
        <>
          <section className={`decision-bar disposition-${decisionTone}`} data-testid="decision-bar">
            <div>
              <span className="decision-label">{substrate.issue.id} · shape {substrate.shape.profile?.disposition ?? "missing"} · planning {substrate.planning.score}/100 · plan review {substrate.planning_review.disposition.replaceAll("_", " ")}</span>
              <h2>{substrate.issue.title}</h2>
              <p>{substrate.shipping.reason}</p>
              {heldAtDiscovery ? (
                <div className="decision-actions">
                  {/* A LINK, not an action. Approving from here would mean
                      approving a premise the page does not show — the same
                      rubber-stamping the gate exists to prevent. The inbox is
                      where the questions and answers are legible. */}
                  <a className="decision-cta" href="/inbox">Review the premise in Needs you →</a>
                </div>
              ) : null}
              {demoActions ? (
                <div className="decision-actions">
                  {substrate.review.next_pass === 2 ? <button onClick={() => void act("pass2")}>Record repair pass</button> : null}
                  {substrate.review.next_pass === 3 ? <button onClick={() => void act("pass3")}>Record decision pass</button> : null}
                  {substrate.shipping.unresolved_behavior_ids.length ? <button onClick={() => void act("prove")}>Add wired proof</button> : null}
                  {substrate.shipping.unresolved_behavior_ids.length ? <button onClick={() => void act("waive")}>Accept named debt</button> : null}
                </div>
              ) : null}
              <div className="action-notice" aria-live="polite">{notice}</div>
            </div>
            <div className="decision-outcome">
              <span>SHIPPING</span>
              <strong>{substrate.shipping.disposition.replaceAll("_", " ")}</strong>
              <small>{substrate.shipping.verified_total}/{substrate.shipping.enforced_total} verified</small>
            </div>
          </section>

          <section className="canvas-frame" aria-label="Live review workflow graph">
            <Canvas
              edges={graph.edges}
              edgeTypes={edgeTypes}
              nodes={graph.nodes}
              nodeTypes={nodeTypes}
              onNodeClick={selectNode}
              nodesFocusable
              edgesFocusable
            >
              <Controls position="bottom-right" />
              <Panel position="top-left" className="legend-panel">
                <span><i className="legend-dot green" /> verified</span>
                <span><i className="legend-dot red" /> blocking / held</span>
                <span><i className="legend-dot amber" /> waived debt</span>
                <span><i className="legend-line" /> pending path</span>
              </Panel>
              <Panel position="top-right" className="inspector-panel">
                {selectedNode ? (
                  <>
                    <span>{selectedNode.data.eyebrow}</span>
                    <strong>{selectedNode.data.title}</strong>
                    <small>{selectedNode.data.status}</small>
                  </>
                ) : (
                  <>
                    <span>GRAPH</span>
                    <strong>{graph.nodes.length} nodes · {graph.edges.length} edges</strong>
                    <small>Select a node to inspect it</small>
                  </>
                )}
              </Panel>
            </Canvas>
          </section>

          <footer className="app-footer">
            <span>Planning precedes behavior authority · review verdict is evidence</span>
            <span>{lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString()}` : "Waiting for substrate"}</span>
          </footer>
        </>
      ) : (
        <section className="empty-state">{issues.length ? "Loading substrate…" : "No issues. Run loopbreaker demo or import a contract."}</section>
      )}
    </main>
  );
}
