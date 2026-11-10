// Developer tool: renders the tutorial dungeon to .preview/dungeon/*.png through the real host on a pixel
// canvas (no type check, no browser), and runs the layout audit over it. See tests/support/dungeonSnapshot.ts.
//
//   node scripts/dungeonPreview.mjs                              the whole map (lit, dim, flat), nine regions, close-ups, the audit
//   node scripts/dungeonPreview.mjs hall=26,0,22,18,3,dim        one region of the map (tiles x,y,w,h, scale, lit|dim|flat, hour)
//   node scripts/dungeonPreview.mjs crack=@49,10,3,lit,1         one in-game close-up (the golem at tile x,y, scale, mode, hour)
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
execFileSync("node_modules/.bin/esbuild", ["tests/support/dungeonSnapshot.ts", "--bundle", "--platform=node", "--format=cjs", "--outfile=.preview/dungeonRun.cjs", "--log-level=warning"], { stdio: "inherit" });
const run = createRequire(import.meta.url)("../.preview/dungeonRun.cjs");
process.exitCode = run.run(".preview/dungeon", process.argv.slice(2));
