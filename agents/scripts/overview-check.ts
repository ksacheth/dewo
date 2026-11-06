// Runs one Episode through the real pinned sim image and the real overview image, with a scripted model, and
// checks the frame hashes against the golden recording. No network, no keys.
//   pnpm --filter @dewo/agents overview-check [--latency-ms 300] [--mode goal|crash] [--fault none|kill|pause] [--mission 0x...]
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FileEvents } from "../src/shared/events-file";
import { SimCli } from "../src/shared/sim-cli";
import { runEpisode } from "../src/worker/episode";
import type { Hex, Policy } from "../src/formats";

const arg = (name: string, fallback: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1]! : fallback;
};
const latency = Number(arg("latency-ms", "300"));
const mode = arg("mode", "goal");
const fault = arg("fault", "none");
const missionId = arg("mission", `0x${randomBytes(32).toString("hex")}`);
const runs = resolve(process.env.RUNS_DIR || "../runs");
const fixtures = "../sim/tests/fixtures";
const golden = JSON.parse(readFileSync(join(fixtures, "expected_medium.json"), "utf8")) as { frameHashes: string[] };
const actions: string[] = mode === "crash" ? Array(60).fill("FORWARD") : JSON.parse(readFileSync(join(fixtures, "actions_medium.json"), "utf8"));
const policy = JSON.parse(readFileSync("policies/careful.json", "utf8")) as Policy;

const overviewContainers = () =>
  execFileSync("docker", ["ps", "-q", "--filter", "ancestor=dewo-sim-overview:0.1.0"], { encoding: "utf8" }).split("\n").filter(Boolean);

const events = new FileEvents(runs, "worker-check");
if (!process.argv.includes("--mission")) events.emit(missionId, "mission.posted", { difficultyClass: "medium", maxBounty: "10000000", riskWeight: 0.5, biddingClosesAt: 0, arkivKey: "0x0" });
let moved = 0;
const sim = new SimCli(["../sim/scripts/sim-docker"], runs, {
  command: ["../sim/scripts/overview-docker"],
  emit: (id, data) => {
    moved++;
    events.emit(id, "rover.moved", data);
  },
});

const hashes: string[] = [];
let call = 0;
const started = Date.now();
const session = await sim.openSession("0xabc" as Hex, "medium", missionId);
const result = await runEpisode({
  policy,
  session,
  inference: {
    async complete() {
      const action = actions[call++] ?? "STOP";
      if (call === 6 && fault === "kill") execFileSync("docker", ["kill", ...overviewContainers()]);
      if (call === 6 && fault === "pause") execFileSync("docker", ["pause", ...overviewContainers()]);
      await new Promise((done) => setTimeout(done, latency));
      return { rawResponse: action, chatID: `check-${call}` };
    },
  },
  onDecision: (d, frame) => {
    hashes.push(d.frameHash);
    events.emit(missionId, "decision.made", { step: d.step, frame, chatID: d.chatID, action: d.action });
  },
});
if (fault === "pause") execFileSync("docker", ["unpause", ...overviewContainers()]);
await session.close();
const closed = Date.now();
await new Promise((done) => setTimeout(done, 300));

// The Verifier's check: replay the Actions actually taken in the pinned image and compare every frame hash.
const scratch = mkdtempSync(join(tmpdir(), "dewo-check-"));
writeFileSync(join(scratch, "actions.json"), JSON.stringify(result.decisions.map((d) => d.action)));
const replay = JSON.parse(execFileSync("../sim/scripts/sim-docker", ["replay", "--course", resolve(fixtures, "course_medium.json"), "--actions", join(scratch, "actions.json")], { encoding: "utf8" })) as { frameHashes: string[] };
const replayMatches = JSON.stringify(replay.frameHashes) === JSON.stringify(hashes);
const goldenMatches = mode === "goal" ? JSON.stringify(hashes) === JSON.stringify(golden.frameHashes) : "n/a";

console.log(JSON.stringify({ missionId, mode, fault, endReason: result.endReason, decisions: result.decisions.length, replayMatches, goldenMatches, movesShown: moved, seconds: (closed - started) / 1000 }));
