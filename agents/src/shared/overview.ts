// Spectator view of an Episode: feeds poses to the overview process (sim/overview) and emits a
// rover.moved event per finished move. Display only, so nothing here may touch the Episode: writes
// never wait for a reply, and a missing, crashed or stuck process only means no images.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { relative, resolve } from "node:path";
import { createInterface } from "node:readline";

export type Pose = { x: number; y: number; yaw: number };
export type RoverMoved = { step: number; images: string[]; collision: boolean; atGoal: boolean };
export type OverviewOptions = {
  command: readonly [string, ...string[]];
  emit: (missionId: string, data: RoverMoved) => void;
  /** How long close() waits for the last images. */
  closeTimeoutMs?: number;
};

export class OverviewView {
  private child: ChildProcessWithoutNullStreams | null = null;
  private dead = false;
  private seq = 0;
  private last: Pose | null = null;
  private readonly moves = new Map<number, Omit<RoverMoved, "images">>();

  constructor(
    private readonly options: OverviewOptions,
    private readonly missionId: string,
    course: string,
    outDir: string,
    private readonly runsDir: string,
  ) {
    try {
      const [program, ...prefix] = options.command;
      const child = spawn(program, [...prefix, "--course", course, "--out-dir", outDir], { stdio: "pipe" });
      this.child = child;
      child.on("error", (error) => this.die(error.message));
      child.on("exit", (code) => this.die(`exited (${code})`));
      child.stdin.on("error", (error) => this.die(error.message));
      child.stderr.on("data", () => {}); // never let an unread pipe stall it
      createInterface({ input: child.stdout }).on("line", (line) => this.reply(line));
    } catch (error) {
      this.die(String(error));
    }
  }

  /** Call with each pose the sim reports. The first call draws the start position. */
  show(pose: Pose, collision = false, atGoal = false): void {
    if (this.dead || !this.child) return;
    const seq = this.seq++;
    this.moves.set(seq, { step: seq, collision, atGoal });
    try {
      this.child.stdin.write(`${JSON.stringify({ seq, from: this.last, to: pose, collision })}\n`);
    } catch (error) {
      this.die(String(error));
    }
    this.last = pose;
  }

  /** Waits briefly for the last images, then makes sure the process is gone. Never rejects. */
  async close(): Promise<void> {
    const child = this.child;
    if (!child || this.dead) return;
    await new Promise<void>((done) => {
      const timer = setTimeout(done, this.options.closeTimeoutMs ?? 3000);
      child.once("exit", () => (clearTimeout(timer), done()));
      try {
        child.stdin.end();
      } catch {
        done();
      }
    });
    this.dead = true;
    if (child.exitCode === null) child.kill();
  }

  private reply(line: string): void {
    try {
      const { seq, images } = JSON.parse(line) as { seq: number; images?: string[] };
      const move = this.moves.get(seq);
      if (!move || !images?.length) return;
      this.moves.delete(seq);
      this.options.emit(this.missionId, { ...move, images: images.map((image) => relative(resolve(this.runsDir), image)) });
    } catch (error) {
      console.error(`overview: ignored a reply: ${String(error)}`);
    }
  }

  private die(reason: string): void {
    if (!this.dead) console.error(`overview: no more spectator images: ${reason}`);
    this.dead = true;
  }
}
