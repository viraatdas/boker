import { Card } from "./types.js";
import { rankValue } from "./cards.js";

const CATEGORY_NAMES = [
  "High Card",
  "One Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush"
] as const;

export interface EvaluatedHand {
  score: number[];
  label: string;
}

function compareScores(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) {
      return a - b;
    }
  }
  return 0;
}

function sortDesc(values: number[]): number[] {
  return [...values].sort((a, b) => b - a);
}

function straightHigh(values: number[]): number | null {
  const distinct = Array.from(new Set(values)).sort((a, b) => b - a);
  if (distinct[0] === 14) {
    distinct.push(1);
  }

  let run = 1;
  for (let index = 1; index < distinct.length; index += 1) {
    if (distinct[index - 1] - 1 === distinct[index]) {
      run += 1;
      if (run >= 5) {
        return distinct[index - 4];
      }
    } else {
      run = 1;
    }
  }

  return null;
}

function evaluateFive(cards: Card[]): EvaluatedHand {
  const values = cards.map((card) => rankValue(card.rank));
  const valueCounts = new Map<number, number>();
  for (const value of values) {
    valueCounts.set(value, (valueCounts.get(value) ?? 0) + 1);
  }

  const groups = Array.from(valueCounts.entries()).sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return right[0] - left[0];
  });

  const isFlush = cards.every((card) => card.suit === cards[0]?.suit);
  const straight = straightHigh(values);

  if (isFlush && straight) {
    return {
      score: [8, straight],
      label: straight === 14 ? "Royal Flush" : "Straight Flush"
    };
  }

  if (groups[0]?.[1] === 4) {
    return {
      score: [7, groups[0][0], groups[1]?.[0] ?? 0],
      label: "Four of a Kind"
    };
  }

  if (groups[0]?.[1] === 3 && groups[1]?.[1] === 2) {
    return {
      score: [6, groups[0][0], groups[1][0]],
      label: "Full House"
    };
  }

  if (isFlush) {
    return {
      score: [5, ...sortDesc(values)],
      label: "Flush"
    };
  }

  if (straight) {
    return {
      score: [4, straight],
      label: "Straight"
    };
  }

  if (groups[0]?.[1] === 3) {
    const kickers = groups.slice(1).map(([value]) => value).sort((a, b) => b - a);
    return {
      score: [3, groups[0][0], ...kickers],
      label: "Three of a Kind"
    };
  }

  if (groups[0]?.[1] === 2 && groups[1]?.[1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    return {
      score: [2, ...pairs, groups[2]?.[0] ?? 0],
      label: "Two Pair"
    };
  }

  if (groups[0]?.[1] === 2) {
    const kickers = groups.slice(1).map(([value]) => value).sort((a, b) => b - a);
    return {
      score: [1, groups[0][0], ...kickers],
      label: "One Pair"
    };
  }

  return {
    score: [0, ...sortDesc(values)],
    label: CATEGORY_NAMES[0]
  };
}

export function evaluateSeven(cards: Card[]): EvaluatedHand {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error("evaluateSeven expects 5 to 7 cards");
  }

  let best: EvaluatedHand | null = null;
  for (let a = 0; a < cards.length - 4; a += 1) {
    for (let b = a + 1; b < cards.length - 3; b += 1) {
      for (let c = b + 1; c < cards.length - 2; c += 1) {
        for (let d = c + 1; d < cards.length - 1; d += 1) {
          for (let e = d + 1; e < cards.length; e += 1) {
            const candidate = evaluateFive([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!]);
            if (!best || compareScores(candidate.score, best.score) > 0) {
              best = candidate;
            }
          }
        }
      }
    }
  }

  if (!best) {
    throw new Error("Could not evaluate hand");
  }

  return best;
}

export function compareHands(left: Card[], right: Card[]): number {
  return compareScores(evaluateSeven(left).score, evaluateSeven(right).score);
}
