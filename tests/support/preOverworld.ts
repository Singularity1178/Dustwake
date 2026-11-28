// The inverse of save migration 20 -> 21 (src/game/world/save.ts: toOverworld), for tests.
//
// Many tests make "an old save" by serializing a world of today and stamping an older version on it. Since v21
// that is no longer what an old save looked like: before the overworld, Westwake was an area of its own (`town`)
// and the surface's map began where the ruins now lie. `preOverworld` rewrites a v21-shaped save into the shape
// v20 had (the town's content back in a `town` area, both maps in their own coordinates, the old census flags), so
// that stamping an old version on the result gives a faithful old save: migrating it brings back the save it was
// made from, exactly. tests/overworld.test.ts holds that round trip.
//
// Frozen numbers, as in the migration: where v21 set the two maps down. (Nothing that stands on the old road can be
// expressed in a v20 save, which had no such ground; the tests that use this put nothing there.)
type Site = { tx: number; ty: number; w: number; prefix: string; zone: string; area: string };
const TOWN: Site = { tx: 0, ty: 3, w: 96, prefix: "westwake/", zone: "westwake", area: "town" };
const WILD: Site = { tx: 144, ty: 0, w: 96, prefix: "", zone: "ruins", area: "surface" };
const W = 240, TS = 16, OVER = "surface";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function preOverworld(s: any): any {
  const siteAt = (x: number) => (x < TOWN.w * TS ? TOWN : WILD);
  const siteOfId = (id: string) => (id.startsWith(TOWN.prefix) ? TOWN : WILD);
  const bare = (id: any, m: Site) => (typeof id === "string" && m.prefix && id.startsWith(m.prefix) ? id.slice(m.prefix.length) : id);
  const un = (o: any, m: Site) => (o && typeof o.x === "number" && typeof o.y === "number" ? { ...o, x: o.x - m.tx * TS, y: o.y - m.ty * TS } : o);
  const ref = (r: any) => { if (!r || typeof r !== "object" || r.area !== OVER || typeof r.prop !== "string") return r; const m = siteOfId(r.prop); return { ...r, area: m.area, prop: bare(r.prop, m) }; };
  const task = (t: any, here: Site | null) => {
    const m = t?.area === OVER || (t && t.area === undefined && here) ? (t.target && typeof t.target.x === "number" ? siteAt(t.target.x) : here ?? WILD) : null;
    if (!t || !m) return t;
    const o = { ...t };
    if (t.area) o.area = m.area;
    if (t.target) {
      const g = { ...un(t.target, m) };
      if (typeof g.propId === "string") g.propId = bare(g.propId, m);
      if (typeof g.looseId === "string") g.looseId = bare(g.looseId, m);
      if (typeof g.tx === "number" && typeof g.ty === "number") { g.tx -= m.tx; g.ty -= m.ty; }
      o.target = g;
    }
    if (t.effect?.op === "build" && typeof t.effect.tx === "number") o.effect = { ...t.effect, tx: t.effect.tx - m.tx, ty: t.effect.ty - m.ty };
    return o;
  };
  const actors = (s.actors ?? []).map((a: any) => {
    const here: Site | null = a.area === OVER ? (a.person?.zone === TOWN.zone ? TOWN : a.person?.zone === WILD.zone ? WILD : siteAt(a.x)) : null;
    const o: any = here ? { ...un(a, here), area: here.area } : { ...a };
    o.task = task(a.task, here);
    o.queue = (a.queue ?? []).map((t: any) => task(t, here));
    if (a.job) {
      const args: any = { ...(a.job.args ?? {}) };
      if (args.fromArea === OVER && (args.fromZone === TOWN.zone || args.fromZone === WILD.zone)) { args.fromArea = args.fromZone === TOWN.zone ? TOWN.area : WILD.area; delete args.fromZone; }
      if (args.storage) args.storage = ref(args.storage);
      if (args.station) args.station = ref(args.station);
      if (a.job.kind === "walk" && args.area === OVER) { const m = siteAt(args.x), p = un({ x: args.x, y: args.y }, m); args.x = p.x; args.y = p.y; args.area = m.area; }
      o.job = { ...a.job, args, target: ref(a.job.target), nav: a.job.nav && here ? { ...a.job.nav, path: a.job.nav.path.map((p: any) => un(p, here)) } : a.job.nav };
    }
    if (a.person?.origin === OVER && a.person.zone) {
      const { zone, ...person } = a.person;
      o.person = { ...person, origin: zone === TOWN.zone ? TOWN.area : WILD.area };
    }
    if (a.life) {
      const L: any = { ...a.life };
      if (here) { if (L.goal) L.goal = un(L.goal, here); L.path = (L.path ?? []).map((p: any) => un(p, here)); }
      if (L.duty?.area === OVER) { const m = siteAt(L.duty.x); L.duty = { ...un(L.duty, m), area: m.area }; }
      o.life = L;
    }
    return o;
  });

  const areas: Record<string, any> = { ...(s.areas ?? {}) };
  const d = areas[OVER];
  if (d) {
    const blank = () => ({ tiles: [] as any[], props: {} as Record<string, any>, looseTaken: [] as string[], looseAdded: [] as any[], looseSeq: d.looseSeq, propsAdded: [] as any[], propSeq: d.propSeq, propsRemoved: [] as string[], decalsAdded: [] as any[], ritual: null as any });
    const parts = new Map<Site, ReturnType<typeof blank>>([[WILD, blank()], [TOWN, blank()]]);
    const of = (m: Site) => parts.get(m)!;
    const known = (id: string) => !id.startsWith("oldroad/");
    for (const [i, t] of d.tiles ?? []) {
      const x = i % W, y = Math.floor(i / W), m = x >= WILD.tx ? WILD : TOWN;
      of(m).tiles.push([(y - m.ty) * m.w + x - m.tx, t]);
    }
    for (const [id, st] of Object.entries(d.props ?? {})) if (known(id)) { const m = siteOfId(id); of(m).props[bare(id, m)] = st; }
    for (const id of d.looseTaken ?? []) if (known(id)) { const m = siteOfId(id); of(m).looseTaken.push(bare(id, m)); }
    for (const id of d.propsRemoved ?? []) if (known(id)) { const m = siteOfId(id); of(m).propsRemoved.push(bare(id, m)); }
    for (const l of d.looseAdded ?? []) { const m = l.id.startsWith(TOWN.prefix) ? TOWN : siteAt(l.x); of(m).looseAdded.push({ ...un(l, m), id: bare(l.id, m) }); }
    for (const p of d.propsAdded ?? []) { const m = p.id.startsWith(TOWN.prefix) ? TOWN : siteAt(p.x); of(m).propsAdded.push({ ...un(p, m), id: bare(p.id, m) }); }
    for (const c of d.decalsAdded ?? []) { const m = siteAt(c.x); of(m).decalsAdded.push(un(c, m)); }
    const extra = { ...(d.lastTicked !== undefined ? { lastTicked: d.lastTicked } : {}) };
    areas[OVER] = { ...of(WILD), ritual: d.ritual ?? null, ...extra };
    const t = of(TOWN);
    if (t.tiles.length || Object.keys(t.props).length || t.looseTaken.length || t.looseAdded.length || t.propsAdded.length || t.propsRemoved.length || t.decalsAdded.length) areas[TOWN.area] = { ...t, ...extra };
  }
  const FLAGS: Record<string, string> = { "census.westwake": "census.town", "census.ruins": "census.surface" };
  // (v22's record of where the golem has been goes too: no save before v22 had one, so migrating the result has to
  // work it out again, and the tests that compare against the save this was made from hold that it comes out the same)
  const out = { ...s, version: 20, actors, areas, flags: (s.flags ?? []).map((f: string) => FLAGS[f] ?? f) };
  delete out.discovered;
  return out;
}
