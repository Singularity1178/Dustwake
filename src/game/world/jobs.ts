// Saved orders and locomotion state. Handlers and derived nav grids are not saved.
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export interface Point { x: number; y: number }
export interface PropRef { area: string; prop: string }
export interface Destination extends Point { area: string; range: number }
export interface JobOrder { kind: string; args: Record<string, Json> }
export interface Navigation {
  goal: string;
  path: Point[];
  blockedFor: number;
  recoveries: number;
  yielding: boolean;
  replanIn: number;
}
export interface Job extends JobOrder {
  id: number;
  phase: string;
  status: "running" | "paused" | "blocked" | "done";
  completed: number;
  waiting: boolean;
  transit: boolean;
  result: boolean | null;
  target: PropRef | null;
  nav: Navigation | null;
  retryAt: number;
  failures: number;
  reason: string | null;
}