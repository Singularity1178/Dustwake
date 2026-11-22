// Reading screen for book items (ITEMS[id].book). Reading is a sim command
// (readItem: e.g. learning to build); this screen only turns pages.
import type { Screen } from "../ui/screens";
import type { UiHost } from "../ui/kit";
import { ITEMS, type ItemId } from "../content/items";
import { readItem } from "../sim/commands";
import { label, hints, sentence, shade, occlude } from "../ui/text";
import { hash2 } from "../util";

export class BookUi {
  readonly screen: Screen;
  book: { id: ItemId; page: number } | null = null;

  constructor(private g: UiHost) {
    this.screen = { id: "book", opaque: false, t: 0, update: () => this.update(), render: () => this.render() };
  }

  open(id: ItemId) {
    const g = this.g;
    g.screens.popToBase();
    this.book = { id, page: 0 };
    g.screens.push(this.screen);
    readItem(g.world, g.pl, id);
    g.sfx.noise(0.3, 0.1, "bandpass", 2000, 1, 0, 600);
  }

  private update() {
    const g = this.g, b = this.book, pages = b ? ITEMS[b.id].book?.pages ?? [] : [];
    if (!b || g.hit("escape", "i", "tab")) { g.screens.popToBase(); g.drainEvents(); return; }
    if (this.screen.t < 0.3) return;
    if (g.hit("arrowleft", "a") && b.page > 0) { b.page--; g.sfx.noise(0.15, 0.06, "bandpass", 2200, 1, 0, 600); }
    if (g.hit("arrowright", "d", "e", "enter", " ")) {
      if (b.page < pages.length - 1) { b.page++; g.sfx.noise(0.15, 0.06, "bandpass", 2200, 1, 0, 600); }
      else if (g.hit("e", "enter", " ")) { g.screens.popToBase(); g.drainEvents(); }
    }
  }

  private render() {
    const ctx = this.g.ctx, b = this.book;
    if (!b) return;
    const def = ITEMS[b.id].book!;
    shade(ctx, "rgba(0,0,0,0.6)");
    const x = 50, y = 22, w = 220, h = 136;
    occlude(ctx, x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = "#2a1a0c"; ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = "#d8ccb0"; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#b8ac90"; ctx.fillRect(x + w / 2, y, 1, h);
    for (let i = 0; i < 60; i++) { ctx.fillStyle = "#c8bc9e"; ctx.fillRect(x + ((hash2(i, 1, 9) * w) | 0), y + ((hash2(i, 2, 9) * h) | 0), 2, 1); }
    label(ctx, def.title, x + w / 2, y + 10, "#4a2a10", "center", { case: "title", bold: true });
    ctx.fillStyle = "#a8997a"; ctx.fillRect(x + w / 2 - 24, y + 21, 48, 1);
    // A page is set as the writer broke it, line for line, but it is one piece of prose: cased as running text.
    const lines = sentence((def.pages[b.page] ?? []).join("\n")).split("\n");
    lines.forEach((l, i) => label(ctx, l, x + w / 2, y + 34 + i * 14, "#3a2a1a", "center", { case: "raw" }));
    label(ctx, `${b.page + 1} / ${def.pages.length}`, x + w / 2, y + h - 22, "#7a6a50", "center");
    hints(ctx, b.page < def.pages.length - 1 ? "E NEXT PAGE   ESC CLOSE" : "E CLOSE", x + w / 2, y + h - 12, "#6a5a40", "center", w - 12, { cap: "#bfb190", rim: "#cdc0a2", lip: "#8f8062", key: "#3a2a1a" });
    this.g.renderNote();
  }
}
