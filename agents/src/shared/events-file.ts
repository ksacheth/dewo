// I8 event feed: one JSON line per event in runs/<missionId>/events.<process>.ndjson.
// M3 owns the format and will export an `emit` helper from @dewo/board; this writer
// follows the same format until then.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { EventsPort } from "../worker/ports";

export class FileEvents implements EventsPort {
  constructor(
    private readonly runsDir: string,
    private readonly process = "agents",
  ) {}

  emit(missionId: string, type: string, data: Record<string, unknown>, txUrl?: string): void {
    const dir = join(this.runsDir, missionId);
    mkdirSync(dir, { recursive: true });
    const event = { ts: new Date().toISOString(), type, missionId, data, ...(txUrl ? { txUrl } : {}) };
    appendFileSync(join(dir, `events.${this.process}.ndjson`), `${JSON.stringify(event)}\n`);
  }
}
