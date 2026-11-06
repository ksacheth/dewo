#!/usr/bin/env node
// A stand-in for sim/overview. Mode is the first argument: ok | crash (exits after 2 moves) | hang (never replies or exits).
import { createInterface } from "node:readline";

const [mode, ...rest] = process.argv.slice(2);
const outDir = rest[rest.indexOf("--out-dir") + 1];
let moves = 0;
if (mode === "hang") setInterval(() => {}, 1000);
createInterface({ input: process.stdin }).on("line", (line) => {
  if (mode === "hang") return;
  const { seq } = JSON.parse(line);
  if (mode === "crash" && ++moves > 2) process.exit(1);
  console.log(JSON.stringify({ seq, images: [`${outDir}/overview_${seq}.png`] }));
});
