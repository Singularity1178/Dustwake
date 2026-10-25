import { useEffect, useRef } from "react";
import { Game, W, H } from "./game/game";
import { serialize, saveToStorage, loadFromStorage } from "./game/world/save";

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null);
  const uiRef = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Two stacked layers with the same display rect: the world canvas is sized
    // to the current view (W x H times the zoom level, 1 world px = 1 canvas
    // px), the UI canvas stays at the base W x H so the HUD and overlays keep
    // their look at every zoom. Both scale with nearest-neighbour (pixelated).
    const canvas = ref.current!;
    const ui = uiRef.current!;
    const game = new Game(canvas, ui);
    // Developer hook (not player-facing): open with ?debug to get window.dustwake.
    if (new URLSearchParams(window.location.search).has("debug")) {
      (window as unknown as Record<string, unknown>).dustwake = {
        game,
        serialize: () => serialize(game.world),
        save: () => saveToStorage(game.world),
        load: () => { const w = loadFromStorage(); if (w) game.resume(w); return !!w; },
      };
    }
    let raf = 0;
    let last = performance.now();
    let running = true;

    // The display rect is fitted for the base size (integer steps from 2x up,
    // as before), so the HUD never jumps when zooming. The world canvas's
    // scale is derived from the current view size: display / view (an integer
    // on common screens: at 1920 px wide it is 6, 4 and 3 for 1x/1.5x/2x).
    const fit = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      let s = Math.min(vw / W, vh / H);
      if (s >= 2) s = Math.floor(s);
      const dw = Math.round(W * s), dh = Math.round(H * s);
      const ws = dw / game.vw;
      for (const c of [canvas, ui]) {
        c.style.width = `${dw}px`;
        c.style.height = `${dh}px`;
      }
      canvas.style.width = `${Math.round(game.vw * ws)}px`;
      canvas.style.height = `${Math.round(game.vh * ws)}px`;
    };
    game.onView = fit;
    fit();
    window.addEventListener("resize", fit);

    const block = new Set(["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "tab"]);
    const kd = (e: KeyboardEvent) => {
      // Debug keybinds: Ctrl+1 arm, Ctrl+2 runes + core + tools, Ctrl+3 super speed, Ctrl+4 build kit, Ctrl+5 eye repair + zoom.
      if (e.ctrlKey && !e.altKey && !e.shiftKey) {
        const n = ({ Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5, Numpad1: 1, Numpad2: 2, Numpad3: 3, Numpad4: 4, Numpad5: 5 } as Record<string, number>)[e.code];
        if (n) {
          e.preventDefault();
          if (!e.repeat) game.debugKey(n);
          return;
        }
      }
      if (block.has(e.key.toLowerCase())) e.preventDefault();
      game.keyDown(e.key);
    };
    const ku = (e: KeyboardEvent) => game.keyUp(e.key);
    const pd = () => game.pointer();
    // Non-passive so the page never scrolls; the game decides whether the wheel zooms.
    const wh = (e: WheelEvent) => { e.preventDefault(); game.wheel(e.deltaY); };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    ui.addEventListener("pointerdown", pd);
    window.addEventListener("wheel", wh, { passive: false });
    const blur = () => game.keys.clear();
    window.addEventListener("blur", blur);

    const loop = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      game.update(dt);
      game.render();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      game.onView = null;
      window.removeEventListener("resize", fit);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
      window.removeEventListener("wheel", wh);
      ui.removeEventListener("pointerdown", pd);
      game.sfx.ctx?.close();
    };
  }, []);

  return (
    <div ref={wrap} className="fixed inset-0 bg-black flex items-center justify-center overflow-hidden select-none">
      <div className="relative">
        <canvas
          ref={ref}
          width={W}
          height={H}
          className="block outline-none"
          style={{ imageRendering: "pixelated" }}
        />
        <canvas
          ref={uiRef}
          width={W}
          height={H}
          tabIndex={0}
          className="absolute inset-0 block outline-none"
          style={{ imageRendering: "pixelated" }}
        />
      </div>
    </div>
  );
}
