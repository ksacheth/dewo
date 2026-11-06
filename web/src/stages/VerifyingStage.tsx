import { VerifierNodes } from "../components/VerifierNodes"
import type { MissionState } from "../feed"
import { VerifierCards } from "../panels/VerifierCards"

export function VerifyingStage({ state }: { state: MissionState }) {
  return (
    <>
      <section className="panel stage-hero">
        <h2>Verify · three independent Replays</h2>
        <VerifierNodes state={state} />
        <p className="dim" style={{ textAlign: "center" }}>Each Verifier is paid per Replay over x402, re-runs every Decision, and signs a Verdict. Two matching Verdicts are final.</p>
      </section>
      <VerifierCards state={state} />
    </>
  )
}
