// Developer tool: renders the trees and stumps to .preview/trees/*.png through the real art and the real host on a
// pixel canvas (no type check, no browser): a labelled sheet of every tree and stump sprite, a sheet that holds the
// trunk of tree, felled stump and standing stump against one ruler, and the surface at noon and at night where
// they stand among rocks. See tests/support/treeSnapshot.ts.
//
//   node scripts/treePreview.mjs                    every sheet
//   node scripts/treePreview.mjs sprites trunks     only those (sprites, trunks, surface, night)
//   node scripts/treePreview.mjs pick               contact sheets of candidate crowns by seed (art/trees.ts TREE_SEEDS)
//   node scripts/treePreview.mjs out=.preview/x     into another directory
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
execFileSync("node_modules/.bin/esbuild", ["tests/support/treeSnapshot.ts", "--bundle", "--platform=node", "--format=cjs", "--outfile=.preview/treeRun.cjs", "--log-level=warning"], { stdio: "inherit" });
const run = createRequire(import.meta.url)("../.preview/treeRun.cjs");
const args = process.argv.slice(2), out = args.find((a) => a.startsWith("out="));
process.exitCode = run.run(out ? out.slice(4) : ".preview/trees", args.filter((a) => !a.startsWith("out=")));
