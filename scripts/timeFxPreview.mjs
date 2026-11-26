// Developer tool: renders the game speed's look (1x, paused, 2x, 4x, 8x) over the town to .preview/timefx/*.png,
// through the real host on a pixel canvas (no type check, no browser). See tests/support/timeFxSnapshot.ts.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
execFileSync("node_modules/.bin/esbuild", ["tests/support/timeFxSnapshot.ts", "--bundle", "--platform=node", "--format=cjs", "--outfile=.preview/timeFxRun.cjs", "--log-level=warning"], { stdio: "inherit" });
const run = createRequire(import.meta.url)("../.preview/timeFxRun.cjs");
run.run(".preview/timefx");
