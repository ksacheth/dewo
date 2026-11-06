import { describe, expect, it, vi } from "vitest";
import { Wallet } from "ethers";

const uploads: unknown[][] = [];
vi.mock("@0gfoundation/0g-storage-ts-sdk", () => ({
  MemData: class { constructor(readonly bytes: Uint8Array) {} },
  Indexer: class {
    constructor(readonly url: string) {}
    async upload(...args: unknown[]) {
      uploads.push(args);
      return [{ txHash: "0xtx", rootHash: `0x${"ab".repeat(32)}`, txSeq: 1 }, null];
    }
  },
}));

const { ZeroGStorage } = await import("../src/shared/zg-storage");

describe("ZeroGStorage.upload", () => {
  it("submits the root to the Flow contract even when the bytes are already stored (issue #64)", async () => {
    const signer = Wallet.createRandom();
    const root = await new ZeroGStorage(signer, "http://rpc.test", "http://indexer.test").upload(new TextEncoder().encode("{}"));
    expect(root).toBe(`0x${"ab".repeat(32)}`);
    expect(uploads).toHaveLength(1);
    const [, rpc, usedSigner, options] = uploads[0];
    expect([rpc, usedSigner]).toEqual(["http://rpc.test", signer]);
    // The SDK default skips the Flow submission for finalized bytes; Verifiers would then count a reused Policy as never uploaded.
    expect(options).toEqual({ skipIfFinalized: false });
  });
});
