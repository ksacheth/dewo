import { and, asc, eq, or } from "@arkiv-network/sdk/query";
import { addr } from "@arkiv-network/sdk/schema";
import {
  Verdict, fetchAll, listBids, makeClients, openBid, plain, readClient, reliability, writeVerdict, type BidRow, type VerdictRow,
} from "@dewo/board";
import type { Hex } from "viem";
import type { BoardPort, VerdictSink } from "../ports.js";
import { outcomeName } from "../sign.js";

export interface ArkivAdapters { board: BoardPort; verdicts: VerdictSink }

/** Every Verdict about `worker` written by one of `verifiers` (a Mission's own Verifiers, read from the escrow), newest first. */
async function verdictsBy(worker: Hex, verifiers: readonly Hex[]): Promise<VerdictRow[]> {
  const rows = await fetchAll<Record<string, unknown>>((offset) =>
    readClient().select().from(Verdict)
      .where(and(eq("worker", addr(worker)), or(...verifiers.map((v) => eq("$owner", addr(v))))) as never)
      .orderBy(asc("$key")).limit(100).offset(offset).fetch(),
  );
  return rows.map((r) => plain<VerdictRow>(r));
}

/**
 * The real Arkiv side, on top of @dewo/board. Needs ARKIV_ACCESS_KEY. Which Verdicts count is decided per Mission by the
 * Verifiers listed in the escrow, so VERIFIER_ADDRESSES is not read here.
 * `verifierKey` decrypts this Verifier's copy of each sealed price and signs the Arkiv writes.
 */
export function arkivAdapters(verifierKey: Hex): ArkivAdapters {
  const { wallet } = makeClients({ privateKey: verifierKey });
  if (!wallet) throw new Error("could not create an Arkiv wallet client");

  const board: BoardPort = {
    async listBids(missionId, closesAt) {
      return (await listBids(missionId, { closesAt })).map((row) => ({ key: row.$key, worker: row.worker, policyHash: row.policyHash as Hex, ciphertext: row }));
    },
    async openBid(bid, maxBounty) {
      return openBid(bid.ciphertext as BidRow, verifierKey, maxBounty);
    },
    async reliabilityOf(worker, verifiers) {
      return reliability(await verdictsBy(worker, [...verifiers]), [...verifiers]);
    },
  };

  const verdicts: VerdictSink = {
    async writeVerdict(v) {
      const { entityKey } = await writeVerdict(wallet, { ...v, outcome: outcomeName(v.outcome) });
      return { entityKey };
    },
  };

  return { board, verdicts };
}
