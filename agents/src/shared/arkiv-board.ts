// Arkiv adapters (I4) for the Worker's BoardPort and the Requester's RequesterBoardPort, on top of @dewo/board.
// The library is passed in, so tests and offline demos can hand over @dewo/board/mock (same exports, board D6).
// This is where the two vocabularies meet: hex ciphertexts vs bytes, maxBounty vs bounty, basis points vs a decimal
// Risk Weight, and the comma-joined Verifier list whose order is the order of the sealed prices (D7).
import type * as Board from "@dewo/board";
import { bytesToHex, hexToBytes } from "viem";
import { privateKeyToAddress, publicKeyToAddress } from "viem/accounts";
import type { Hex } from "../formats";
import type { MissionListing, RequesterBoardPort } from "../requester/ports";
import type { BidEntity, BoardPort, SeedRelease } from "../worker/ports";

/** The @dewo/board functions the agents call; the real library and @dewo/board/mock both provide them. */
export type BoardLibrary = Pick<
  typeof Board,
  | "listOpenMissions"
  | "getMission"
  | "postMission"
  | "listBids"
  | "sealBid"
  | "openBid"
  | "placeBid"
  | "releaseSeed"
  | "readSeedRelease"
  | "seedReleasedAt"
  | "revealSeed"
  | "readSeedReveal"
  | "listVerdicts"
  | "writeVerdict"
  | "reliability"
>;

/** The Arkiv write client of one agent (`makeClients({ privateKey }).wallet`). */
export type BoardWallet = Board.Wallet;

/** Every Bid's sealed prices and its `verifiers` field follow this order (D7). */
export interface VerifierKeys {
  verifierPubKeys: readonly Hex[];
}

type Trio = [Hex, Hex, Hex];

function verifierTrio(pubKeys: readonly Hex[]): Trio {
  if (pubKeys.length !== 3) throw new Error(`a Mission has exactly 3 Verifiers, got ${pubKeys.length} public keys`);
  return [pubKeys[0]!, pubKeys[1]!, pubKeys[2]!];
}

/** The `verifiers` field of Mission and Bid entities: comma-joined addresses in Verifier order. */
const verifierList = (pubKeys: Trio): string => pubKeys.map((key) => publicKeyToAddress(key)).join(",");

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The Worker's side of the board: discovery, Reliability, its sealed Bid and its Seed Release. */
export class WorkerArkivBoard implements BoardPort {
  private readonly verifierPubKeys: Trio;
  private readonly verifierAddresses: Hex[];

  constructor(
    private readonly lib: BoardLibrary,
    private readonly wallet: BoardWallet,
    private readonly config: VerifierKeys & { privateKey: Hex },
  ) {
    this.verifierPubKeys = verifierTrio(config.verifierPubKeys);
    this.verifierAddresses = this.verifierPubKeys.map((key) => publicKeyToAddress(key));
    if (!sameAddress(privateKeyToAddress(config.privateKey), wallet.account.address)) {
      throw new Error("the Arkiv wallet and the Seed Release key must be the same Worker key");
    }
  }

  async listOpenMissionIds(): Promise<string[]> {
    return (await this.lib.listOpenMissions()).map((mission) => mission.missionId);
  }

  /** From Verdicts written by this Worker's 3 Verifiers only, the set the Verifiers themselves score with. */
  async reliabilityOf(worker: Hex): Promise<number> {
    return this.lib.reliability(await this.lib.listVerdicts({ worker }), this.verifierAddresses);
  }

  async sealBid(price: bigint, verifierPubKeys: readonly Hex[]): Promise<readonly string[]> {
    const keys = verifierTrio(verifierPubKeys);
    if (keys.some((key, i) => key.toLowerCase() !== this.verifierPubKeys[i]!.toLowerCase())) {
      throw new Error("sealBid got Verifier keys other than VERIFIER_PUBKEYS, in that order (D7)");
    }
    const { priceCt0, priceCt1, priceCt2 } = this.lib.sealBid(price, keys);
    return [priceCt0, priceCt1, priceCt2].map((ciphertext) => bytesToHex(ciphertext));
  }

  async placeBid(bid: BidEntity): Promise<{ key: string }> {
    if (!sameAddress(bid.worker, this.wallet.account.address)) throw new Error("cannot place a Bid for another Worker");
    const [priceCt0, priceCt1, priceCt2] = verifierTrio(bid.sealedPrice as readonly Hex[]).map((ciphertext) => hexToBytes(ciphertext));
    const { entityKey } = await this.lib.placeBid(this.wallet, {
      missionId: bid.missionId as Hex,
      policyHash: bid.policyHash,
      workerPubKey: bid.workerPubKey,
      verifiers: verifierList(this.verifierPubKeys),
      priceCt0: priceCt0!,
      priceCt1: priceCt1!,
      priceCt2: priceCt2!,
    });
    return { key: entityKey };
  }

  /** Any own Bid counts, even one past the bidding cutoff: the point is never to bid twice. */
  async myBid(missionId: string, worker: Hex): Promise<{ key: string } | null> {
    const bids = await this.lib.listBids(missionId as Hex, { closesAt: Number.MAX_SAFE_INTEGER });
    const mine = bids.find((bid) => sameAddress(bid.worker, worker));
    return mine ? { key: mine.$key } : null;
  }

  /** releasedAt is the Release's block time, the clock the Verifiers judge the episodeWindow by. */
  async readSeedRelease(missionId: string): Promise<SeedRelease | null> {
    const release = await this.lib.readSeedRelease(missionId as Hex, this.config.privateKey);
    if (!release) return null;
    const releasedAt = await this.lib.seedReleasedAt(missionId as Hex, this.wallet.account.address);
    if (releasedAt === null) return null;
    return { seed: release.seed as Hex, salt: release.salt as Hex, releasedAt };
  }
}

/** The Requester's side of the board: its Mission listing and the seed hand-over. */
export class RequesterArkivBoard implements RequesterBoardPort {
  private readonly verifiers: string;

  constructor(
    private readonly lib: BoardLibrary,
    private readonly wallet: BoardWallet,
    config: VerifierKeys,
  ) {
    this.verifiers = verifierList(verifierTrio(config.verifierPubKeys));
  }

  async postMission(listing: MissionListing): Promise<{ key: string }> {
    const { entityKey } = await this.lib.postMission(this.wallet, {
      missionId: listing.missionId as Hex,
      difficultyClass: listing.difficultyClass,
      bounty: listing.maxBounty,
      biddingClosesAt: listing.biddingClosesAt,
      seedCommitment: listing.seedCommitment,
      riskWeight: listing.riskWeightBps / 10_000,
      verifiers: this.verifiers,
    });
    return { key: entityKey };
  }

  /** From the Bids that count (first per Worker, owned by it, before the close), like the Verifiers see them. */
  async workerPubKey(missionId: string, worker: Hex): Promise<Hex | null> {
    const bids = await this.lib.listBids(missionId as Hex);
    return bids.find((bid) => sameAddress(bid.worker, worker))?.workerPubKey ?? null;
  }

  async hasSeedRelease(missionId: string, worker: Hex): Promise<boolean> {
    return (await this.lib.seedReleasedAt(missionId as Hex, worker, this.wallet.account.address)) !== null;
  }

  async releaseSeed(missionId: string, seed: Hex, salt: Hex, workerPubKey: Hex): Promise<{ key: string }> {
    const { entityKey } = await this.lib.releaseSeed(this.wallet, missionId as Hex, seed, salt, workerPubKey);
    return { key: entityKey };
  }

  async revealSeed(missionId: string, seed: Hex, salt: Hex): Promise<void> {
    await this.lib.revealSeed(this.wallet, missionId as Hex, seed, salt);
  }
}
