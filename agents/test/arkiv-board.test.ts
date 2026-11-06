// The Arkiv board adapters (src/shared/arkiv-board.ts) against @dewo/board's file-backed mock, which has the same
// exports and rules as the real library (board D6). The port contract runs against FakeBoard too, so the fake the
// agent tests rely on and the real adapter agree.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as mock from "@dewo/board/mock";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Hex } from "../src/formats";
import type { MissionListing, RequesterBoardPort } from "../src/requester/ports";
import { RequesterArkivBoard, WorkerArkivBoard, type BoardLibrary, type BoardWallet } from "../src/shared/arkiv-board";
import type { BoardPort } from "../src/worker/ports";
import { FakeBoard, FakeClock, SALT, SEED } from "./fakes";

const lib: BoardLibrary = mock;
const actor = () => {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { privateKey, account, wallet: { account } as unknown as BoardWallet };
};
const missionId = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const nowSec = () => Math.floor(Date.now() / 1000);

let requester: ReturnType<typeof actor>;
let worker: ReturnType<typeof actor>;
let verifiers: ReturnType<typeof actor>[];
let verifierPubKeys: Hex[];

beforeEach(() => {
  process.env.BOARD_MOCK_FILE = join(mkdtempSync(join(tmpdir(), "dewo-agents-board-")), "board-mock.json");
  requester = actor();
  worker = actor();
  verifiers = [actor(), actor(), actor()];
  verifierPubKeys = verifiers.map((v) => v.account.publicKey);
  process.env.VERIFIER_ADDRESSES = verifiers.map((v) => v.account.address).join(",");
});

const listing = (n: number, over: Partial<MissionListing> = {}): MissionListing => ({
  missionId: missionId(n),
  difficultyClass: "medium",
  maxBounty: 10_000_000n,
  riskWeightBps: 5000,
  seedCommitment: `0x${"cc".repeat(32)}`,
  biddingClosesAt: nowSec() + 600,
  ...over,
});

interface Boards {
  requester: RequesterBoardPort;
  worker: BoardPort;
  workerAddress: Hex;
  workerPubKey: Hex;
}

const implementations: [string, () => Boards][] = [
  [
    "FakeBoard",
    () => {
      const board = new FakeBoard(new FakeClock());
      return { requester: board, worker: board, workerAddress: worker.account.address, workerPubKey: worker.account.publicKey };
    },
  ],
  [
    "Arkiv adapters on the board mock",
    () => ({
      requester: new RequesterArkivBoard(lib, requester.wallet, { verifierPubKeys }),
      worker: new WorkerArkivBoard(lib, worker.wallet, { privateKey: worker.privateKey, verifierPubKeys }),
      workerAddress: worker.account.address,
      workerPubKey: worker.account.publicKey,
    }),
  ],
];

describe.each(implementations)("board port contract: %s", (_, make) => {
  async function bid(boards: Boards, n: number): Promise<{ key: string }> {
    const sealedPrice = await boards.worker.sealBid(4_000_000n, verifierPubKeys);
    return boards.worker.placeBid({ missionId: missionId(n), worker: boards.workerAddress, policyHash: `0x${"ab".repeat(32)}`, workerPubKey: boards.workerPubKey, sealedPrice });
  }

  it("a posted Mission is open for Workers", async () => {
    const boards = make();
    expect((await boards.requester.postMission(listing(1))).key).toBeTruthy();
    expect(await boards.worker.listOpenMissionIds()).toContain(missionId(1));
  });

  it("listingOf finds the Requester's own listing once posted, with the key postMission returned", async () => {
    const boards = make();
    expect(await boards.requester.listingOf(missionId(1))).toBeNull();
    const { key } = await boards.requester.postMission(listing(1));
    expect(await boards.requester.listingOf(missionId(1))).toEqual({ key });
    expect(await boards.requester.listingOf(missionId(2))).toBeNull();
  });

  it("myBid finds this Worker's Bid once placed, and the Requester reads its public key", async () => {
    const boards = make();
    await boards.requester.postMission(listing(1));
    expect(await boards.worker.myBid(missionId(1), boards.workerAddress)).toBeNull();
    expect(await boards.requester.workerPubKey(missionId(1), boards.workerAddress)).toBeNull();

    const { key } = await bid(boards, 1);
    expect(await boards.worker.myBid(missionId(1), boards.workerAddress)).toEqual({ key });
    expect(await boards.requester.workerPubKey(missionId(1), boards.workerAddress)).toBe(boards.workerPubKey);
  });

  it("the Worker reads the seed only after the Requester releases it", async () => {
    const boards = make();
    await boards.requester.postMission(listing(1));
    await bid(boards, 1);
    expect(await boards.requester.hasSeedRelease(missionId(1), boards.workerAddress)).toBe(false);
    expect(await boards.worker.readSeedRelease(missionId(1))).toBeNull();

    expect((await boards.requester.releaseSeed(missionId(1), SEED, SALT, boards.workerPubKey)).key).toBeTruthy();
    expect(await boards.requester.hasSeedRelease(missionId(1), boards.workerAddress)).toBe(true);
    expect(await boards.worker.readSeedRelease(missionId(1))).toMatchObject({ seed: SEED, salt: SALT, releasedAt: expect.any(Number) });
  });

});

describe("RequesterArkivBoard", () => {
  const board = () => new RequesterArkivBoard(lib, requester.wallet, { verifierPubKeys });

  it("posts the Mission entity in the board's units", async () => {
    await board().postMission(listing(1, { riskWeightBps: 7500, maxBounty: 12_500_000n }));
    expect(await lib.getMission(missionId(1))).toMatchObject({
      requester: requester.account.address,
      bounty: 12_500_000n,
      riskWeight: 0.75,
      difficultyClass: "medium",
      seedCommitment: `0x${"cc".repeat(32)}`,
      verifiers: verifiers.map((v) => v.account.address).join(","),
    });
  });

  it("listingOf ignores a Mission entity someone else posted for the same Mission id", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await new RequesterArkivBoard(lib, actor().wallet, { verifierPubKeys }).postMission(listing(1));
    expect(await board().listingOf(missionId(1))).toBeNull();
    const { key } = await board().postMission(listing(1));
    expect(await board().listingOf(missionId(1))).toEqual({ key });
    warn.mockRestore();
  });

  it("hasSeedRelease is per Worker", async () => {
    await board().postMission(listing(1));
    await board().releaseSeed(missionId(1), SEED, SALT, worker.account.publicKey);
    expect(await board().hasSeedRelease(missionId(1), actor().account.address)).toBe(false);
  });

  it("revealSeed publishes seed and salt in the clear", async () => {
    await board().postMission(listing(1));
    await board().revealSeed(missionId(1), SEED, SALT);
    expect(await lib.readSeedReveal(missionId(1))).toEqual({ seed: SEED, salt: SALT });
  });
});

describe("WorkerArkivBoard", () => {
  const board = () => new WorkerArkivBoard(lib, worker.wallet, { privateKey: worker.privateKey, verifierPubKeys });

  it("seals the price so each Verifier opens it, in the order of VERIFIER_PUBKEYS (D7)", async () => {
    await new RequesterArkivBoard(lib, requester.wallet, { verifierPubKeys }).postMission(listing(1));
    const sealedPrice = await board().sealBid(4_200_000n, verifierPubKeys);
    await board().placeBid({ missionId: missionId(1), worker: worker.account.address, policyHash: `0x${"ab".repeat(32)}`, workerPubKey: worker.account.publicKey, sealedPrice });

    const [row] = await lib.listBids(missionId(1));
    expect(row!.verifiers).toBe(verifiers.map((v) => v.account.address).join(","));
    for (const v of verifiers) expect(lib.openBid(row!, v.privateKey)).toBe(4_200_000n);
  });

  it("only lists Missions judged by its own Verifiers, in its order (D7), whatever the address case", async () => {
    const post = (n: number, verifiers: string) =>
      lib.postMission(requester.wallet, {
        missionId: missionId(n), difficultyClass: "easy", bounty: 1n, biddingClosesAt: nowSec() + 600, seedCommitment: "0xcc", riskWeight: 0.5, verifiers,
      });
    const addresses = verifiers.map((v) => v.account.address);
    await post(1, addresses.join(",").toLowerCase());
    await post(2, [addresses[1], addresses[0], addresses[2]].join(","));
    await post(3, [actor().account.address, addresses[1], addresses[2]].join(","));
    expect(await board().listOpenMissionIds()).toEqual([missionId(1)]);
  });

  it("refuses to seal for Verifier keys other than its own list, or to bid as another Worker", async () => {
    await expect(board().sealBid(1n, [...verifierPubKeys].reverse())).rejects.toThrow(/Verifier/);
    const sealedPrice = await board().sealBid(1n, verifierPubKeys);
    const other = actor().account;
    await expect(
      board().placeBid({ missionId: missionId(1), worker: other.address, policyHash: "0x00", workerPubKey: other.publicKey, sealedPrice }),
    ).rejects.toThrow(/another Worker/);
  });

  it("does not count a later Bid as missing: myBid ignores the bidding cutoff", async () => {
    await new RequesterArkivBoard(lib, requester.wallet, { verifierPubKeys }).postMission(listing(1, { biddingClosesAt: nowSec() - 1 }));
    const sealedPrice = await board().sealBid(1n, verifierPubKeys);
    const { key } = await board().placeBid({ missionId: missionId(1), worker: worker.account.address, policyHash: "0x00", workerPubKey: worker.account.publicKey, sealedPrice });
    expect(await board().myBid(missionId(1), worker.account.address)).toEqual({ key });
  });

  it("Reliability is the prior (2/3) for a Worker with no Verdicts", async () => {
    expect(await board().reliabilityOf(worker.account.address)).toBeCloseTo(2 / 3);
  });

  it("counts Verdicts only from its own Verifiers toward Reliability", async () => {
    const pass = (n: number) => ({
      missionId: missionId(n), worker: worker.account.address, outcome: "Pass" as const, pathCost: 8, optimalPathCost: 8, collisions: 0,
      difficultyClass: "medium" as const, signature: "0x01", evidenceHash: "0xev", episodeLogRoot: "0xroot",
    });
    await lib.writeVerdict(verifiers[0]!.wallet, pass(1));
    await lib.writeVerdict(verifiers[1]!.wallet, pass(1));
    await lib.writeVerdict(actor().wallet, pass(2));
    await lib.writeVerdict(actor().wallet, pass(2));
    expect(await board().reliabilityOf(worker.account.address)).toBeCloseTo(3 / 4);
  });
});
