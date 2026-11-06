import { useEffect } from "react"
import { usePoll } from "../arkiv"
import { API } from "../api"
import { Leaderboard } from "../panels/Leaderboard"
import { PageHeader } from "../ui"

export default function LeaderboardPage() {
  const { data: names } = usePoll<Record<string, string>>(API.workerNames, 10000)
  useEffect(() => { document.title = "Dewo · Leaderboard" }, [])
  return (
    <main className="page">
      <PageHeader meta={<span>Reputation earned by proof</span>} title="Leaderboard" description="Every Worker's Reliability, XP and Level, built only from Verdict entities the trusted Verifiers wrote on Arkiv." />
      <Leaderboard names={names ?? {}} />
    </main>
  )
}
