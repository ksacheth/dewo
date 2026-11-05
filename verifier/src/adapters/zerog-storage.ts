import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Indexer } from "@0gfoundation/0g-storage-ts-sdk";
import type { Hex } from "viem";
import type { StoragePort } from "../ports.js";

/** 0G Storage download by root hash with Merkle proof verification. Needs network; not unit-tested. */
export function zeroGStorage(indexerUrl: string): StoragePort {
  const indexer = new Indexer(indexerUrl);
  return {
    async downloadJson<T>(root: Hex): Promise<T> {
      const dir = await mkdtemp(join(tmpdir(), "dewo-0g-"));
      try {
        const path = join(dir, "doc.json");
        const err = await indexer.download(root, path, true);
        if (err) throw err;
        return JSON.parse(await readFile(path, "utf8")) as T;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
