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

export function App() {
  const pollingOnly = new URLSearchParams(window.location.search).get("transport") === "poll";
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
  const decisionTone = substrate?.shipping.disposition ?? "hold";

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <span className="product-kicker">LOCAL REVIEW GRAPH</span>
          <h1>Loopbreaker</h1>
          <p>Inspect why review stopped—and why shipping can still be held.</p>
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
              <span className="decision-label">{substrate.issue.id} · {substrate.review.complete ? "review complete" : `next: ${substrate.review.next_action.replaceAll("_", " ")}`}</span>
              <h2>{substrate.issue.title}</h2>
              <p>{substrate.shipping.reason}</p>
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
            <span>Behavior status is shipping authority · review verdict is evidence</span>
            <span>{lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString()}` : "Waiting for substrate"}</span>
          </footer>
        </>
      ) : (
        <section className="empty-state">{issues.length ? "Loading substrate…" : "No issues. Run loopbreaker demo or import a contract."}</section>
      )}
    </main>
  );
}
