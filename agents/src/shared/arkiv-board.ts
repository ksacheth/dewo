// Arkiv adapters (I4) for the Worker's BoardPort and the Requester's RequesterBoardPort, on top of @dewo/board.
// The library is passed in, so tests and offline demos can hand over @dewo/board/mock (same exports, board D6).
// This is where the two vocabularies meet: hex ciphertexts vs bytes, maxBounty vs bounty, basis points vs a decimal
// Risk Weight, and the comma-joined Verifier list whose order is the order of the sealed prices (D7).
import type * as Board from "@dewo/board";
import { bytesToHex, hexToBytes } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import type { Hex } from "../formats";
import type { MissionListing, RequesterBoardPort } from "../requester/ports";
import type { BidEntity, BoardPort } from "../worker/ports";

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

/** A comma-joined address list in a comparable form: trimmed, lowercased, order kept. */
const normalizedList = (list: string): string => list.split(",").map((address) => address.trim().toLowerCase()).join(",");

/** The Worker's side of the board: discovery, Reliability and its sealed Bid. */
export class WorkerArkivBoard implements BoardPort {
  private readonly verifierPubKeys: Trio;
  private readonly verifierAddresses: Hex[];

  constructor(
    private readonly lib: BoardLibrary,
    private readonly wallet: BoardWallet,
    config: VerifierKeys,
  ) {
    this.verifierPubKeys = verifierTrio(config.verifierPubKeys);
    this.verifierAddresses = this.verifierPubKeys.map((key) => publicKeyToAddress(key));
  }

  /**
   * Only Missions listing this Worker's Verifiers in its order: its sealed prices are encrypted to them (D7), so any
   * other Verifier set could not open its Bid. Anyone can post a Mission entity; the escrow terms are checked later.
   */
  async listOpenMissionIds(): Promise<string[]> {
    const mine = normalizedList(this.verifierAddresses.join(","));
    return (await this.lib.listOpenMissions()).filter((mission) => normalizedList(mission.verifiers) === mine).map((mission) => mission.missionId);
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
}

/** The Requester's side of the board: its Mission listing (with the public Course Seed and limits). */
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
      courseSeed: listing.courseSeed,
      maxSteps: listing.maxSteps,
      maxCollisions: listing.maxCollisions,
      riskWeight: listing.riskWeightBps / 10_000,
      verifiers: this.verifiers,
    });
    return { key: entityKey };
  }

  /** Only an entity owned by this wallet counts: anyone can post a Mission entity under our Mission id. */
  async listingOf(missionId: string): Promise<{ key: string } | null> {
    const mine = await this.lib.getMission(missionId as Hex, this.wallet.account.address);
    return mine ? { key: mine.$key } : null;
  }
}
