// Dungeon prop sprites: furniture, fittings, light sources, the ritual
// pedestal, workshop and treasury props. Registered into PROP_ART by art/props.ts.
import type { Pen, Rng } from "../util";
import { S, WD, IR, CL, GD, BN } from "./palette";
import { stoneBlob, type PropArt } from "./common";

function books(p: Pen, x: number, y: number, w: number, h: number, r: Rng, sparse = 0) {
  const cols = ["#6a2a2a", "#2a3a6a", "#3a5a2a", "#6a5a2a", "#5a2a5a", "#7a6a50"];
  let i = 0;
  while (i < w) {
    const bw = r() < 0.7 ? 1 : 2;
    if (r() < 0.15 + sparse) { i += 1 + ((r() * 2) | 0); continue; }
    const bh = h - ((r() * 2) | 0);
    const c = cols[(r() * cols.length) | 0];
    p.r(x + i, y + h - bh, bw, bh, c);
    p.p(x + i, y + h - bh, "#c0b090");
    i += bw;
  }
}

export const DUNGEON_PROP_ART: Record<string, PropArt> = {
  torch: (_v, alt, M) => {
    return M(8, 16, (p) => {
      p.r(2, 12, 4, 2, IR.d); p.r(3, 9, 2, 4, IR.m);
      p.r(2, 5, 4, 3, IR.m); p.r(2, 5, 4, 1, IR.l);
      p.r(3, 2, 2, 4, WD.m); p.p(3, 2, WD.l);
      if (!alt) p.r(3, 1, 2, 2, "#120e0c");
      else p.g(3, 1, 2, 2, "#ff9a3a");
    });
  },
  banner: (v, _alt, M) => {
    return M(14, 16, (p, r) => {
      p.r(0, 1, 14, 1, IR.l); p.p(0, 0, IR.h); p.p(13, 0, IR.h);
      for (let y = 2; y < 15; y++)
        for (let x = 2; x < 12; x++) {
          let cut = 15;
          if (v === 0) cut = 13 + ((r() * 3) | 0) - (x % 3 === 0 ? 2 : 0);
          if (v === 1) cut = x < 7 ? 9 + ((r() * 2) | 0) : 14 - ((r() * 2) | 0);
          if (v === 2) cut = 4 + x;
          if (y > cut) continue;
          const border = x === 2 || x === 11;
          let c = border ? GD.d : y % 5 === 0 ? CL.d : CL.m;
          if (x === 3 || x === 10) c = CL.l;
          p.p(x, y, c);
        }
      // sigil: eye in triangle
      if (v !== 2) { p.r(6, 5, 2, 1, GD.m); p.r(5, 6, 4, 1, GD.m); p.r(4, 7, 6, 1, GD.d); p.p(6, 6, "#1a0808"); p.p(7, 6, "#1a0808"); }
    });
  },
  chains: (_v, _alt, M) => {
    return M(10, 16, (p) => {
      p.r(1, 1, 8, 2, IR.d);
      for (let j = 0; j < 5; j++) { p.p(2, 3 + j * 2, j % 2 ? IR.l : IR.m); p.p(7, 3 + j * 2, j % 2 ? IR.m : IR.l); }
      p.o(1, 12, 3, 3, IR.d, IR.l); p.o(6, 12, 3, 3, IR.d, IR.l);
    });
  },
  bookshelf: (v, _alt, M) => {
    return M(16, 28, (p, r) => {
      p.o(0, 0, 16, 28, WD.d, WD.o);
      p.r(1, 1, 14, 3, WD.l); p.r(1, 1, 14, 1, WD.h);
      for (let s = 0; s < 3; s++) {
        const y = 5 + s * 7;
        p.r(1, y, 14, 6, "#140c08");
        if (v === 1) {
          for (let k = 0; k < 3; k++) if (r() < 0.8) { const x = 2 + k * 4; p.r(x, y + 2, 3, 4, ["#3a5a4a", "#5a4a3a", "#4a4a6a"][k]); p.p(x + 1, y + 1, "#7a7a6a"); p.p(x, y + 3, "#8aa090"); }
        } else if (v === 3) {
          for (let k = 0; k < 3; k++) if (r() < 0.8) { const x = 2 + k * 4; p.r(x, y + 2, 3, 4, "#7a4a2a"); p.r(x, y + 2, 3, 1, "#9a6a40"); }
        } else books(p, 1, y + 1, 14, 5, r, v === 2 ? 0.35 : 0);
        p.r(1, y + 6, 14, 1, WD.m);
      }
      if (v === 2) { p.r(2, 14, 12, 1, "#140c08"); p.line(2, 13, 13, 18, WD.m); }
    });
  },
  shelfrow: (v, _alt, M) => {
    return M(16, 22, (p, r) => {
      p.o(0, 0, 16, 22, WD.d, WD.o);
      p.r(1, 1, 14, 4, WD.l); p.r(1, 1, 14, 1, WD.h);
      for (let s = 0; s < 2; s++) { const y = 6 + s * 7; p.r(1, y, 14, 6, "#140c08"); books(p, 1, y + 1, 14, 5, r, v * 0.12); p.r(1, y + 6, 14, 1, WD.m); }
    });
  },
  shelf_fallen: (_v, _alt, M) => {
    return M(34, 18, (p, r) => {
      for (let i = 0; i < 9; i++) { const c = ["#6a2a2a", "#2a3a6a", "#3a5a2a", "#6a5a2a"][(r() * 4) | 0]; const bx = (r() * 32) | 0, by = 11 + ((r() * 6) | 0); p.r(bx, by, 3, 2, c); p.p(bx, by, "#c0b090"); }
      p.o(2, 2, 30, 11, WD.m, WD.o);
      p.r(3, 3, 28, 2, WD.l);
      for (let x = 8; x < 30; x += 7) p.r(x, 3, 1, 9, WD.d);
      p.r(3, 12, 28, 1, WD.o);
    });
  },
  table: (v, _alt, M) => {
    return M(28, 16, (p) => {
      p.r(2, 11, 2, 5, WD.o); p.r(24, 11, 2, 5, WD.o);
      p.o(0, 0, 28, 12, WD.l, WD.o);
      p.r(1, 1, 26, 1, WD.h); p.r(1, 5, 26, 1, WD.m); p.r(1, 9, 26, 2, WD.d);
      if (v === 1) {
        p.r(4, 3, 8, 5, "#a89a7c"); p.r(8, 3, 1, 5, "#6a604c"); p.r(5, 4, 2, 1, "#5a5040"); p.r(9, 5, 2, 1, "#5a5040");
        p.r(20, 3, 3, 4, "#d8d0b8"); p.r(20, 7, 3, 1, "#8a826a");
      }
    });
  },
  lectern: (_v, _alt, M) => {
    return M(14, 22, (p) => {
      p.o(4, 9, 6, 11, S.m, S.o); p.r(5, 10, 1, 9, S.h);
      p.o(2, 19, 10, 3, S.l, S.o);
      p.o(0, 3, 14, 8, WD.m, WD.o); p.r(1, 4, 12, 2, WD.l);
      p.r(2, 5, 10, 4, "#9a8e72"); p.r(7, 5, 1, 4, "#6a604c");
    });
  },
  chair: (_v, _alt, M) => {
    return M(10, 14, (p) => {
      p.o(1, 0, 8, 6, WD.m, WD.o); p.r(2, 1, 6, 1, WD.l);
      p.o(0, 6, 10, 5, WD.l, WD.o);
      p.r(1, 11, 2, 3, WD.o); p.r(7, 11, 2, 3, WD.o);
    });
  },
  chair_fallen: (_v, _alt, M) => {
    return M(14, 10, (p) => {
      p.o(0, 3, 9, 6, WD.l, WD.o); p.o(8, 1, 6, 8, WD.m, WD.o); p.r(1, 2, 2, 2, WD.o); p.r(5, 1, 2, 2, WD.o);
    });
  },
  bed: (v, _alt, M) => {
    return M(16, 30, (p, r) => {
      p.o(0, 0, 16, 30, WD.m, WD.o);
      p.r(1, 1, 14, 2, WD.l);
      p.r(2, 3, 12, 25, "#4a4234");
      for (let i = 0; i < 20; i++) p.p(2 + ((r() * 12) | 0), 3 + ((r() * 25) | 0), "#3a3428");
      p.o(3, 3, 10, 5, "#6a6250", "#2a261e");
      for (let y = 11; y < 27; y++) for (let x = 2; x < 14; x++) {
        if (y > 22 && r() < 0.3) continue;
        p.p(x, y, (x + y) % 4 === 0 ? "#2a3444" : "#3a4658");
      }
      if (v === 1) { p.r(0, 14, 16, 2, WD.o); p.r(2, 15, 12, 1, "#1a1410"); }
      p.r(1, 28, 14, 1, WD.d);
    });
  },
  footlocker: (_v, alt, M) => {
    return M(14, 11, (p) => {
      if (alt) {
        p.o(1, 0, 12, 4, WD.d, WD.o);
        p.o(0, 3, 14, 8, WD.m, WD.o); p.r(1, 4, 12, 3, "#120c08");
        p.r(0, 8, 14, 1, IR.m);
      } else {
        p.o(0, 1, 14, 10, WD.m, WD.o);
        p.r(1, 2, 12, 3, WD.l); p.r(1, 5, 12, 1, WD.o);
        p.r(3, 1, 1, 10, IR.m); p.r(10, 1, 1, 10, IR.m);
        p.r(6, 5, 2, 2, GD.d);
      }
    });
  },
  weaponrack: (_v, _alt, M) => {
    return M(24, 22, (p) => {
      p.r(1, 2, 2, 20, WD.o); p.r(21, 2, 2, 20, WD.o);
      p.r(0, 4, 24, 2, WD.m); p.r(0, 15, 24, 2, WD.m); p.r(0, 4, 24, 1, WD.l);
      p.r(6, 0, 1, 20, WD.l); p.r(5, 0, 3, 3, IR.l); p.p(6, 0, IR.h);
      p.r(16, 3, 1, 17, WD.l); p.r(15, 2, 3, 2, "#6a4a3a");
      p.line(10, 6, 13, 19, IR.d);
    });
  },
  limbrack: (_v, alt, M) => {
    return M(22, 28, (p) => {
      p.r(1, 0, 3, 28, IR.d); p.r(18, 0, 3, 28, IR.d); p.r(1, 0, 1, 28, IR.l); p.r(18, 0, 1, 28, IR.l);
      p.r(0, 2, 22, 3, IR.m); p.r(0, 2, 22, 1, IR.l);
      p.r(0, 24, 22, 3, IR.d);
      for (const x of [7, 11, 15]) { p.r(x, 5, 1, 3, IR.l); p.p(x + 1, 7, IR.l); }
      if (alt) { p.p(7, 9, IR.m); p.p(7, 11, IR.d); p.p(15, 9, IR.m); }
    });
  },
  armorstand: (v, _alt, M) => {
    if (v === 1)
      return M(18, 10, (p) => {
        p.r(1, 6, 14, 2, WD.m); p.r(1, 6, 14, 1, WD.l);
        p.o(11, 1, 7, 6, IR.m, IR.d); p.r(12, 3, 5, 1, "#101010");
      });
    return M(12, 22, (p) => {
      p.r(5, 6, 2, 14, WD.m); p.r(1, 9, 10, 2, WD.m); p.r(2, 20, 8, 2, WD.d);
      p.o(3, 0, 6, 7, IR.m, IR.d); p.r(4, 3, 4, 1, "#101010"); p.p(4, 1, IR.h);
    });
  },
  barrel: (v, _alt, M) => {
    if (v === 1)
      return M(14, 12, (p) => {
        p.r(0, 8, 5, 3, WD.m); p.r(9, 9, 5, 2, WD.d);
        p.o(2, 2, 10, 8, WD.m, WD.o); p.r(3, 3, 8, 3, "#1a1008"); p.r(2, 6, 10, 1, IR.m);
      });
    return M(12, 15, (p) => {
      p.o(0, 2, 12, 13, WD.m, WD.o);
      p.r(1, 3, 2, 11, WD.l); p.r(9, 3, 2, 11, WD.d);
      p.r(0, 5, 12, 1, IR.m); p.r(0, 11, 12, 1, IR.m);
      p.o(1, 0, 10, 4, WD.l, WD.o); p.r(3, 1, 6, 1, WD.h);
    });
  },
  crate: (v, _alt, M) => {
    if (v === 1)
      return M(16, 14, (p) => {
        p.o(1, 3, 14, 11, WD.m, WD.o); p.r(2, 4, 12, 4, "#160e08");
        p.line(2, 9, 13, 13, WD.l);
        p.r(0, 1, 6, 2, WD.l); p.r(11, 2, 5, 1, WD.d);
      });
    return M(14, 15, (p) => {
      p.o(0, 4, 14, 11, WD.m, WD.o);
      p.line(1, 5, 12, 13, WD.l); p.line(12, 5, 1, 13, WD.d);
      p.o(0, 0, 14, 5, WD.l, WD.o); p.r(1, 2, 12, 1, WD.m);
    });
  },
  sack: (_v, _alt, M) => {
    return M(10, 9, (p) => {
      p.o(0, 2, 10, 7, "#7a6a48", "#2a2216"); p.r(1, 3, 3, 3, "#9a8a60"); p.r(3, 0, 4, 3, "#5a4a30");
    });
  },
  statue: (v, _alt, M) => {
    return M(20, 38, (p) => {
      // pedestal
      p.o(0, 28, 20, 10, S.l, S.o); p.r(1, 29, 18, 1, S.h); p.r(1, 32, 18, 1, S.m); p.r(1, 36, 18, 1, S.d);
      // legs
      p.o(4, 22, 5, 7, S.l, S.o); p.o(11, 22, 5, 7, S.l, S.o);
      // torso
      p.o(2, 10, 16, 13, S.l, S.o); p.r(3, 11, 14, 2, S.h); p.r(14, 13, 3, 9, S.m);
      p.r(8, 15, 4, 3, S.m);
      // arms + greatsword planted
      p.o(0, 11, 4, 11, S.l, S.o); p.o(16, 11, 4, 11, S.m, S.o);
      p.r(9, 16, 2, 22, IR.d); p.r(9, 16, 1, 22, IR.l); p.r(6, 20, 8, 2, IR.m);
      if (v === 1) {
        p.r(7, 8, 6, 3, S.d); p.p(8, 8, S.o); p.p(11, 9, S.o);
        p.p(10, 13, S.o); p.p(11, 14, S.o); p.p(11, 15, S.o); p.p(12, 16, S.o);
      } else {
        p.o(5, 3, 10, 9, S.l, S.o); p.r(6, 4, 8, 2, S.h); p.r(7, 7, 6, 1, "#1a1620"); p.r(12, 5, 2, 6, S.m);
      }
    });
  },
  statue_fallen: (v, _alt, M) => {
    return M(36, 18, (p, r) => {
      p.o(2, 4, 22, 12, S.l, S.o); p.r(3, 5, 20, 2, S.h); p.r(3, 13, 20, 2, S.d);
      p.o(0, 2, 6, 6, S.m, S.o); p.o(18, 0, 6, 5, S.l, S.o);
      p.p(10, 8, S.o); p.p(11, 9, S.o); p.p(12, 9, S.o); p.p(13, 10, S.o);
      if (v === 0) { p.o(27, 6, 9, 8, S.l, S.o); p.r(29, 9, 1, 4, "#1a1620"); p.r(28, 7, 7, 1, S.h); }
      stoneBlob(p, 24, 12, 5, 5, r); stoneBlob(p, 30, 13, 4, 4, r);
    });
  },
  throne: (_v, _alt, M) => {
    return M(32, 36, (p, r) => {
      p.o(0, 28, 32, 8, S.l, S.o); p.r(1, 29, 30, 1, S.h); p.r(1, 34, 30, 1, S.d);
      // back
      p.o(6, 0, 20, 22, S.m, S.o);
      p.r(7, 1, 18, 2, GD.d); p.r(8, 4, 16, 16, CL.d);
      for (let i = 0; i < 30; i++) p.p(8 + ((r() * 16) | 0), 4 + ((r() * 16) | 0), CL.m);
      p.r(7, 3, 1, 18, GD.m); p.r(24, 3, 1, 18, GD.d);
      p.r(15, 1, 2, 3, GD.l);
      // broken top-right chunk
      for (let x = 19; x < 26; x++) for (let y = 0; y < 26 - x; y++) p.r(x, y, 1, 1, "rgba(0,0,0,0)");
      p.ctx.clearRect(p.flip ? 0 : 19, 0, 7, 6);
      p.line(18, 0, 26, 7, S.o);
      p.line(12, 6, 16, 14, "#140808"); p.line(16, 14, 14, 19, "#140808");
      // seat
      p.o(3, 18, 26, 11, S.l, S.o); p.r(5, 19, 22, 6, CL.m); p.r(5, 19, 22, 1, CL.l); p.r(4, 26, 24, 1, GD.d);
      // armrests (right broken)
      p.o(0, 14, 6, 15, S.l, S.o); p.r(1, 15, 4, 1, GD.l);
      p.o(26, 22, 6, 7, S.d, S.o);
      p.r(1, 2, 1, 1, S.o);
    });
  },
  maptable: (_v, alt, M) => {
    return M(30, 18, (p) => {
      p.r(3, 12, 2, 6, WD.o); p.r(25, 12, 2, 6, WD.o);
      p.o(0, 0, 30, 13, WD.l, WD.o); p.r(1, 11, 28, 1, WD.d);
      if (!alt) {
        p.r(3, 2, 14, 8, "#2a4a7a"); p.r(4, 3, 12, 6, "#34588a");
        for (let i = 0; i < 4; i++) p.r(5 + i * 3, 4, 1, 4, "#a8c0e0");
        p.r(5, 4, 10, 1, "#a8c0e0"); p.r(5, 7, 10, 1, "#a8c0e0");
        p.r(19, 3, 9, 2, "#3a5a9a"); p.r(19, 3, 1, 2, "#d0d8e8"); p.r(27, 3, 1, 2, "#d0d8e8");
      } else {
        p.r(4, 3, 5, 4, "#8a7e64"); p.r(18, 6, 4, 3, "#7a6e54"); p.r(12, 2, 2, 2, "#141414");
      }
    });
  },
  altar: (_v, _alt, M) => {
    return M(30, 20, (p) => {
      p.o(0, 4, 30, 16, S.l, S.o); p.r(1, 5, 28, 4, S.h); p.r(1, 17, 28, 2, S.d);
      p.r(10, 5, 10, 14, CL.m); p.r(10, 5, 10, 1, CL.l); p.r(10, 17, 10, 2, GD.d); p.r(14, 11, 2, 4, GD.m); p.r(13, 12, 4, 1, GD.m);
      for (const x of [3, 6, 24]) { p.r(x, 1, 2, 5, "#d8d0b0"); p.g(x, 0, 1, 1, "#ffb050"); p.g(x + 1, 0, 1, 1, "#ffe090"); }
      p.r(26, 3, 2, 3, "#c8c0a0");
    });
  },
  pew: (_v, _alt, M) => {
    return M(38, 13, (p) => {
      p.o(0, 0, 38, 5, WD.m, WD.o); p.r(1, 1, 36, 1, WD.l);
      p.o(0, 5, 38, 5, WD.l, WD.o);
      p.r(2, 10, 2, 3, WD.o); p.r(34, 10, 2, 3, WD.o); p.r(18, 10, 2, 3, WD.o);
    });
  },
  workbench: (_v, _alt, M) => {
    return M(32, 30, (p) => {
      p.o(2, 0, 28, 10, WD.d, WD.o);
      p.r(5, 2, 1, 6, IR.l); p.r(4, 2, 3, 2, IR.m);
      p.r(10, 2, 1, 6, WD.l); p.r(9, 2, 3, 1, IR.l);
      p.r(15, 3, 4, 4, "#0e0a08"); p.r(15, 3, 4, 1, IR.m);
      p.line(22, 2, 26, 7, IR.l);
      p.r(3, 24, 2, 6, WD.o); p.r(27, 24, 2, 6, WD.o);
      p.o(0, 10, 32, 15, WD.l, WD.o); p.r(1, 11, 30, 1, WD.h); p.r(1, 22, 30, 2, WD.d);
      p.r(1, 17, 30, 1, WD.m);
      p.o(24, 12, 6, 5, IR.m, IR.d);
      p.r(3, 13, 6, 2, "#9a907a"); p.r(4, 18, 3, 3, IR.d);
    });
  },
  // ---------- buildables (content/build.ts)
  // (The CRAFTING BENCH recipe builds the dungeon's own `workbench` prop, so it has no sprite of its own.)
  /** Sharpened stakes lashed to a rail. */
  barricade: (_v, _alt, M) => {
    return M(18, 18, (p) => {
      p.r(1, 16, 16, 2, "rgba(0,0,0,0.35)");
      for (const x of [1, 7, 13]) {
        p.r(x, 3, 4, 14, WD.o); p.r(x + 1, 3, 2, 13, WD.m); p.r(x + 1, 4, 1, 12, WD.l);
        p.r(x + 1, 1, 2, 2, "#b08a5a"); p.p(x + 1, 0, WD.h); p.p(x + 2, 2, WD.l);
      }
      p.o(0, 9, 18, 4, WD.m, WD.o); p.r(1, 10, 16, 1, WD.l); p.r(1, 12, 16, 1, WD.d);
      for (const x of [2, 8, 14]) { p.r(x, 9, 2, 4, "#8a7a5a"); p.p(x, 10, "#b0a07a"); }
    });
  },
  forge: (_v, _alt, M) => {
    return M(32, 30, (p) => {
      p.o(6, 0, 20, 10, S.m, S.o); p.r(7, 1, 18, 1, S.h); p.r(8, 8, 16, 2, S.d);
      p.o(0, 10, 32, 18, S.l, S.o); p.r(1, 11, 30, 2, S.h);
      p.r(7, 14, 18, 8, "#0c0808");
      for (const [x, y, c] of [[9, 20, "#7a2a08"], [12, 21, "#c24a10"], [14, 20, "#5a1e06"], [17, 21, "#a03a0a"], [20, 20, "#7a2a08"], [22, 21, "#5a1e06"], [11, 21, "#ff7a20"]] as [number, number, string][]) p.g(x, y, 1, 1, c);
      p.r(1, 25, 30, 2, S.d);
      p.o(26, 18, 6, 9, "#4a3020", WD.o); p.r(27, 19, 4, 1, "#6a4a30");
    });
  },
  anvil: (_v, _alt, M) => {
    return M(16, 12, (p) => {
      p.o(4, 6, 8, 6, WD.m, WD.o);
      p.o(0, 0, 16, 5, IR.m, "#14161a"); p.r(1, 1, 14, 1, IR.h); p.r(0, 2, 3, 2, IR.d);
      p.o(5, 4, 6, 3, IR.d, "#14161a");
    });
  },
  cradle: (_v, _alt, M) => {
    return M(30, 34, (p, r) => {
      p.o(0, 30, 30, 4, S.m, S.o); p.r(4, 31, 22, 1, S.h);
      p.r(2, 0, 3, 31, IR.d); p.r(2, 0, 1, 31, IR.l);
      p.r(25, 0, 3, 31, IR.d); p.r(25, 0, 1, 31, IR.l);
      p.r(0, 2, 30, 3, IR.m); p.r(0, 2, 30, 1, IR.h);
      for (const x of [9, 20]) {
        const len = 6 + ((r() * 8) | 0);
        for (let j = 0; j < len; j++) p.p(x, 5 + j, j % 2 ? IR.l : IR.m);
        p.o(x - 1, 5 + len, 3, 3, IR.d, IR.l);
      }
      p.r(13, 5, 1, 4, IR.m); p.r(16, 5, 1, 3, IR.m);
    });
  },
  slab: (_v, _alt, M) => {
    return M(38, 20, (p) => {
      p.r(3, 14, 3, 6, S.o); p.r(32, 14, 3, 6, S.o);
      p.o(0, 4, 38, 12, S.l, S.o); p.r(1, 5, 36, 1, S.h); p.r(1, 13, 36, 2, S.d);
      // husk of a golem lying down
      p.o(9, 2, 18, 10, "#5a5650", "#24221f"); p.r(10, 3, 16, 2, "#7a756c");
      p.o(26, 3, 8, 8, "#5a5650", "#24221f"); p.r(27, 6, 1, 3, "#101010");
      p.o(4, 4, 6, 4, "#4a4640", "#24221f");
      p.line(14, 4, 18, 10, "#24221f"); p.line(18, 10, 21, 9, "#24221f");
      p.r(17, 6, 2, 2, "#1a1410");
    });
  },
  parts: (_v, _alt, M) => {
    return M(20, 12, (p, r) => {
      stoneBlob(p, 0, 5, 7, 6, r);
      p.o(5, 1, 8, 7, "#5a5650", "#24221f"); p.r(7, 4, 4, 1, "#101010"); p.r(6, 2, 6, 1, "#7a756c");
      p.o(12, 6, 8, 5, "#5a5650", "#24221f"); p.r(13, 7, 2, 1, "#7a756c"); p.r(17, 9, 1, 2, "#24221f");
      p.r(2, 9, 6, 1, IR.d);
    });
  },
  hearth: (_v, alt, M) => {
    return M(36, 28, (p, r) => {
      p.o(0, 2, 36, 26, S.m, S.o);
      for (let j = 0; j < 6; j++) for (let i = 0; i < 5; i++) { const bx = 1 + i * 7 + (j % 2 ? 3 : 0), by = 3 + j * 4; p.r(bx, by, 6, 3, r() < 0.5 ? S.l : S.m); }
      p.o(0, 0, 36, 4, S.l, S.o); p.r(1, 1, 34, 1, S.h);
      p.r(8, 9, 20, 17, "#080606"); p.r(9, 8, 18, 1, "#080606");
      p.r(9, 21, 18, 4, "#3a3634");
      for (let i = 0; i < 16; i++) p.p(9 + ((r() * 18) | 0), 21 + ((r() * 4) | 0), r() < 0.5 ? "#55504c" : "#2a2624");
      p.r(11, 20, 8, 2, WD.o); p.r(16, 19, 9, 2, "#1e140c");
      if (!alt) for (const [x, y, c] of [[12, 22, "#8a2e08"], [15, 23, "#c4500c"], [19, 22, "#6a2206"], [22, 23, "#a8400c"], [17, 21, "#ff8a2a"]] as [number, number, string][]) p.g(x, y, 1, 1, c);
      p.r(1, 26, 34, 2, S.d);
    });
  },
  longtable: (_v, _alt, M) => {
    return M(52, 17, (p) => {
      p.r(3, 12, 2, 5, WD.o); p.r(47, 12, 2, 5, WD.o); p.r(25, 12, 2, 5, WD.o);
      p.o(0, 0, 52, 13, WD.l, WD.o); p.r(1, 1, 50, 1, WD.h); p.r(1, 6, 50, 1, WD.m); p.r(1, 10, 50, 2, WD.d);
      for (const x of [6, 18, 34, 44]) { p.r(x, 3, 5, 3, IR.l); p.r(x + 1, 4, 3, 1, IR.d); }
      p.r(28, 7, 3, 2, IR.m); p.r(39, 2, 2, 2, "#7a4a2a");
    });
  },
  bench: (_v, _alt, M) => {
    return M(46, 7, (p) => {
      p.o(0, 0, 46, 4, WD.m, WD.o); p.r(1, 1, 44, 1, WD.l); p.r(2, 4, 2, 3, WD.o); p.r(42, 4, 2, 3, WD.o);
    });
  },
  chest: (v, alt, M) => {
    if (v === 2)
      return M(20, 14, (p) => {
        p.o(0, 4, 14, 10, WD.m, WD.o); p.r(1, 5, 12, 4, "#120c08"); p.r(0, 10, 14, 1, IR.m);
        p.o(13, 6, 7, 7, WD.d, WD.o); p.r(14, 8, 5, 1, IR.m);
      });
    return M(16, 14, (p) => {
      if (alt) {
        p.o(0, 0, 16, 5, WD.d, WD.o); p.r(1, 1, 14, 1, IR.m);
        p.o(0, 4, 16, 10, WD.m, WD.o); p.r(1, 5, 14, 4, "#0e0806");
        p.r(0, 10, 16, 1, IR.m); p.r(3, 4, 1, 10, IR.m); p.r(12, 4, 1, 10, IR.m);
      } else {
        p.o(0, 2, 16, 12, WD.m, WD.o);
        p.r(1, 3, 14, 4, WD.l); p.r(1, 3, 14, 1, WD.h); p.r(0, 7, 16, 1, WD.o);
        p.r(3, 2, 1, 12, IR.m); p.r(12, 2, 1, 12, IR.m);
        p.o(6, 6, 4, 4, GD.m, "#3a2a08"); p.p(7, 8, "#000");
      }
    });
  },
  pot: (v, _alt, M) => {
    if (v === 1)
      return M(14, 8, (p) => {
        p.r(1, 4, 4, 3, "#7a4a2a"); p.r(6, 5, 3, 2, "#5a3420"); p.r(10, 3, 3, 4, "#7a4a2a"); p.p(10, 3, "#9a6a40");
      });
    return M(10, 12, (p) => {
      p.o(0, 3, 10, 9, "#7a4a2a", "#24140a"); p.r(1, 4, 3, 5, "#9a6a40"); p.r(6, 5, 3, 6, "#5a3420");
      p.o(2, 0, 6, 4, "#6a3e22", "#24140a"); p.r(3, 1, 4, 1, "#1a0e06");
    });
  },
  brazier: (v, alt, M) => {
    return M(14, 18, (p) => {
      p.r(2, 9, 1, 8, IR.d); p.r(11, 9, 1, 8, IR.d); p.r(6, 10, 2, 8, IR.d);
      p.o(0, 4, 14, 6, IR.m, "#121418"); p.r(1, 5, 12, 1, IR.l);
      if (alt) { p.g(2, 3, 10, 2, "#c84a10"); p.g(3, 3, 3, 1, "#ffb040"); p.g(8, 3, 2, 1, "#ff8020"); }
      else { p.r(2, 3, 10, 2, "#3a3634"); p.p(5, 3, "#55504c"); }
      if (v === 1) p.r(0, 16, 14, 2, "rgba(0,0,0,0)");
    });
  },
  fountain: (_v, _alt, M) => {
    return M(34, 24, (p, r) => {
      for (let y = 0; y < 18; y++) for (let x = 0; x < 34; x++) {
        const dx = (x - 16.5) / 17, dy = (y - 10) / 8;
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        let c = d > 0.62 ? (dy < 0 ? S.h : S.l) : d > 0.5 ? S.o : "#2a2620";
        if (c === "#2a2620" && r() < 0.15) c = "#3a3428";
        if (d <= 0.5 && r() < 0.04) c = "#3e4a2a";
        p.p(x, y + 4, c);
      }
      p.r(0, 14, 34, 1, "rgba(0,0,0,0)");
      p.o(13, 4, 8, 10, S.l, S.o); p.r(14, 5, 6, 1, S.h);
      p.o(15, 0, 4, 5, S.m, S.o);
      p.r(2, 18, 30, 2, S.d); p.p(18, 10, S.o); p.p(19, 11, S.o);
    });
  },
  pedestal: (_v, _alt, M) => {
    return M(12, 16, (p) => {
      p.o(0, 12, 12, 4, S.l, S.o);
      p.o(2, 4, 8, 9, S.m, S.o); p.r(3, 5, 2, 7, S.h);
      p.o(0, 1, 12, 4, S.l, S.o); p.r(3, 2, 6, 2, "#141016");
    });
  },
  mushrooms: (_v, _alt, M) => {
    return M(12, 10, (p) => {
      for (const [x, y, s] of [[1, 4, 3], [5, 1, 4], [8, 5, 3]] as [number, number, number][]) {
        p.r(x + 1, y + 2, 1, 10 - y - 3, "#a8b8a8");
        p.g(x, y, s, 2, "#2aa890"); p.g(x + 1, y, s - 2 || 1, 1, "#7ff8e0");
      }
    });
  },
  skeleton: (v, _alt, M) => {
    return M(18, 14, (p) => {
      p.r(7, 0, 4, 4, BN.l); p.p(8, 1, "#1a1410"); p.p(10, 1, "#1a1410"); p.r(8, 3, 2, 1, BN.d);
      for (let j = 0; j < 4; j++) p.r(6, 5 + j * 2, 6, 1, BN.m);
      p.r(8, 4, 1, 8, BN.d);
      p.r(3, 5, 1, 5, BN.m); p.r(14, 5, 1, 5, BN.m);
      p.r(5, 12, 8, 1, BN.m); p.r(4, 13, 3, 1, BN.l); p.r(11, 13, 4, 1, BN.l);
      if (v === 2) { p.r(2, 0, 1, 6, IR.m); p.r(15, 0, 1, 6, IR.m); p.r(1, 5, 3, 2, IR.d); p.r(14, 5, 3, 2, IR.d); }
      if (v === 1) { p.r(13, 10, 4, 3, "#9a907a"); p.r(14, 11, 2, 1, "#5a5040"); }
    });
  },
  candles: (v, _alt, M) => {
    return M(10, 6, (p) => {
      p.r(1, 2, 2, 4, "#c8c0a0"); p.r(5, 0, 2, 6, "#d8d0b0"); p.r(8, 3, 2, 3, "#b8b090");
      p.p(5, 0, "#2a2420"); p.p(1, 2, "#2a2420");
      if (v === 1) p.r(0, 5, 10, 1, "#a8a080");
    });
  },
  ladder: (_v, _alt, M) => {
    return M(12, 30, (p) => {
      p.r(1, 0, 2, 30, WD.m); p.r(9, 0, 2, 30, WD.m); p.r(1, 0, 1, 30, WD.l);
      for (let y = 3; y < 30; y += 5) p.r(3, y, 6, 1, WD.l);
      p.r(3, 13, 6, 1, "rgba(0,0,0,0)");
    });
  },
  bucket: (_v, _alt, M) => {
    return M(8, 8, (p) => {
      p.o(0, 2, 8, 6, WD.m, WD.o); p.r(0, 4, 8, 1, IR.m); p.r(1, 2, 6, 1, "#100c08"); p.r(2, 0, 4, 1, IR.l);
    });
  },
};
