import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api.js";
export const pool = new Workpool(components.workpool, {
  maxParallelism: 5,
  retryActionsByDefault: false,
});

export const voicePool = new Workpool(components.voicePool, {
  maxParallelism: 5,
  retryActionsByDefault: false,
});
export function operationPool(method: string) {
  return method.startsWith("calls.") ? voicePool : pool;
}
