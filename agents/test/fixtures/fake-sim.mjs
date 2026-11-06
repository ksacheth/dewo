#!/usr/bin/env node
// A stand-in for the I1 sim CLI: a corridor where the goal is 3 FORWARDs away and any turn collides.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => rest[rest.indexOf(`--${name}`) + 1];

if (command === "course") {
  writeFileSync(flag("out"), JSON.stringify({ seed: flag("seed"), difficulty: flag("difficulty"), goalAt: 3 }));
} else if (command === "session") {
  const { goalAt } = JSON.parse(readFileSync(flag("course"), "utf8"));
  const framesDir = flag("frames-dir");
  mkdirSync(framesDir, { recursive: true });
  let step = 0;
  let position = 0;
  let ended = false;
  createInterface({ input: process.stdin }).on("line", (line) => {
    const message = JSON.parse(line);
    if (message.cmd === "observe") {
      const frame = join(framesDir, `frame_${String(step).padStart(4, "0")}.png`);
      const bytes = Buffer.from([position]);
      writeFileSync(frame, bytes);
      const frameHash = `0x${createHash("sha256").update(bytes).digest("hex")}`;
      console.log(JSON.stringify({ step, frame, frameHash, atGoal: position >= goalAt, collisions: 0 }));
    } else if (message.action === "DIE") {
      process.exit(3); // test hook: the sim dies mid-session
    } else if (ended) {
      // Like the real sim: Actions after the Episode ended are rejected, not executed.
      console.log(JSON.stringify({ error: "episode already ended" }));
    } else {
      step += 1;
      if (message.action === "FORWARD") position += 1;
      const collision = message.action === "TURN_LEFT" || message.action === "TURN_RIGHT";
      ended = collision || position >= goalAt || message.action === "STOP";
      console.log(JSON.stringify({ step, collision, atGoal: position >= goalAt, pose: { x: position, y: 0, yaw: 0 } }));
    }
  });
} else {
  console.error(`unknown command ${command}`);
  process.exit(2);
}
