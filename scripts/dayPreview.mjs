// Developer tool: renders the day/night cycle (the town, the surface, the halls' broken roof and a room at several
// hours) and the crossing cutscene to .preview/day/*.png, through the real host on a pixel canvas (no type check, no
// browser). See tests/support/daySnapshot.ts.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
execFileSync("node_modules/.bin/esbuild", ["tests/support/daySnapshot.ts", "--bundle", "--platform=node", "--format=cjs", "--outfile=.preview/dayRun.cjs", "--log-level=warning"], { stdio: "inherit" });
const run = createRequire(import.meta.url)("../.preview/dayRun.cjs");
run.run(".preview/day");
