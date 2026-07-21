import { Panel as PrimitivePanel, type PanelProps } from "@xyflow/react";

export function Panel({ className = "", ...props }: PanelProps) {
  return <PrimitivePanel className={`workflow-panel ${className}`} {...props} />;
}
