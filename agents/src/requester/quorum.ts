import type { Hex } from "../formats";

export interface Quorum<T> {
  value: T;
  signatures: Hex[];
  /** Positions in the input `answers` of the answers whose signatures were taken. */
  indexes: number[];
}

/** The first answer that `size` Verifiers agree on (by `key`), with their signatures and positions; null if none yet. */
export function quorum<T extends { signature: Hex }>(
  answers: readonly (T | null | undefined)[],
  key: (answer: T) => string,
  size = 2,
): Quorum<T> | null {
  const groups = new Map<string, { answer: T; index: number }[]>();
  for (const [index, answer] of answers.entries()) {
    if (!answer) continue;
    const group = [...(groups.get(key(answer)) ?? []), { answer, index }];
    groups.set(key(answer), group);
    if (group.length >= size) {
      const taken = group.slice(0, size);
      return { value: group[0]!.answer, signatures: taken.map((g) => g.answer.signature), indexes: taken.map((g) => g.index) };
    }
  }
  return null;
}
