// The dialogue overlay. A non-opaque screen: the world pauses beneath it (no
// stepWorld) while presentation keeps animating (host.animate). Every state
// change is a sim command (dialogueBeat / finishSegment); this screen only
// holds a page cursor, so progress lives in flags and Esc can leave anywhere.
// Authored pages are plain paragraphs: they are wrapped to the box's real
// width and split over as many screens as needed (ui/dialogueLayout.ts); the
// cursor walks those screens, and beats ride on the first / last screen of the
// page that declared them.
import type { Screen } from "../ui/screens";
import type { UiHost } from "../ui/kit";
import { DIALOGUE, type DialogueSegment } from "../content/dialogue";
import { npcDef } from "../content/npcs";
import { dialogueBeat, finishSegment, segmentPages, npcActor } from "../sim/dialogue";
import { drawText, drawTextS, textWidth } from "../font";
import { DIALOGUE_BOX as BOX, layoutDialogue, type DialogueScreenPage } from "../ui/dialogueLayout";

/** Seconds a beat holds the page before its text starts typing (presentation timing only). */
const BEAT_HOLD: Record<string, number> = { wake: 1.4, pause: 1.2, repairEye: 1.6, giveCore: 0.5 };

export class DialogueUi {
  readonly screen: Screen;
  /** The open dialogue (presentation cursor only; progress lives in flags). */
  dlg: { npc: string; seg: DialogueSegment; pages: DialogueScreenPage[]; page: number; chars: number; hold: number } | null = null;
  /** Show the zoom hint when the dialogue closes (set by the host after the eye repair). */
  zoomHint = false;

  constructor(private g: UiHost) {
    this.screen = { id: "dialogue", opaque: false, t: 0, update: (dt) => this.update(dt), render: () => this.render() };
  }

  /** New session: nothing open. */
  reset() { this.dlg = null; this.zoomHint = false; }

  open(npc: string, script: string, segment: string) {
    const seg = DIALOGUE[script]?.segments.find((s) => s.id === segment);
    if (!seg) return;
    this.dlg = { npc, seg, pages: [], page: 0, chars: 0, hold: 0 };
    this.g.screens.push(this.screen);
    this.startSegment(seg);
  }

  private startSegment(seg: DialogueSegment) {
    const d = this.dlg!;
    d.seg = seg;
    d.pages = layoutDialogue(segmentPages(this.g.world, this.g.pl, seg));
    if (!d.pages.length) { this.advanceSegment(); return; }
    this.startPage(0);
  }

  private startPage(i: number) {
    const g = this.g, d = this.dlg!, p = d.pages[i];
    d.page = i; d.chars = 0; d.hold = 0;
    if (p.beat) {
      dialogueBeat(g.world, g.pl, d.npc, d.seg.id, p.beat);
      g.drainEvents();
      d.hold = BEAT_HOLD[p.beat] ?? 0;
    }
  }

  private advanceSegment() {
    const g = this.g, d = this.dlg!;
    const next = finishSegment(g.world, g.pl, d.npc, d.seg.id);
    g.drainEvents();
    if (next && this.dlg) this.startSegment(next);
    else this.close();
  }

  close() {
    this.dlg = null;
    if (this.g.screens.is("dialogue")) this.g.screens.popToBase();
    if (this.zoomHint) { this.zoomHint = false; this.g.say("(SCROLL TO ZOOM)"); }
  }

  private update(dt: number) {
    const g = this.g;
    g.animate(dt);
    const d = this.dlg;
    if (!d) { g.screens.popToBase(); return; }
    // Esc leaves; progress is in flags, so the next talk resumes at the first unfinished segment.
    if (g.hit("escape")) { this.close(); return; }
    if (d.hold > 0) { d.hold -= dt; return; }
    const p = d.pages[d.page];
    const total = p.lines.reduce((n, l) => n + l.length, 0);
    if (d.chars < total) {
      const before = Math.floor(d.chars);
      d.chars = Math.min(total, d.chars + dt * 42);
      const flat = p.lines.join("");
      for (let i = before; i < Math.floor(d.chars); i++) if (flat[i] !== " " && i % 2 === 0) { g.sfx.blip(); break; }
    }
    if (this.screen.t > 0.15 && g.hit("e", "enter", " ")) {
      if (d.chars < total) { d.chars = total; return; }
      if (p.then) { dialogueBeat(g.world, g.pl, d.npc, d.seg.id, p.then); g.drainEvents(); }
      if (!this.dlg) return;
      if (d.page + 1 < d.pages.length) { this.startPage(d.page + 1); g.sfx.tone(240, 0.04, "triangle", 0.02); }
      else this.advanceSegment();
    }
  }

  private render() {
    const g = this.g, d = this.dlg;
    if (!d) return;
    const ctx = g.ctx, p = d.pages[d.page];
    const npc = npcActor(g.world, d.npc);
    const name = p.speaker ?? npcDef(npc?.npc)?.name ?? "";
    const bx = BOX.x, bw = BOX.w, bh = BOX.h, by = BOX.y;
    g.renderToast(by - 24);
    // box
    ctx.fillStyle = "#08070a"; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = "#3a3540"; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = "#4e4856"; ctx.fillRect(bx, by, bw, 1); ctx.fillRect(bx, by, 1, bh);
    ctx.fillStyle = "rgba(14,12,18,0.94)"; ctx.fillRect(bx + 2, by + 2, bw - 4, bh - 4);
    for (const [cx, cy] of [[bx + 3, by + 3], [bx + bw - 5, by + 3], [bx + 3, by + bh - 5], [bx + bw - 5, by + bh - 5]]) { ctx.fillStyle = "#6a6372"; ctx.fillRect(cx, cy, 2, 2); }
    // speaker tag, trimmed in the guardian's rank gold
    const tw = textWidth(name) + 10;
    ctx.fillStyle = "#08070a"; ctx.fillRect(bx + 7, by - 9, tw + 2, 10);
    ctx.fillStyle = "#2a2430"; ctx.fillRect(bx + 8, by - 8, tw, 8);
    ctx.fillStyle = "#7a5a1c"; ctx.fillRect(bx + 8, by - 8, tw, 1);
    drawText(ctx, name, bx + 13, by - 6, "#e0c060");
    // typewriter text
    let left = Math.floor(d.chars);
    p.lines.forEach((line, i) => {
      const n = Math.max(0, Math.min(line.length, left));
      left -= line.length;
      if (n > 0) drawTextS(ctx, line.slice(0, n), bx + BOX.padX, by + BOX.textY + i * BOX.lineH, "#e8dcc0", 1, "left", "#000");
    });
    const total = p.lines.reduce((n, l) => n + l.length, 0);
    if (d.hold <= 0 && d.chars >= total && Math.sin(g.t * 6) > -0.3) {
      const last = d.page === d.pages.length - 1;
      drawText(ctx, last ? "E" : "E >", bx + bw - 8, by + BOX.footerY, "#8a8392", 1, "right");
    }
    drawText(ctx, "ESC LEAVE", bx + BOX.padX, by + BOX.footerY, "#4e4856");
    g.renderNote(by - 36);
  }
}
