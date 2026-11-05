import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Hex } from "viem";
import type { EventSink } from "./ports.js";

/** I8: append JSON lines to runs/<missionId>/events.<process>.ndjson (one file per process, no write races). */
export function ndjsonEvents(runsDir: string, processName: string): EventSink {
  return {
    async emit(missionId: Hex, type: string, data: Record<string, unknown>) {
      const dir = join(runsDir, missionId);
      await mkdir(dir, { recursive: true });
      const line = JSON.stringify({ ts: new Date().toISOString(), type, missionId, data }, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
      await appendFile(join(dir, `events.${processName}.ndjson`), line + "\n");
    },
  };
}
