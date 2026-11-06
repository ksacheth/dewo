import { useEffect } from "react"
import { usePoll } from "../arkiv"
import { API } from "../api"
import { Leaderboard } from "../panels/Leaderboard"

export default function LeaderboardPage() {
  const { data: names } = usePoll<Record<string, string>>(API.workerNames, 10000)
  useEffect(() => { document.title = "Dewo · Leaderboard" }, [])
  return <main className="page"><Leaderboard names={names ?? {}} /></main>
}
