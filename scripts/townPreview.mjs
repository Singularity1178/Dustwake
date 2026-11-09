// Developer tool: renders the market town, its interiors, the surface's west road and a sheet of every town
// sprite to .preview/town/*.png, lit as in the game (no type check, no browser). See tests/support/townSnapshot.ts.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
execFileSync("node_modules/.bin/esbuild", ["tests/support/townSnapshot.ts", "--bundle", "--platform=node", "--format=cjs", "--outfile=.preview/townRun.cjs", "--log-level=warning"], { stdio: "inherit" });
const run = createRequire(import.meta.url)("../.preview/townRun.cjs");
run.run(".preview/town");
