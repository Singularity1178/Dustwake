// Gamepad parity: the standard mapping polled once a frame and turned into the
// same keys the keyboard sends (so every screen, old and new, works with it
// unchanged). Stick and D-pad move (and move the UI focus), A uses / activates,
// B and Start are Esc (back; Start opens the system menu from play), X slams,
// Y opens the pack, LB / RB switch tabs (Q / R), LT / RT change game speed,
// Back / Select is Tab.

export interface KeySink { keyDown(k: string): void; keyUp(k: string): void }

/** Standard-mapping button index -> key. */
export const PAD_KEYS: Record<number, string> = {
  0: "e", 1: "escape", 2: " ", 3: "i", 4: "q", 5: "r", 6: "-", 7: "=", 8: "tab", 9: "escape",
  12: "arrowup", 13: "arrowdown", 14: "arrowleft", 15: "arrowright",
};
const DEAD = 0.45;

export class GamepadInput {
  connected = false;
  private held = new Set<string>();

  poll(sink: KeySink) {
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    const pads = nav?.getGamepads ? Array.from(nav.getGamepads()) : [];
    const pad = pads.find((p) => p && p.connected) ?? null;
    this.connected = !!pad;
    const now = new Set<string>();
    if (pad) {
      pad.buttons.forEach((b, i) => { const k = PAD_KEYS[i]; if (k && (b.pressed || b.value > 0.5)) now.add(k); });
      const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
      if (ax < -DEAD) now.add("arrowleft");
      if (ax > DEAD) now.add("arrowright");
      if (ay < -DEAD) now.add("arrowup");
      if (ay > DEAD) now.add("arrowdown");
    }
    for (const k of now) if (!this.held.has(k)) sink.keyDown(k);
    for (const k of this.held) if (!now.has(k)) sink.keyUp(k);
    this.held = now;
  }
}
