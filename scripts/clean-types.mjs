import { rmSync } from "node:fs";
import { resolve } from "node:path";

// TypeScript does not remove outputs for deleted source files. Keep package
// contents faithful to the current source tree before every declaration build.
rmSync(resolve(process.cwd(), "dist"), { recursive: true, force: true });
