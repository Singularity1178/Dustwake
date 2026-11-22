// Content linter (pure, no DOM). Generalises the repo's data-resolution tests
// (every shop step resolves, every line fits the font) into rules run on every
// content row: display text fits the font it is drawn in, references resolve
// (items, props, stations, archetypes, routines, areas), ids are unique. Run by
// tests/soak.test.ts on every `npm test`, and by scripts/lint-content.mjs.
// Add a rule: push to RULES (docs/testing/soak.md).
import { FONT_GLYPHS } from "../font";
import { fitsFont2 } from "../ui/font2";
import { ITEMS } from "../content/items";
import { PROPS } from "../content/props";
import { RECIPES } from "../content/build";
import { CRAFT_RECIPES, STATIONS } from "../content/crafting";
import { THOUGHTS } from "../content/monologue";
import { DIALOGUE } from "../content/dialogue";
import { EXCHANGES, PEER_LINES, GRIPES, NEWS, REACTIONS, MUTTERS } from "../content/talk";
import { SHOPS, VISITS } from "../content/shops";
import { HARVEST } from "../content/harvest";
import { CENSUS, ARCHETYPES, ROUTINES } from "../content/folk";
import { LEARNED_TEXT } from "../content/flags";
import { ACTORS } from "../content/actors";
import { AREAS } from "../world/areas";
import { AREA_KINDS } from "../world/areaSpec";
import { settingDefs, ACTIONS } from "../ui/settings";

export interface LintIssue { rule: string; table: string; row: string; problem: string }

/** Keys whose string values are shown to the player in the bitmap font. */
const DISPLAY = new Set(["name", "label", "desc", "description", "text", "line", "lines", "note", "closedNote", "title", "hint", "pages", "say", "says", "greet", "greeting", "idle", "farewell", "body", "caption"]);

/** The base font draws uppercase only (it uppercases what it is given); anything else shows as "?". */
const fitsFont1 = (s: string) => [...shown(s).toUpperCase()].every((c) => c === "\n" || FONT_GLYPHS.has(c));
/** What of a line is drawn: talk templates fill `{name}` slots at runtime, and "@table" lines stand for a line drawn from another table. */
const shown = (s: string) => (s.startsWith("@") ? "" : s.replace(/\{[a-z0-9_]+\}/gi, ""));

/** Every string under a display key (arrays inherit their key), as [path, text]. */
function displayStrings(v: unknown, key = "", path = ""): [string, string][] {
  if (typeof v === "string") return DISPLAY.has(key) ? [[path, v]] : [];
  if (Array.isArray(v)) return v.flatMap((x, i) => displayStrings(x, key, `${path}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => displayStrings(x, k, path ? `${path}.${k}` : k));
  return [];
}

/** Every `{ item: "..." }` reference inside a value, as [path, item id]. */
function itemRefs(v: unknown, path = ""): [string, string][] {
  if (Array.isArray(v)) return v.flatMap((x, i) => itemRefs(x, `${path}[${i}]`));
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>, out: [string, string][] = [];
    if (typeof o.item === "string") out.push([path, o.item]);
    for (const [k, x] of Object.entries(o)) if (k !== "item") out.push(...itemRefs(x, path ? `${path}.${k}` : k));
    return out;
  }
  return [];
}

const rows = (t: unknown): [string, unknown][] => (Array.isArray(t) ? t.map((r, i) => [String((r as { id?: string })?.id ?? i), r]) : Object.entries((t ?? {}) as Record<string, unknown>));

/** The content tables shown in the bitmap font, by name. */
const FONT1_TABLES: Record<string, unknown> = { ITEMS, PROPS, RECIPES, CRAFT_RECIPES, STATIONS, THOUGHTS, DIALOGUE, EXCHANGES, SHOPS, VISITS, LEARNED_TEXT, ACTORS };
/** Tables that are plain lines (no keys) in the bitmap font. */
const LINE_TABLES: Record<string, unknown> = { PEER_LINES, GRIPES, NEWS, REACTIONS, MUTTERS };

type Rule = { id: string; run: () => LintIssue[] };

export const RULES: Rule[] = [
  {
    id: "font1", run: () => {
      const out: LintIssue[] = [];
      for (const [table, t] of Object.entries(FONT1_TABLES)) for (const [row, r] of rows(t)) for (const [p, s] of displayStrings(r)) {
        if (!fitsFont1(s)) out.push({ rule: "font1", table, row, problem: `${p}: "${s}" has characters the bitmap font cannot draw (${[...new Set([...shown(s).toUpperCase()].filter((c) => c !== "\n" && !FONT_GLYPHS.has(c)))].join(" ")})` });
      }
      for (const [table, t] of Object.entries(LINE_TABLES)) for (const [p, s] of displayStrings(t, "line")) {
        if (!fitsFont1(s)) out.push({ rule: "font1", table, row: p, problem: `"${s}" has characters the bitmap font cannot draw` });
      }
      for (const [row, s] of Object.entries(LEARNED_TEXT as Record<string, unknown>)) if (typeof s === "string" && !fitsFont1(s)) out.push({ rule: "font1", table: "LEARNED_TEXT", row, problem: `"${s}" does not fit the bitmap font` });
      return out;
    },
  },
  {
    id: "font2", run: () => {
      const out: LintIssue[] = [];
      for (const d of settingDefs()) for (const s of [d.label, d.help ?? "", ...(d.options ?? []).map((o) => o.label)]) if (!fitsFont2(s)) out.push({ rule: "font2", table: "SETTINGS", row: d.id, problem: `"${s}" does not fit the v2 font` });
      for (const a of ACTIONS) if (!fitsFont2(a.label)) out.push({ rule: "font2", table: "ACTIONS", row: a.id, problem: `"${a.label}" does not fit the v2 font` });
      return out;
    },
  },
  {
    id: "items", run: () => {
      const out: LintIssue[] = [];
      for (const [table, t] of Object.entries({ RECIPES, CRAFT_RECIPES, HARVEST, SHOPS, VISITS })) for (const [row, r] of rows(t)) for (const [p, id] of itemRefs(r)) {
        if (!(id in ITEMS)) out.push({ rule: "items", table, row, problem: `${p || "item"}: unknown item "${id}"` });
      }
      return out;
    },
  },
  {
    id: "props", run: () => {
      const out: LintIssue[] = [];
      for (const [row, r] of rows(RECIPES)) { const k = (r as { prop?: string }).prop; if (k && !(k in PROPS)) out.push({ rule: "props", table: "RECIPES", row, problem: `builds unknown prop kind "${k}"` }); }
      for (const k of Object.keys(HARVEST)) if (!(k in PROPS)) out.push({ rule: "props", table: "HARVEST", row: k, problem: `harvests unknown prop kind "${k}"` });
      return out;
    },
  },
  {
    id: "stations", run: () => rows(CRAFT_RECIPES).flatMap(([row, r]) => {
      const s = (r as { station?: string }).station;
      return s && !(s in STATIONS) ? [{ rule: "stations", table: "CRAFT_RECIPES", row, problem: `unknown station "${s}"` }] : [];
    }),
  },
  {
    id: "census", run: () => {
      const out: LintIssue[] = [];
      for (const r of CENSUS) {
        if (!(r.archetype in ARCHETYPES)) out.push({ rule: "census", table: "CENSUS", row: r.id, problem: `unknown archetype "${r.archetype}"` });
        if (r.routine && !(r.routine in ROUTINES)) out.push({ rule: "census", table: "CENSUS", row: r.id, problem: `unknown routine "${r.routine}"` });
        if (!(r.area in AREAS)) out.push({ rule: "census", table: "CENSUS", row: r.id, problem: `unknown area "${r.area}"` });
      }
      for (const [id, a] of Object.entries(ARCHETYPES)) for (const rt of (a as { routines?: string[] }).routines ?? []) if (!(rt in ROUTINES)) out.push({ rule: "census", table: "ARCHETYPES", row: id, problem: `unknown routine "${rt}"` });
      return out;
    },
  },
  {
    id: "ids", run: () => {
      const out: LintIssue[] = [];
      for (const [table, t] of Object.entries({ CENSUS, THOUGHTS, CRAFT_RECIPES })) {
        if (!Array.isArray(t)) continue;
        const seen = new Set<string>();
        for (const r of t as { id?: string }[]) { if (!r.id) continue; if (seen.has(r.id)) out.push({ rule: "ids", table, row: r.id, problem: "duplicate id" }); seen.add(r.id); }
      }
      return out;
    },
  },
  {
    id: "areas", run: () => {
      const out: LintIssue[] = [];
      for (const id of Object.keys(AREAS)) if (id.startsWith("gen.")) out.push({ rule: "areas", table: "AREAS", row: id, problem: `authored id in the generated namespace "gen."` });
      for (const k of Object.keys(AREA_KINDS)) if (k in AREAS) out.push({ rule: "areas", table: "AREA_KINDS", row: k, problem: "an area kind shares its name with an authored area" });
      return out;
    },
  },
];

/** Run every rule (or the named ones). An empty list means the content is clean. */
export function lintContent(only?: readonly string[]): LintIssue[] {
  return RULES.filter((r) => !only || only.includes(r.id)).flatMap((r) => r.run());
}
