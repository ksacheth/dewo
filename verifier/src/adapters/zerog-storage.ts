import { Indexer } from "@0gfoundation/0g-storage-ts-sdk";
import type { Hex } from "viem";
import type { StoragePort } from "../ports.js";

/** What the verifier needs from the 0G indexer: the bytes stored under a root hash, Merkle-checked by the SDK. */
export interface BlobIndexer { downloadToBlob(root: string): Promise<[Blob, Error | null]> }

/** 0G Storage download by root hash, parsed as JSON (the Worker uploads the Episode Log and Policy as JSON bytes). */
export function zeroGStorage(indexer: BlobIndexer): StoragePort {
  return {
    async downloadJson<T>(root: Hex): Promise<T> {
      const [blob, error] = await indexer.downloadToBlob(root);
      if (error) throw error;
      return JSON.parse(await blob.text()) as T;
    },
  };
}

export const indexerAt = (url: string): BlobIndexer => new Indexer(url) as unknown as BlobIndexer;
