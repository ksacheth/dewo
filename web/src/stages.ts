// The stages of one Mission, as the Mission page shows them. Pure: easy to test, easy to rename.
import type { MissionState } from "./feed"

export const STAGES = [
  { id: "bidding", label: "Bidding" },
  { id: "awarded", label: "Stake" },
  { id: "running", label: "Run" },
  { id: "verifying", label: "Verify" },
  { id: "result", label: "Result" },
] as const
export type StageId = (typeof STAGES)[number]["id"]

export function stageOf(phase: MissionState["phase"]): StageId {
  switch (phase) {
    case "awarded": case "staked": return "awarded"
    case "running": return "running"
    case "verifying": return "verifying"
    case "settled": return "result"
    default: return "bidding" // waiting, posted, bidding
  }
}
export const stageIndex = (id: StageId) => STAGES.findIndex((s) => s.id === id)
