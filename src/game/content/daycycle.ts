// The day/night cycle (data and pure maths: no DOM, no World).
//
// The World keeps one calendar clock, `world.day`: days since the world began,
// as a float whose fraction is the time of day (0 = midnight, 0.5 = noon).
// sim/daytime.ts advances it; everything else is derived from the hour:
//
//   - the sky: how much sun there is (`sunLevel`), the twilight tint, and from
//     them the ambient light of an area by how exposed it is to the sky
//     (`ambientAt`: open air, a room with windows, or buried and unaffected);
//   - lamps against daylight (`lampGain`): a flame that fills a street at night
//     is barely seen at noon;
//   - sky light reaching in (`skyLight`): the shaft through the throne room's
//     broken roof is moonlight by night and a sunbeam by day;
//   - who tends which light (`litLevel`): where people live, lights follow the
//     day. Each kind has its own habit, and each lamp its own minute, so a
//     town lights up and goes dark the way a town does, not like a switch.
//
// Nothing here is stored: a save holds the clock and nothing else.

/** World seconds in one full day. 30 s to the hour: six minutes of day, four of night, a minute each of dawn and dusk. */
export const DAY_SECONDS = 720;

/** The hours the day turns on. Dawn runs dawn -> sunrise, dusk runs dusk -> nightfall. */
export const DAY_HOURS = { dawn: 5, sunrise: 7, dusk: 19, nightfall: 21 } as const;

/** The golem wakes in the night. */
export const START_HOUR = 22.5;
/** The first crossing to the surface lands in the last dark before dawn (sim/runes.ts), however long the halls took. */
export const FIRST_ARRIVAL_HOUR = 4;
/** Where the clock stands when the crossing cutscene ends (watched or skipped): dawn, the sun nearly up. */
export const FIRST_MORNING_HOUR = 6.6;

export type DayPhase = "night" | "dawn" | "day" | "dusk";
export type RGB = [number, number, number];
/** How much of the sky an area sees: open air, a room with windows and a door, or under the earth. */
export type Exposure = "outdoor" | "interior" | "buried";

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

export const wrapHour = (h: number) => ((h % 24) + 24) % 24;
/** The hour of the day (0..24) of a calendar clock value. */
export const hourOf = (day: number) => wrapHour((day - Math.floor(day)) * 24);

export function phaseAt(hour: number): DayPhase {
  const h = wrapHour(hour), D = DAY_HOURS;
  return h < D.dawn ? "night" : h < D.sunrise ? "dawn" : h < D.dusk ? "day" : h < D.nightfall ? "dusk" : "night";
}

/** How much sun there is: 0 through the night, easing up across dawn, 1 all day, easing down across dusk. */
export function sunLevel(hour: number): number {
  const h = wrapHour(hour), D = DAY_HOURS;
  if (h < D.dawn || h >= D.nightfall) return 0;
  if (h < D.sunrise) return smooth((h - D.dawn) / (D.sunrise - D.dawn));
  if (h < D.dusk) return 1;
  return 1 - smooth((h - D.dusk) / (D.nightfall - D.dusk));
}

/** How deep into a twilight the hour is: 0 outside dawn and dusk, 1 at the middle of either. */
export function twilight(hour: number): number {
  const h = wrapHour(hour), D = DAY_HOURS;
  if (h >= D.dawn && h < D.sunrise) return Math.sin((Math.PI * (h - D.dawn)) / (D.sunrise - D.dawn));
  if (h >= D.dusk && h < D.nightfall) return Math.sin((Math.PI * (h - D.dusk)) / (D.nightfall - D.dusk));
  return 0;
}

/** The sky's colours. An area's own `ambient` is its night; these are what the sun adds. */
export const SKY = {
  /** Full daylight in the open: a touch warm (the dithered lighting keeps a little grain in it). */
  day: [1.0, 0.97, 0.9] as RGB,
  /** Added at the height of dawn: rose and gold. */
  dawnTint: [0.2, 0.04, -0.04] as RGB,
  /** Added at the height of dusk: amber, the blue already going. */
  duskTint: [0.24, 0.02, -0.08] as RGB,
  /** Daylight as it reaches a room through its windows and its door. */
  indoorDay: [0.72, 0.68, 0.6] as RGB,
  /** A shaft of sky light by day (by night it keeps the colour it was authored with: moonlight). */
  sunbeam: [1, 0.86, 0.6] as RGB,
  /** How much a lamp still counts at full sun, in the open and in a room. */
  lampInSun: 0.16, lampIndoorsByDay: 0.6,
} as const;

/** An area's ambient light at `hour`. `night` is the ambient it was authored with. Buried areas never change. */
export function ambientAt(night: RGB, hour: number, exposure: Exposure): RGB {
  if (exposure === "buried") return night;
  const s = sunLevel(hour), tw = twilight(hour);
  if (exposure === "interior") {
    const tint = wrapHour(hour) < 12 ? SKY.dawnTint : SKY.duskTint, base = mix(night, SKY.indoorDay, s);
    return [base[0] + tint[0] * tw * 0.4, base[1] + tint[1] * tw * 0.4, base[2] + tint[2] * tw * 0.4];
  }
  const tint = wrapHour(hour) < 12 ? SKY.dawnTint : SKY.duskTint, base = mix(night, SKY.day, s);
  return [base[0] + tint[0] * tw, base[1] + tint[1] * tw, base[2] + tint[2] * tw];
}

/** How much lamp and glow light counts against the daylight (1 at night, little at noon; always 1 under the earth). */
export function lampGain(hour: number, exposure: Exposure): number {
  if (exposure === "buried") return 1;
  const s = sunLevel(hour);
  return 1 - s * (1 - (exposure === "interior" ? SKY.lampIndoorsByDay : SKY.lampInSun));
}

/** Sky light reaching in (a roof crack, a doorway): its colour and strength at `hour`. `night` is its authored colour. */
export function skyLight(night: RGB, hour: number): { col: RGB; gain: number } {
  const s = sunLevel(hour), tw = twilight(hour), tint = wrapHour(hour) < 12 ? SKY.dawnTint : SKY.duskTint;
  const c = mix(night, SKY.sunbeam, s);
  return { col: [c[0] + tint[0] * tw, c[1] + tint[1] * tw * 0.5, Math.max(0, c[2] + tint[2] * tw)], gain: 1 + 0.35 * s };
}

/** "06:40": the hour as a clock reads it, to the ten minutes. */
export function clockText(hour: number): string {
  const m = Math.floor((wrapHour(hour) * 60) / 10) * 10;
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- tended lights
/**
 * How a light is kept where people live (areas with `tended`, map.ts):
 *   rune    a light rune answers the dark by itself. It wakes as the sun fails
 *           and sleeps as it returns; nobody lights it, nobody can forget to.
 *   fire    a torch, a lantern, a brazier: lit by hand some time after dusk and
 *           doused some time after dawn, each when somebody gets round to it.
 *   window  a lamp behind glass: lit when the house comes home, out when it
 *           goes to bed (some early, some very late), and a few are up again
 *           before dawn.
 */
export type LightHabit = "rune" | "fire" | "window";

/** A stable 0..1 number for an id (FNV-1a): each lamp's own minute. */
export function hash01(id: string, salt = 0): number {
  let h = (0x811c9dc5 ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** 1 from `on` to `off` (hours, wrapping past midnight), easing over `fade` hours at each end; 0 outside. */
function span(h: number, on: number, off: number, fade: number): number {
  const len = wrapHour(off - on), d = wrapHour(h - on);
  if (d >= len) return 0;
  return Math.min(1, d / fade, (len - d) / fade);
}

/** How lit (0..1) the tended light `id` is at `hour`. Pure: the same lamp keeps the same hours every day. */
export function litLevel(habit: LightHabit, id: string, hour: number): number {
  const h = wrapHour(hour), a = hash01(id, 1), b = hash01(id, 2);
  if (habit === "rune") {
    const edge = 0.42 + (a - 0.5) * 0.1; // each stone trips at a slightly different dark: a ripple down the street
    return smooth((edge + 0.06 - sunLevel(h)) / 0.12);
  }
  if (habit === "fire") return span(h, 19.5 + a * 1.2, 6.3 + b * 0.9, 0.08);
  const evening = span(h, 19.2 + a * 1.5, 22 + b * 3.5, 0.06);
  const early = hash01(id, 3) < 0.4 ? span(h, 4.6 + a * 1.1, 6.4 + b * 0.8, 0.06) : 0;
  return Math.max(evening, early);
}

/** Chimneys where people live: thick at breakfast and supper, thin at noon, a thread through the night (a rate multiplier). */
export const hearthSmoke = (hour: number) => {
  const h = wrapHour(hour);
  return 0.3 + 0.7 * Math.max(Math.exp(-(((h - 7) / 1.6) ** 2)), Math.exp(-(((h - 19.5) / 2) ** 2)));
};
