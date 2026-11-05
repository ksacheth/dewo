// The runnable query for judges: open Missions and the leaderboard straight from Rabdi.
// pnpm --filter @dewo/board query            (needs ARKIV_ACCESS_KEY and VERIFIER_ADDRESSES in board/.env)
import { explorerUrl } from "../src/client"
import { listOpenMissions } from "../src/missions"
import { leaderboard } from "../src/verdicts"

const missions = await listOpenMissions()
console.log(`Open Missions: ${missions.length}`)
for (const m of missions)
  console.log(`  ${m.difficultyClass.padEnd(6)} ${Number(m.bounty) / 1e6} USDC  closes ${new Date(m.biddingClosesAt * 1000).toISOString()}  ${explorerUrl.entity(m.$key)}`)

const rows = await leaderboard()
console.log(`\nLeaderboard (Verdicts written by VERIFIER_ADDRESSES): ${rows.length} Workers`)
for (const r of rows)
  console.log(`  ${r.worker}  Level ${r.level}  XP ${Math.round(r.xp)}  Reliability ${(r.reliability * 100).toFixed(0)}%  Missions ${r.missions.length}`)
