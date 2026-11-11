// Developer tool: renders the rocks, the iron veins and both ends of the stair to .preview/rocks/*.png through
// the real art and the real host on a pixel canvas (no type check, no browser): a labelled sheet of every rock
// sprite and dig stage, the surface where veins stand among rocks, the stair head stage by stage, and the flight
// in the halls choked and open. See tests/support/rockSnapshot.ts.
//
//   node scripts/rockPreview.mjs                    every sheet
//   node scripts/rockPreview.mjs sprites below      only those (sprites, surface, stages, above, below)
//   node scripts/rockPreview.mjs pick               contact sheets of candidate rock shapes by seed (art/rocks.ts ROCK_SEEDS)
//   node scripts/rockPreview.mjs out=.preview/x     into another directory
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
execFileSync("node_modules/.bin/esbuild", ["tests/support/rockSnapshot.ts", "--bundle", "--platform=node", "--format=cjs", "--outfile=.preview/rockRun.cjs", "--log-level=warning"], { stdio: "inherit" });
const run = createRequire(import.meta.url)("../.preview/rockRun.cjs");
const args = process.argv.slice(2), out = args.find((a) => a.startsWith("out="));
process.exitCode = run.run(out ? out.slice(4) : ".preview/rocks", args.filter((a) => !a.startsWith("out=")));
