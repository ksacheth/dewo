// I8 event feed: one JSON line per event in runs/<missionId>/events.<process>.ndjson, one file
// per process so writers never race. M3 owns the format (@dewo/board's emit); this writer
// follows it until M4 can import that helper.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { EventsPort } from "../worker/ports";
import { assertMissionId, assertProcessName, type EventData, type EventType } from "./events";

export class FileEvents implements EventsPort {
  constructor(
    private readonly runsDir: string,
    private readonly process: string,
  ) {
    assertProcessName(process);
  }

  emit<T extends EventType>(missionId: string, type: T, data: EventData[T], txUrl?: string): void {
    assertMissionId(missionId);
    const dir = join(this.runsDir, missionId);
    mkdirSync(dir, { recursive: true });
    const event = { ts: new Date().toISOString(), type, missionId, data, ...(txUrl ? { txUrl } : {}) };
    appendFileSync(join(dir, `events.${this.process}.ndjson`), `${JSON.stringify(event)}\n`);
  }
}
