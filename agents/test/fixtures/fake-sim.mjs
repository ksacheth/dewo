#!/usr/bin/env node
// A stand-in for the I1 sim CLI: a corridor where the goal is 3 FORWARDs away and any turn collides.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const ACTIONS = ["FORWARD", "TURN_LEFT", "TURN_RIGHT", "STOP"];
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
  const pose = () => ({ x: position, y: 0, yaw: 0 });
  createInterface({ input: process.stdin }).on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      // Like the real sim: bad input gets an {"error"} reply, the session keeps going.
      return console.log(JSON.stringify({ error: String(error.message) }));
    }
    if (message.cmd === "observe") {
      const frame = join(framesDir, `frame_${String(step).padStart(4, "0")}.png`);
      const bytes = Buffer.from([position]);
      writeFileSync(frame, bytes);
      const frameHash = `0x${createHash("sha256").update(bytes).digest("hex")}`;
      console.log(JSON.stringify({ step, frame, frameHash, pose: pose(), atGoal: position >= goalAt, collisions: 0 }));
    } else if (message.cmd === "act" && message.action === "DIE") {
      process.exit(3); // test hook: the sim dies mid-session
    } else if (message.cmd === "act") {
      if (!ACTIONS.includes(message.action)) {
        console.log(JSON.stringify({ error: `unknown action ${JSON.stringify(message.action)}` }));
      } else if (ended) {
        // Like the real sim: Actions after the Episode ended are rejected, not executed.
        console.log(JSON.stringify({ error: "episode is over" }));
      } else if (message.action === "STOP") {
        ended = true; // STOP ends the Episode and uses no step
        console.log(JSON.stringify({ step, collision: false, atGoal: position >= goalAt, pose: pose() }));
      } else {
        step += 1;
        if (message.action === "FORWARD") position += 1;
        const collision = message.action === "TURN_LEFT" || message.action === "TURN_RIGHT";
        ended = collision || position >= goalAt;
        console.log(JSON.stringify({ step, collision, atGoal: position >= goalAt, pose: pose() }));
      }
    } else {
      console.log(JSON.stringify({ error: `unknown cmd in ${line}` }));
    }
  });
} else {
  console.error(`unknown command ${command}`);
  process.exit(2);
}
