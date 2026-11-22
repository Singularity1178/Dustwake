# The rune network

> Split out of the old single `ARCHITECTURE.md` (Phase 0.9). Index: [docs/index.md](../index.md).

## Rune network
(The teleportation runes. Not the equippable runes of the gear slots above.)
`content/runes.ts` declares `RUNE_NODES` (a rune prop with a stable id in some area, its `rune.<id>.active` flag, and an arrival offset/facing) and `RUNE_LINKS` (declared once, bidirectional unless `oneWay`; `awakens` lets arriving at `b` from `a` wake a dormant `b`, and never the reverse). Interacting with an active rune runs a `channel` task whose `travel` effect resolves the link, places the actor at the destination prop + offset (nudged to the nearest free spot, deterministically), and calls `enterArea()`. The end of the tutorial uses the same path: standing on the charged circle starts the long first `channel` (one-shot, guarded by `tutorial.done`), and arriving wakes the surface rune. The dungeon circle is a `runesite` prop (`rune.dungeon`); its flag follows the ritual's active state. A rune is used only while it is `linked`: lit, with a far end that answers (`sim/runes.ts: runeState`; see "Routes, the severed rune and the pack (v17)").
