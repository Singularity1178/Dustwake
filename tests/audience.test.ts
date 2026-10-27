import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, makeActor, player } from "../src/game/world/world";
import { eventActor, eventAudience } from "../src/game/view/audience";

test("event audience separates the player, a nearby actor and a remote actor", () => {
  const w = createWorld(1), pl = player(w);
  const near = makeActor("near", "worker_golem", pl.area, pl.x + 20, pl.y);
  w.actors.push(near);
  assert.equal(eventActor({ t: "message", actor: near.id, text: "WORKING" }), near.id);
  assert.equal(eventActor({ t: "cue", cue: "clank", x: 0, y: 0, actor: near.id }), near.id);
  assert.equal(eventAudience(w, { t: "step", actor: pl.id, heavy: false }), "player");
  assert.equal(eventAudience(w, { t: "message", text: "THE RUNE IS DARK" }), "player");
  assert.equal(eventAudience(w, { t: "step", actor: near.id, heavy: false }), "nearby");
  near.area = "surface";
  assert.equal(eventAudience(w, { t: "step", actor: near.id, heavy: false }), "elsewhere");
});
