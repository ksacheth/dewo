import type { Hex } from "../formats";
import type { StoragePort } from "./ports";

export interface Document {
  /** The root computed locally (StoragePort.rootOf), the one the Episode Submission names. */
  root: Hex;
  bytes: Uint8Array;
}

interface Upload {
  stored: boolean;
  /** The Mission is over with this Worker: drop the entry as soon as the upload settles. */
  released: boolean;
  done: Promise<void>;
}

/**
 * The 0G Storage uploads of a flown Episode, one set per Mission and kept across ticks: a later tick rejoins an upload still
 * pending instead of starting another, so an upload stuck waiting for a storage node never piles up copies of itself.
 * A failed upload is logged and forgotten, so the next tick starts it again. Entries are per Mission, never per root: the
 * Policy bytes are the same for every Mission, and each Mission needs its own Flow `Submit` inside its own window.
 * The documents of one Mission upload one after the other, so one signer never sends two Flow transactions at once.
 */
export class PendingUploads {
  private readonly uploads = new Map<string, Upload>();

  constructor(private readonly storage: StoragePort) {}

  /**
   * True once every document of the Mission is stored; false if that takes longer than `waitMs` or an upload failed
   * (logged here, and started again by the next call). Never rejects.
   */
  async storedWithin(missionId: string, documents: readonly Document[], waitMs: number): Promise<boolean> {
    const upload = this.uploads.get(missionId) ?? this.start(missionId, documents);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, Math.max(0, waitMs));
    });
    try {
      await Promise.race([upload.done, timeout]);
    } finally {
      clearTimeout(timer);
    }
    return upload.stored;
  }

  /** The Mission needs its uploads no more: forget them, now or once the pending one settles. */
  release(missionId: string): void {
    const upload = this.uploads.get(missionId);
    if (!upload) return;
    upload.released = true;
    if (upload.stored) this.uploads.delete(missionId);
  }

  private start(missionId: string, documents: readonly Document[]): Upload {
    const upload: Upload = { stored: false, released: false, done: Promise.resolve() };
    upload.done = this.uploadAll(documents).then(
      () => {
        upload.stored = true;
        if (upload.released) this.uploads.delete(missionId);
      },
      (error) => {
        console.error(`worker: 0G Storage upload for ${missionId} failed, will start it again:`, error);
        this.uploads.delete(missionId);
      },
    );
    this.uploads.set(missionId, upload);
    return upload;
  }

  private async uploadAll(documents: readonly Document[]): Promise<void> {
    for (const { root, bytes } of documents) {
      const stored = await this.storage.upload(bytes);
      if (stored.toLowerCase() !== root.toLowerCase()) throw new Error(`0G Storage stored ${stored}, but the Episode names ${root}`);
    }
  }
}
