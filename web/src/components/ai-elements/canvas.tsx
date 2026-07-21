import type { ReactFlowProps } from "@xyflow/react";
import { Background, ReactFlow } from "@xyflow/react";
import type { ReactNode } from "react";
import "@xyflow/react/dist/style.css";

type CanvasProps = ReactFlowProps & { children?: ReactNode };

// Adapted from Vercel AI Elements' Canvas. The graph is deliberately read-only:
// navigation stays interactive while data mutations remain in Loopbreaker's domain API.
export function Canvas({ children, ...props }: CanvasProps) {
  return (
    <ReactFlow
      colorMode="dark"
      deleteKeyCode={null}
      elementsSelectable
      fitView
      fitViewOptions={{ padding: 0.14, maxZoom: 1 }}
      minZoom={0.24}
      maxZoom={1.5}
      nodesConnectable={false}
      nodesDraggable={false}
      panOnDrag
      panOnScroll
      selectionOnDrag={false}
      zoomOnDoubleClick={false}
      {...props}
    >
      <Background bgColor="var(--canvas)" color="var(--grid-dot)" gap={24} size={1} />
      {children}
    </ReactFlow>
  );
}
