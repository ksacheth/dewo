// 0G Storage adapter for the Episode Log and the revealed Policy (spike #7).
import { Indexer, MemData } from "@0gfoundation/0g-storage-ts-sdk";
import type { Signer } from "ethers";
import type { Hex } from "../formats";
import type { StoragePort } from "../worker/ports";

export const ZG_TESTNET = {
  indexer: "https://indexer-storage-testnet-turbo.0g.ai",
  rpc: "https://evmrpc-testnet.0g.ai",
};

export class ZeroGStorage implements StoragePort {
  private readonly indexer: Indexer;

  constructor(
    private readonly signer: Signer,
    private readonly rpc = ZG_TESTNET.rpc,
    indexerUrl = ZG_TESTNET.indexer,
  ) {
    this.indexer = new Indexer(indexerUrl);
  }

  /**
   * Always submits the root to the Flow contract, even when the same bytes are already stored (the SDK skips that by default):
   * Verifiers count a root with no Flow submission between the stake and the Episode Submission as never uploaded, a Fail.
   */
  async upload(bytes: Uint8Array): Promise<Hex> {
    const [result, error] = await this.indexer.upload(new MemData(bytes), this.rpc, this.signer, { skipIfFinalized: false });
    if (error) throw error;
    if (!("rootHash" in result)) throw new Error("expected one root hash for a single small file");
    return result.rootHash as Hex;
  }

  async rootOf(bytes: Uint8Array): Promise<Hex> {
    const [tree, error] = await new MemData(bytes).merkleTree();
    if (error || !tree) throw error ?? new Error("could not build the Merkle tree");
    return tree.rootHash() as Hex;
  }

  async download(root: Hex): Promise<Uint8Array> {
    const [blob, error] = await this.indexer.downloadToBlob(root);
    if (error) throw error;
    return new Uint8Array(await blob.arrayBuffer());
  }
}
