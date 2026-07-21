import { Handle, NodeToolbar, Position, type Node, type NodeProps } from "@xyflow/react";

export type WorkflowNodeData = Record<string, unknown> & {
  kind: "issue" | "behavior" | "evidence" | "finding" | "pass" | "decision";
  eyebrow: string;
  title: string;
  status: string;
  tone: "neutral" | "green" | "red" | "amber" | "blue";
  lines?: Array<{ label: string; value: string }>;
  footer?: string;
  handles: { target: boolean; source: boolean };
};

export type WorkflowNode = Node<WorkflowNodeData, "workflow">;

export function WorkflowNodeCard({ data, selected }: NodeProps<WorkflowNode>) {
  return (
    <>
      <article className={`workflow-node tone-${data.tone} kind-${data.kind}`} data-kind={data.kind}>
        {data.handles.target ? <Handle className="node-handle" position={Position.Left} type="target" /> : null}
        {data.handles.source ? <Handle className="node-handle" position={Position.Right} type="source" /> : null}
        <header className="node-header">
          <div>
            <span className="node-eyebrow">{data.eyebrow}</span>
            <h3>{data.title}</h3>
          </div>
          <span className={`node-status tone-${data.tone}`}>{data.status}</span>
        </header>
        {data.lines?.length ? (
          <div className="node-content">
            {data.lines.map((line) => (
              <div className="node-line" key={`${line.label}:${line.value}`}>
                <span>{line.label}</span>
                <p>{line.value}</p>
              </div>
            ))}
          </div>
        ) : null}
        {data.footer ? <footer className="node-footer">{data.footer}</footer> : null}
      </article>
      <NodeToolbar className="node-toolbar" isVisible={selected} position={Position.Bottom}>
        Read-only · source of truth: SQLite
      </NodeToolbar>
    </>
  );
}
