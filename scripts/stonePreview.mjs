// Developer tool: renders the stone retexture to .preview/stone/*.png through the real host on a pixel canvas
// (no type check, no browser): every rock and iron vein variant, the rockiest stretch of the surface, the stair
// head at every dig stage, the stair's foot in the halls (choked and open) and the two ends of the open stair
// side by side. See tests/support/stoneSnapshot.ts.
//
//   node scripts/stonePreview.mjs            -> .preview/stone/*.png
//   node scripts/stonePreview.mjs some/dir   -> some/dir/*.png (to keep a set to compare against)
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
execFileSync("node_modules/.bin/esbuild", ["tests/support/stoneSnapshot.ts", "--bundle", "--platform=node", "--format=cjs", "--outfile=.preview/stoneRun.cjs", "--log-level=warning"], { stdio: "inherit" });
const run = createRequire(import.meta.url)("../.preview/stoneRun.cjs");
process.exitCode = run.run(process.argv[2] ?? ".preview/stone");
