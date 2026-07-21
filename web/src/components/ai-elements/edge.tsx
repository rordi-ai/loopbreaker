import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";

export type WorkflowEdgeData = Record<string, unknown> & {
  tone: "neutral" | "green" | "red" | "amber" | "blue";
  animated?: boolean;
  dashed?: boolean;
  label?: string;
};

export type WorkflowEdge = Edge<WorkflowEdgeData, "workflow">;

export function WorkflowEdgeLine({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<WorkflowEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const tone = data?.tone ?? "neutral";
  return (
    <>
      <BaseEdge
        className={`workflow-edge tone-${tone}${data?.dashed ? " is-dashed" : ""}`}
        id={id}
        path={path}
      />
      {data?.animated ? (
        <circle className={`edge-pulse tone-${tone}`} r="4">
          <animateMotion dur="1.8s" path={path} repeatCount="indefinite" />
        </circle>
      ) : null}
      {data?.label ? (
        <EdgeLabelRenderer>
          <span className={`edge-label tone-${tone}`} style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}>
            {data.label}
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
