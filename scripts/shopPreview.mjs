// Developer tool: renders the shops in use (interiors with customers and keepers, a deal over a counter frame by
// frame, the guild board being read, talk in the street, a shop door from outside, a shop out of hours, scan mode,
// and a sheet of the new poses) through the real host to .preview/shops/*.png (no type check, no browser).
// `node scripts/shopPreview.mjs [dir] [only,these]` (names: poses, interiors, deal, board, street, door, closed, scan).
// See tests/support/shopSnapshot.ts.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
execFileSync("node_modules/.bin/esbuild", ["tests/support/shopSnapshot.ts", "--bundle", "--platform=node", "--format=cjs", "--outfile=.preview/shopRun.cjs", "--log-level=warning"], { stdio: "inherit" });
const run = createRequire(import.meta.url)("../.preview/shopRun.cjs");
run.run(process.argv[2] ?? ".preview/shops", process.argv[3] ?? "");
