// The particle system (presentation only): sparks, embers, dust, debris, drips,
// motes and smoke. Split out of game.ts. Randomness here is Math.random on
// purpose (see docs/engine/time.md): nothing in the World depends on it.

export type ParticleKind = "spark" | "ember" | "dust" | "debris" | "drip" | "splash" | "rune" | "mote" | "glint" | "smoke";

export interface Particle {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  life: number; max: number; kind: ParticleKind;
  col: string; emit: boolean; g: number; size: number;
}

/** Kinds that sort with the scene (drawn in depth order); the rest float over it. */
export const GROUNDED: ReadonlySet<ParticleKind> = new Set<ParticleKind>(["debris", "dust", "smoke", "splash"]);

export class ParticleSystem {
  list: Particle[] = [];
  /** No more than this many at once (a burst past it is simply thinner). */
  cap = 900;
  /** A drip hit the floor (the host plays the sound at its volume). */
  onDrip: ((p: Particle) => void) | null = null;

  spawn(p: Partial<Particle> & { x: number; y: number }) {
    if (this.list.length > this.cap) return;
    this.list.push({ z: 0, vx: 0, vy: 0, vz: 0, life: 1, max: p.life ?? 1, kind: "dust", col: "#888", emit: false, g: 0, size: 1, ...p } as Particle);
  }

  clear() { this.list = []; }

  update(dt: number) {
    const ps = this.list;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt / p.max;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vz -= p.g * dt;
      p.z += p.vz * dt;
      if (p.kind === "debris" || p.kind === "spark" || p.kind === "dust") {
        if (p.z < 0) { p.z = 0; p.vz = -p.vz * 0.35; p.vx *= 0.6; p.vy *= 0.6; }
      }
      if (p.kind === "drip" && p.z <= 0) {
        for (let k = 0; k < 5; k++) this.spawn({ x: p.x, y: p.y, z: 0, vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 8, vz: 12 + Math.random() * 8, life: 0.35, kind: "splash", col: "#7a9ab8", g: 80 });
        this.onDrip?.(p);
        p.life = 0;
      }
      if (p.kind === "mote") { p.vx += (Math.random() - 0.5) * dt * 4; p.vz += (Math.random() - 0.5) * dt * 4; }
      if (p.kind === "smoke") { p.vx *= 0.97; p.vy *= 0.97; }
      if (p.life <= 0) ps.splice(i, 1);
    }
  }
}
