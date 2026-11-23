import { useEffect, useRef } from "react";
import { Game, W, H } from "./game/game";
import { HI_W, HI_H } from "./game/ui/scale";
import { serialize } from "./game/world/save";
import { saveToStorage, loadFromStorage, openBrowserStore } from "./game/view/persistence";
import { foundationDemo, registerFoundations } from "./game/sim/debugFoundations";
import { setWorkerOrder } from "./game/sim/jobs";
import type { JobOrder } from "./game/world/jobs";
import { player } from "./game/world/world";
import { GamepadInput } from "./game/view/gamepad";
import { runSoak, type SoakOptions } from "./game/sim/soak";

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null);
  const fixedRef = useRef<HTMLCanvasElement>(null);
  const uiRef = useRef<HTMLCanvasElement>(null);
  const hiRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Four stacked layers with the same display rect. The world canvas is sized to the current view (W x H times
    // the zoom level, 1 world px = 1 canvas px) and stays pixel-perfect. The fixed canvas stays at W x H: cutscene
    // cards, the dialogue box and the letterbox, which are not interface and never scale. The UI canvas carries the
    // HUD and the overlay screens at the chosen UI scale: Game sizes it (320x180 at Large, the interface as designed;
    // larger at Normal and Compact, so the whole interface comes out smaller). The high-resolution layer (always
    // 6x the base) carries the v2 text of both and the widget kit: the speed bar, the notification feed, tooltips,
    // the system menu. It is on top, so it takes the mouse. All of them scale with nearest-neighbour (pixelated).
    const canvas = ref.current!, fixed = fixedRef.current!, ui = uiRef.current!, hi = hiRef.current!;
    const game = new Game(canvas, ui, hi, fixed);
    let alive = true;
    // Saves live in IndexedDB (world/saveStore.ts over view/persistence.ts); until it opens, a memory store stands in.
    openBrowserStore()
      .then(({ store, kind }) => {
        if (!alive) return;
        game.useStore(store);
        if (kind !== "IndexedDB") game.notes.push(`Saves are kept in ${kind}`, "warn", "store");
      })
      .catch(() => game.notes.push("Saves could not be opened; they will not outlive this tab", "warn", "store"));
    // Developer hook (not player-facing): open with ?debug to get window.dustwake.
    if (new URLSearchParams(window.location.search).has("debug")) {
      registerFoundations();
      (window as unknown as Record<string, unknown>).dustwake = {
        game,
        serialize: () => serialize(game.world),
        save: () => saveToStorage(game.world),
        load: () => { const w = loadFromStorage(); if (w) game.resume(w); return !!w; },
        foundations: () => { game.resume(foundationDemo()); game.say("FOUNDATION FIXTURE: A WORKER GATHERS THROUGH THE RUNES."); },
        order: (id: string, order: JobOrder | null) => setWorkerOrder(game.world, player(game.world), id, order),
        createFloor: (kind: "floor" | "cave" = "floor") => game.devCreateFloor(kind).id,
        speed: (s: number) => game.setSpeed(s),
        soak: (o: SoakOptions = {}) => runSoak({ residents: 300, seconds: 120, ...o }),
        store: () => game.store.list(),
      };
    }
    const pad = new GamepadInput();
    let raf = 0;
    let last = performance.now();
    let running = true;

    // The display rect is fitted for the base size (integer steps from 2x up, as before), so the HUD never jumps when
    // zooming. The world canvas's scale is derived from the current view size.
    const fit = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      let s = Math.min(vw / W, vh / H);
      if (s >= 2) s = Math.floor(s);
      const dw = Math.round(W * s), dh = Math.round(H * s);
      const ws = dw / game.vw;
      for (const c of [canvas, fixed, ui, hi]) {
        c.style.width = `${dw}px`;
        c.style.height = `${dh}px`;
      }
      canvas.style.width = `${Math.round(game.vw * ws)}px`;
      canvas.style.height = `${Math.round(game.vh * ws)}px`;
    };
    game.onView = fit;
    fit();
    window.addEventListener("resize", fit);

    // "/" and "'" open Firefox quick-find and Backspace may navigate: the build menu's search field uses them.
    const block = new Set(["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "tab", "/", "'", "backspace"]);
    const kd = (e: KeyboardEvent) => {
      // Debug keybinds: Ctrl+0 opens the debug menu (items, flags, teleport...), Ctrl+1 arm, Ctrl+2 runes + core + tools, Ctrl+3 super speed, Ctrl+4 build kit, Ctrl+5 eye repair + zoom, Ctrl+6 gear kit (toggle).
      if (e.ctrlKey && !e.altKey && !e.shiftKey) {
        const n = ({ Digit0: 0, Numpad0: 0, Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5, Digit6: 6, Numpad1: 1, Numpad2: 2, Numpad3: 3, Numpad4: 4, Numpad5: 5, Numpad6: 6 } as Record<string, number>)[e.code];
        if (n !== undefined) {
          e.preventDefault();
          if (!e.repeat) game.debugKey(n);
          return;
        }
      }
      if (block.has(e.key.toLowerCase())) e.preventDefault();
      game.keyDown(e.key);
    };
    const ku = (e: KeyboardEvent) => game.keyUp(e.key);
    // The mouse, in base-layer px (320 x 180) whatever the display size.
    const toBase = (e: PointerEvent) => {
      const r = hi.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / Math.max(1, r.width)) * W, y: ((e.clientY - r.top) / Math.max(1, r.height)) * H };
    };
    const pm = (e: PointerEvent) => { const p = toBase(e); game.pointerMove(p.x, p.y); };
    const pd = (e: PointerEvent) => { const p = toBase(e); hi.focus(); game.sfx.init(); game.pointerDown(e.button, p.x, p.y); };
    const pu = (e: PointerEvent) => { const p = toBase(e); game.pointerUp(e.button, p.x, p.y); };
    const pl = () => game.pointerLeave();
    const cm = (e: Event) => e.preventDefault();
    // Non-passive so the page never scrolls; the game decides whether the wheel zooms or scrolls a list.
    const wh = (e: WheelEvent) => { e.preventDefault(); game.wheel(e.deltaY); };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    hi.addEventListener("pointermove", pm);
    hi.addEventListener("pointerdown", pd);
    window.addEventListener("pointerup", pu);
    hi.addEventListener("pointerleave", pl);
    hi.addEventListener("contextmenu", cm);
    window.addEventListener("wheel", wh, { passive: false });
    const blur = () => game.keys.clear();
    window.addEventListener("blur", blur);

    // Real frame time goes in; the game turns it into whole fixed simulation ticks at the chosen speed (core/clock.ts)
    // and draws between the last two (view/interp.ts). A long hitch is clamped so a cutscene never leaps.
    const loop = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      pad.poll(game);
      game.update(dt);
      game.render();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      running = false;
      alive = false;
      cancelAnimationFrame(raf);
      game.onView = null;
      window.removeEventListener("resize", fit);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
      window.removeEventListener("wheel", wh);
      window.removeEventListener("pointerup", pu);
      hi.removeEventListener("pointermove", pm);
      hi.removeEventListener("pointerdown", pd);
      hi.removeEventListener("pointerleave", pl);
      hi.removeEventListener("contextmenu", cm);
      game.sfx.ctx?.close();
      game.view.dispose();
      delete (window as unknown as Record<string, unknown>).dustwake;
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center overflow-hidden select-none">
      <div className="relative">
        <canvas ref={ref} width={W} height={H} className="block outline-none" style={{ imageRendering: "pixelated" }} />
        <canvas ref={fixedRef} width={W} height={H} className="absolute inset-0 block outline-none pointer-events-none" style={{ imageRendering: "pixelated" }} />
        <canvas ref={uiRef} width={W} height={H} className="absolute inset-0 block outline-none pointer-events-none" style={{ imageRendering: "pixelated" }} />
        <canvas ref={hiRef} width={HI_W} height={HI_H} tabIndex={0} className="absolute inset-0 block outline-none" style={{ imageRendering: "pixelated", touchAction: "none", cursor: "default" }} />
      </div>
    </div>
  );
}
