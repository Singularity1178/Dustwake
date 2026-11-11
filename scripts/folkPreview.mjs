// Developer tool: renders the townsfolk (a sprite sheet of every archetype, look, facing and pose) and the real game
// in Westwake, the tavern and the hunters' camp at several hours to .preview/folk/*.png (no type check, no browser).
// `node scripts/folkPreview.mjs [dir] [only,these]` (names: sprites, square, lowstreet, yard, oldquarter, camp,
// tavern, scan, close). See tests/support/folkSnapshot.ts.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
execFileSync("node_modules/.bin/esbuild", ["tests/support/folkSnapshot.ts", "--bundle", "--platform=node", "--format=cjs", "--outfile=.preview/folkRun.cjs", "--log-level=warning"], { stdio: "inherit" });
const run = createRequire(import.meta.url)("../.preview/folkRun.cjs");
run.run(process.argv[2] ?? ".preview/folk", process.argv[3] ?? "");
