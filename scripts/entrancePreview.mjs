// Developer tool: renders the entrance update to .preview/entrance/*.png through the real host on a pixel canvas
// (no type check, no browser): the surface's stair head at every dig stage, the open stair below, the smelter's
// and the anvil's screens, and a sheet of the sprites and icons. See tests/support/entranceSnapshot.ts.
//
//   node scripts/entrancePreview.mjs
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
execFileSync("node_modules/.bin/esbuild", ["tests/support/entranceSnapshot.ts", "--bundle", "--platform=node", "--format=cjs", "--outfile=.preview/entranceRun.cjs", "--log-level=warning"], { stdio: "inherit" });
const run = createRequire(import.meta.url)("../.preview/entranceRun.cjs");
process.exitCode = run.run(".preview/entrance");
