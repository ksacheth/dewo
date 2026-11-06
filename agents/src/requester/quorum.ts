import type { Hex } from "../formats";

export interface Quorum<T> {
  value: T;
  signatures: Hex[];
}

/** The first answer that `size` Verifiers agree on (by `key`), with their signatures; null if none yet. */
export function quorum<T extends { signature: Hex }>(
  answers: readonly (T | null | undefined)[],
  key: (answer: T) => string,
  size = 2,
): Quorum<T> | null {
  const groups = new Map<string, T[]>();
  for (const answer of answers) {
    if (!answer) continue;
    const group = [...(groups.get(key(answer)) ?? []), answer];
    groups.set(key(answer), group);
    if (group.length >= size) return { value: group[0]!, signatures: group.slice(0, size).map((a) => a.signature) };
  }
  return null;
}
