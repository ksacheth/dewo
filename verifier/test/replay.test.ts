import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress, keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { handleReplay } from "../src/routes/replay.js";
import type { EpisodeSource, LoadedEpisode, VerdictEntity } from "../src/ports.js";
import { Outcome, eip712Domain, verdictTypes } from "../src/sign.js";
import { FakeSim, honestEpisode, zeroG, MISSION, WORKER } from "./fixtures/builders.js";

const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ESCROW = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
const T = 1_000;

function setup(load: Partial<LoadedEpisode> = {}, now = T + 1000) {
  const { mission, ...episode } = honestEpisode();
  const loaded: LoadedEpisode = { mission, worker: WORKER, timeline: { stakedAt: T, episodeSubmittedAt: T + 100 }, episode, ...load };
  const source: EpisodeSource = { load: async () => loaded };
  const written: VerdictEntity[] = [];
  const events: string[] = [];
  const deps = {
    source, sim: new FakeSim(), zeroG: zeroG(), key: KEY, escrow: ESCROW, now: () => now,
    verdicts: { writeVerdict: async (v: VerdictEntity) => { written.push(v); return { entityKey: ("0x" + "ab".repeat(32)) as Hex }; } },
    events: { emit: async (_m: Hex, type: string) => { events.push(type); } },
  };
  return { deps, written, events };
}

describe("handleReplay", () => {
  it("returns a signed Pass Verdict the escrow can recover to this Verifier, and writes it to Arkiv", async () => {
    const { deps, written, events } = setup();
    const res = await handleReplay(deps, MISSION);
    expect(res.verdict).toBe("Pass");
    const signer = await recoverTypedDataAddress({
      domain: eip712Domain(ESCROW), types: verdictTypes, primaryType: "Verdict",
      message: { missionId: MISSION, outcome: Outcome.Pass, evidenceHash: res.evidenceHash }, signature: res.signature,
    });
    expect(signer).toBe(privateKeyToAccount(KEY).address);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ missionId: MISSION, outcome: Outcome.Pass, signature: res.signature, difficultyClass: "medium", steps: 3, collisions: 0, episodeLogRoot: honestEpisode().episodeLogRoot });
    expect(events).toContain("verdict.signed");
  });

  it("signs No-show without replaying when the Episode Submission was late", async () => {
    const { deps } = setup({ timeline: { stakedAt: T, episodeSubmittedAt: T + 301 }, episode: undefined });
    const res = await handleReplay(deps, MISSION);
    expect(res.verdict).toBe("NoShow");
  });

  it("signs No-show when nothing was submitted by stakedAt + episodeWindow", async () => {
    const { deps } = setup({ timeline: { stakedAt: T }, episode: undefined }, T + 301);
    expect((await handleReplay(deps, MISSION)).verdict).toBe("NoShow");
  });

  it("refuses to sign while the Mission is still pending", async () => {
    const { deps } = setup({ timeline: { stakedAt: T }, episode: undefined }, T + 50);
    await expect(handleReplay(deps, MISSION)).rejects.toThrow(/pending/);
  });

  it("the same non-replayed Outcome yields the same evidenceHash on every Verifier", async () => {
    const a = await handleReplay(setup({ timeline: { stakedAt: T }, episode: undefined }, T + 400).deps, MISSION);
    const b = await handleReplay(setup({ timeline: { stakedAt: T }, episode: undefined }, T + 500).deps, MISSION);
    expect(a.evidenceHash).toBe(b.evidenceHash);
    expect(a.evidenceHash).toBe(keccak256(toBytes(`{"missionId":"${MISSION}","outcome":${Outcome.NoShow}}`)));
  });
});
