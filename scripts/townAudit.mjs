// Developer tool: checks the market town and its interiors for layout mistakes (props in walls, things
// standing in each other, blocked doors and standing places, sealed-off ground, decals over roofs), prints
// an ASCII plan, or renders gridded close-ups to .preview/audit/*.png. See tests/support/townAudit.ts.
//
//   node scripts/townAudit.mjs
//   node scripts/townAudit.mjs map
//   node scripts/townAudit.mjs shot gate=town:80,22,16,16,3,flat,grid
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
execFileSync("node_modules/.bin/esbuild", ["tests/support/townAudit.ts", "--bundle", "--platform=node", "--format=cjs", "--outfile=.preview/townAudit.cjs", "--log-level=warning"], { stdio: "inherit" });
const run = createRequire(import.meta.url)("../.preview/townAudit.cjs");
process.exitCode = run.main(process.argv.slice(2));
