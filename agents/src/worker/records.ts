// The Worker's private per-Mission notebook. Chain and Arkiv are the source of truth;
// this is a cache that says where the Worker got to, written only after an action is
// confirmed, and reconciled against the chain on startup.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Stage =
  | "SKIPPED"
  | "BID_PLACED"
  | "WON"
  | "STAKED"
  | "EPISODE_RUNNING"
  | "SUBMITTED"
  | "LOST"
  | "GAVE_UP"
  | "DONE";

/** Stages the Worker still has to act on or watch. */
export const ACTIVE_STAGES: ReadonlySet<Stage> = new Set(["BID_PLACED", "WON", "STAKED", "EPISODE_RUNNING", "SUBMITTED"]);

/** Stages that occupy the rover: the Worker bids on nothing else meanwhile. */
export const BUSY_STAGES: ReadonlySet<Stage> = new Set(["WON", "STAKED", "EPISODE_RUNNING"]);

export interface MissionRecord {
  missionId: string;
  stage: Stage;
  price?: number;
  /** Why the record reached its stage, for SKIPPED, LOST and GAVE_UP. */
  note?: string;
}

export interface RecordStore {
  all(): MissionRecord[];
  get(missionId: string): MissionRecord | undefined;
  put(record: MissionRecord): void;
}

export class MemoryRecordStore implements RecordStore {
  protected readonly records = new Map<string, MissionRecord>();

  all(): MissionRecord[] {
    return [...this.records.values()];
  }

  get(missionId: string): MissionRecord | undefined {
    return this.records.get(missionId);
  }

  put(record: MissionRecord): void {
    this.records.set(record.missionId, record);
  }
}

/** A JSON file, rewritten atomically (temp file + rename) on every change. */
export class FileRecordStore extends MemoryRecordStore {
  constructor(private readonly path: string) {
    super();
    if (!existsSync(path)) return;
    const saved = JSON.parse(readFileSync(path, "utf8")) as MissionRecord[];
    for (const record of saved) this.records.set(record.missionId, record);
  }

  override put(record: MissionRecord): void {
    super.put(record);
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify(this.all(), null, 2));
    renameSync(temp, this.path);
  }
}
