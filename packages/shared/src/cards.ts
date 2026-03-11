import { Card, RANKS, SUITS } from "./types.js";

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

export function shuffleDeck(deck: Card[], random = Math.random): Card[] {
  const clone = [...deck];
  for (let i = clone.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [clone[i], clone[j]] = [clone[j]!, clone[i]!, clone[i]!];
  }
  return clone;
}

export function cardToString(card: Card): string {
  return `${card.rank}${card.suit}`;
}

export function cardsToString(cards: Card[]): string {
  return cards.map(cardToString).join(" ");
}

export function rankValue(rank: Card["rank"]): number {
  return RANKS.indexOf(rank) + 2;
}
