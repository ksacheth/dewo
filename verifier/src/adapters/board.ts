import { and, eq } from "@arkiv-network/sdk/query";
import { addr } from "@arkiv-network/sdk/schema";
import {
  SeedRelease, listBids, listVerdicts, makeClients, openBid, plain, readClient, readSeedReveal, reliability, trustedVerifiers, writeVerdict,
  type BidRow, type SeedReleaseRow,
} from "@dewo/board";
import type { Hex } from "viem";
import type { BoardPort, SeedPort, VerdictSink } from "../ports.js";
import { outcomeName } from "../sign.js";

export interface ArkivAdapters { board: BoardPort; seeds: SeedPort; verdicts: VerdictSink }

/**
 * The real Arkiv side, on top of @dewo/board. Needs ARKIV_ACCESS_KEY and VERIFIER_ADDRESSES (the same value in the Requester,
 * the Workers, the web UI and all three Verifiers: only Verdicts written by those addresses count).
 * `verifierKey` decrypts this Verifier's copy of each sealed price and signs the Arkiv writes.
 */
export function arkivAdapters(verifierKey: Hex): ArkivAdapters {
  const { wallet } = makeClients({ privateKey: verifierKey });
  if (!wallet) throw new Error("could not create an Arkiv wallet client");

  const board: BoardPort = {
    async listBids(missionId) {
      return (await listBids(missionId)).map((row) => ({ key: row.$key, worker: row.worker, policyHash: row.policyHash as Hex, ciphertext: row }));
    },
    async openBid(bid, maxBounty) {
      return openBid(bid.ciphertext as BidRow, verifierKey, maxBounty);
    },
    async reliabilityOf(worker) {
      return reliability(await listVerdicts({ worker }), trustedVerifiers());
    },
  };

  const seeds: SeedPort = {
    async seedReleasedAt(missionId, worker, requester) {
      const { entities } = await readClient().select().from(SeedRelease)
        .where(and(eq("missionId", missionId), eq("worker", addr(worker)))).ownedBy(requester).limit(10).fetch();
      const earliest = entities.map((e) => plain<SeedReleaseRow>(e as never)).sort((a, b) => a.$createdAt - b.$createdAt)[0];
      if (!earliest) return undefined;
      // `$createdAt` is an Arkiv block number; the deadline rules need wall-clock seconds.
      return Number((await readClient().getBlock({ blockNumber: BigInt(earliest.$createdAt) })).timestamp);
    },
    async revealedSeed(missionId, requester) {
      const reveal = await readSeedReveal(missionId, requester);
      return reveal ? { seed: reveal.seed as Hex, salt: reveal.salt as Hex } : null;
    },
  };

  const verdicts: VerdictSink = {
    async writeVerdict(v) {
      const { entityKey } = await writeVerdict(wallet, { ...v, outcome: outcomeName(v.outcome) });
      return { entityKey };
    },
  };

  return { board, seeds, verdicts };
}
