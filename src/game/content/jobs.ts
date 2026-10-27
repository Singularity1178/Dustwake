// Order vocabulary. Adding a kind is one row plus a handler in sim/jobs.ts.
export interface JobKindDef { phase: string; capabilities: string[] }
export const JOB_KINDS: Record<string, JobKindDef> = {
  gatherDeposit: { phase: "gather", capabilities: ["move", "harvest", "travel"] },
  craftAt: { phase: "craft", capabilities: ["move", "craft", "travel"] },
  walk: { phase: "walk", capabilities: ["move"] },
};