import { VerifierNodes } from "../components/VerifierNodes"
import type { MissionState } from "../feed"
import { agreement } from "../feed"
import { VerifierCards } from "../panels/VerifierCards"
import { Panel, Tag } from "../ui"

export function VerifyingStage({ state }: { state: MissionState }) {
  const agree = agreement(state)
  return (
    <div className="grid-even">
      <Panel title="Three independent Replays" actions={<Tag tone={agree ? "ok" : "accent"} live={!agree}>{agree ? `${agree.count} of 3 agree` : "2 of 3 needed"}</Tag>}>
        <VerifierNodes state={state} />
        <p className="dim" style={{ textAlign: "center", fontSize: 13 }}>Each Verifier is paid per Replay over x402, re-runs every Decision and signs a Verdict. Two matching Verdicts are final.</p>
      </Panel>
      <VerifierCards state={state} />
    </div>
  )
}
