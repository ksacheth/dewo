import { emit, type EventData, type EventType } from "@dewo/board";
import type { Hex } from "viem";
import type { EventSink } from "./ports.js";

/**
 * I8: appends to runs/<missionId>/events.<process>.ndjson through the board's `emit` (one file per process, no write races).
 * The folder is RUNS_DIR, else <repo root>/runs. `processName` must match [a-z0-9-]+, e.g. "verifier-1".
 */
export function boardEvents(processName: string): EventSink {
  return {
    async emit<T extends EventType>(missionId: Hex, type: T, data: EventData[T], txUrl?: string) {
      emit(missionId, processName, { type, data, ...(txUrl ? { txUrl } : {}) });
    },
  };
}
