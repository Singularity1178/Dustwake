import { useEffect, useRef } from "react";
import { Game, W, H } from "./game/game";
import { serialize, saveToStorage, loadFromStorage } from "./game/world/save";

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const game = new Game(canvas);
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

    const fit = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      let s = Math.min(vw / W, vh / H);
      if (s >= 2) s = Math.floor(s);
      canvas.style.width = `${Math.round(W * s)}px`;
      canvas.style.height = `${Math.round(H * s)}px`;
    };
    fit();
    window.addEventListener("resize", fit);

    const block = new Set(["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "tab"]);
    const kd = (e: KeyboardEvent) => {
      // Debug keybinds: Ctrl+1 arm, Ctrl+2 runes + core, Ctrl+3 super speed.
      if (e.ctrlKey && !e.altKey && !e.shiftKey) {
        const n = ({ Digit1: 1, Digit2: 2, Digit3: 3, Numpad1: 1, Numpad2: 2, Numpad3: 3 } as Record<string, number>)[e.code];
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
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    canvas.addEventListener("pointerdown", pd);
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
      window.removeEventListener("resize", fit);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
      canvas.removeEventListener("pointerdown", pd);
      game.sfx.ctx?.close();
    };
  }, []);

  return (
    <div ref={wrap} className="fixed inset-0 bg-black flex items-center justify-center overflow-hidden select-none">
      <canvas
        ref={ref}
        width={W}
        height={H}
        tabIndex={0}
        className="block outline-none"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  );
}
