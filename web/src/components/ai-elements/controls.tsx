import { Controls as PrimitiveControls, type ControlProps } from "@xyflow/react";

export function Controls(props: ControlProps) {
  return <PrimitiveControls className="workflow-controls" showInteractive={false} {...props} />;
}
