import { encode } from "@toon-format/toon";

export interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; hint?: string };
  meta: {
    db?: string;
    next?: string[];
  };
}

export function success<T>(data: T, meta: Envelope<T>["meta"] = {}): string {
  return encode({ ok: true, data, meta });
}

export function failure(code: string, message: string, hint?: string): string {
  return encode({
    ok: false,
    error: { code, message, ...(hint ? { hint } : {}) },
    meta: {},
  });
}
