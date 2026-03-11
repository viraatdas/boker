import { describe, expect, test } from "vitest";
import {
  applyAutoAction,
  applyPlayerAction,
  buildBotPrompt,
  buildBotView,
  createTable,
  createTableSnapshot,
  getLegalActions,
  maybeStartHand,
  seatPlayer,
  type Card
} from "../src";

function card(code: string): Card {
  return { rank: code[0] as Card["rank"], suit: code[1] as Card["suit"] };
}

function riggedDeck(cards: string[]): Card[] {
  const used = new Set(cards);
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
  const suits = ["c", "d", "h", "s"] as const;
  const remaining: Card[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      const code = `${rank}${suit}`;
      if (!used.has(code)) {
        remaining.push({ rank, suit });
      }
    }
  }
  return [...cards.map(card), ...remaining];
}

function setupThreePlayerTable(deck?: Card[]) {
  let table = createTable({
    guestId: crypto.randomUUID(),
    displayName: "Host",
    config: {
      visibility: "private",
      smallBlind: 5,
      bigBlind: 10,
      minBuyIn: 100,
      maxBuyIn: 500,
      aiSeatCount: 0
    }
  });
  table = seatPlayer(table, { guestId: crypto.randomUUID(), displayName: "Alice", seatIndex: 0, buyIn: 100 }, { autoStart: false });
  table = seatPlayer(table, { guestId: crypto.randomUUID(), displayName: "Bob", seatIndex: 1, buyIn: 100 }, { autoStart: false });
  table = seatPlayer(table, { guestId: crypto.randomUUID(), displayName: "Cara", seatIndex: 2, buyIn: 100 }, { deck, autoStart: false });
  return maybeStartHand(table, { deck });
}

describe("engine", () => {
  test("posts blinds and rotates action on hand start", () => {
    const table = setupThreePlayerTable();
    expect(table.currentHand).not.toBeNull();
    expect(table.currentHand?.smallBlindSeatIndex).toBe(1);
    expect(table.currentHand?.bigBlindSeatIndex).toBe(2);
    expect(table.currentHand?.actingSeatIndex).toBe(0);
    expect(table.seats[1]?.player?.stack).toBe(95);
    expect(table.seats[2]?.player?.stack).toBe(90);
  });

  test("returns legal actions for acting player only", () => {
    const table = setupThreePlayerTable();
    const actingGuestId = table.seats[0]?.player?.guestId ?? null;
    const legal = getLegalActions(table, actingGuestId);
    expect(legal?.canFold).toBe(true);
    expect(legal?.callAmount).toBe(10);
    expect(legal?.raiseRange?.min).toBe(20);
    const nonActor = getLegalActions(table, table.seats[1]?.player?.guestId ?? null);
    expect(nonActor).toBeNull();
  });

  test("handles side pots and awards the main pot to the best eligible hand", () => {
    const deck = riggedDeck(["Ah", "Kh", "Qd", "Qs", "2c", "2d", "9h", "Th", "Jh", "7c", "3d"]);
    let table = createTable({
      guestId: crypto.randomUUID(),
      displayName: "Host",
      config: {
        visibility: "private",
        smallBlind: 5,
        bigBlind: 10,
        minBuyIn: 20,
        maxBuyIn: 500,
        aiSeatCount: 0
      }
    });
    table = seatPlayer(table, { guestId: crypto.randomUUID(), displayName: "Short", seatIndex: 0, buyIn: 20 }, { autoStart: false });
    table = seatPlayer(table, { guestId: crypto.randomUUID(), displayName: "Cover1", seatIndex: 1, buyIn: 100 }, { autoStart: false });
    table = seatPlayer(table, { guestId: crypto.randomUUID(), displayName: "Cover2", seatIndex: 2, buyIn: 100 }, { autoStart: false });
    table = maybeStartHand(table, { deck });

    const short = table.seats[0]!.player!.guestId!;
    const cover1 = table.seats[1]!.player!.guestId!;
    const cover2 = table.seats[2]!.player!.guestId!;

    ({ table } = applyPlayerAction(table, { guestId: short, action: "call" }));
    ({ table } = applyPlayerAction(table, { guestId: cover1, action: "raise", amount: 100 }));
    ({ table } = applyPlayerAction(table, { guestId: cover2, action: "call" }));
    ({ table } = applyPlayerAction(table, { guestId: short, action: "call" }));

    expect(table.handHistory[0]?.totalPot).toBeGreaterThan(0);
    const winners = table.handHistory[0]?.winners ?? [];
    expect(winners.length).toBeGreaterThan(0);
    expect(winners.some((winner) => winner.displayName === "Short")).toBe(true);
    expect(table.seats.find((seat) => seat.player?.guestId === short)?.player?.stack).toBeGreaterThan(20);
    expect(table.seats.reduce((total, seat) => total + (seat.player?.stack ?? 0), 0) + (table.currentHand?.pot ?? 0)).toBe(220);
  });

  test("splits pot on tied board", () => {
    const deck = riggedDeck(["2c", "3d", "4c", "5d", "Ah", "Kd", "Qc", "Js", "Th"]);
    let table = createTable({
      guestId: crypto.randomUUID(),
      displayName: "Host",
      config: {
        visibility: "private",
        smallBlind: 5,
        bigBlind: 10,
        minBuyIn: 100,
        maxBuyIn: 500,
        aiSeatCount: 0
      }
    });
    table = seatPlayer(table, { guestId: crypto.randomUUID(), displayName: "A", seatIndex: 0, buyIn: 100 }, { autoStart: false });
    table = seatPlayer(table, { guestId: crypto.randomUUID(), displayName: "B", seatIndex: 1, buyIn: 100 }, { autoStart: false });
    table = maybeStartHand(table, { deck });

    const first = table.seats[0]!.player!.guestId!;
    const second = table.seats[1]!.player!.guestId!;

    ({ table } = applyPlayerAction(table, { guestId: first, action: "call" }));
    ({ table } = applyPlayerAction(table, { guestId: second, action: "check" }));
    ({ table } = applyPlayerAction(table, { guestId: second, action: "check" }));
    ({ table } = applyPlayerAction(table, { guestId: first, action: "check" }));
    ({ table } = applyPlayerAction(table, { guestId: second, action: "check" }));
    ({ table } = applyPlayerAction(table, { guestId: first, action: "check" }));
    ({ table } = applyPlayerAction(table, { guestId: second, action: "check" }));
    ({ table } = applyPlayerAction(table, { guestId: first, action: "check" }));

    const result = table.handHistory[0]!;
    expect(result.winners.length).toBe(2);
    expect(result.winners[0]?.amount).toBe(result.winners[1]?.amount);
  });

  test("auto action checks when legal and folds otherwise", () => {
    let table = setupThreePlayerTable();
    const actingGuestId = table.seats[0]!.player!.guestId!;
    ({ table } = applyAutoAction(table, actingGuestId));
    expect(table.currentHand?.players.find((player) => player.seatIndex === 0)?.folded).toBe(true);

    table = createTable({
      guestId: crypto.randomUUID(),
      displayName: "Host",
      config: {
        visibility: "private",
        smallBlind: 5,
        bigBlind: 10,
        minBuyIn: 100,
        maxBuyIn: 500,
        aiSeatCount: 0
      }
    });
    table = seatPlayer(table, { guestId: crypto.randomUUID(), displayName: "A", seatIndex: 0, buyIn: 100 }, { autoStart: false });
    table = seatPlayer(table, { guestId: crypto.randomUUID(), displayName: "B", seatIndex: 1, buyIn: 100 }, { autoStart: false });
    table = maybeStartHand(table);
    table.currentHand!.actingSeatIndex = 1;
    table.currentHand!.currentBet = 5;
    table.currentHand!.players.find((player) => player.seatIndex === 1)!.committed = 5;
    const guestId = table.seats[1]!.player!.guestId!;
    ({ table } = applyAutoAction(table, guestId));
    expect(table.currentHand?.players.find((player) => player.seatIndex === 1)?.lastAction).toBe("check");
  });

  test("snapshot hides opponents hole cards and bot prompt excludes them", () => {
    let table = createTable({
      guestId: crypto.randomUUID(),
      displayName: "Host",
      config: {
        visibility: "private",
        smallBlind: 5,
        bigBlind: 10,
        minBuyIn: 100,
        maxBuyIn: 500,
        aiSeatCount: 0
      }
    });
    table = seatPlayer(table, { guestId: crypto.randomUUID(), displayName: "Human", seatIndex: 0, buyIn: 100 });
    table = seatPlayer(table, { guestId: null, displayName: "Bot", seatIndex: 1, buyIn: 100, isBot: true });

    const snapshot = createTableSnapshot(table, table.seats[0]!.player!.guestId);
    expect(snapshot.seats[0]?.holeCards.length).toBe(2);
    expect(snapshot.seats[1]?.holeCards.length).toBe(0);

    const prompt = buildBotPrompt(buildBotView(table, null));
    expect(prompt).toContain("Hole cards:");
    const humanCards = table.currentHand?.players.find((player) => player.seatIndex === 0)?.holeCards ?? [];
    for (const hiddenCard of humanCards) {
      expect(prompt).not.toContain(`${hiddenCard.rank}${hiddenCard.suit}`);
    }
  });
});
