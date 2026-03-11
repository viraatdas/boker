import { cardsToString, createDeck, shuffleDeck } from "./cards.js";
import { compareHands, evaluateSeven } from "./evaluator.js";
import { createId, createTableCode } from "./id.js";
import type {
  Card,
  CreateTableInput,
  HandPlayerState,
  HandResult,
  HandState,
  LegalActions,
  PlayerActionType,
  TablePlayer,
  TableSeat,
  TableSnapshot,
  TableState,
  VisibleSeatState,
  WinnerSummary
} from "./types.js";

export interface EngineOptions {
  now?: () => string;
  random?: () => number;
  deck?: Card[];
  autoStart?: boolean;
}

const DEFAULT_ACTION_MS = 25_000;
const HAND_HISTORY_LIMIT = 20;

function nowIso(now?: () => string): string {
  return now ? now() : new Date().toISOString();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function makeSeat(seatIndex: number): TableSeat {
  return { seatIndex, player: null };
}

function getSeat(table: TableState, seatIndex: number): TableSeat {
  const seat = table.seats[seatIndex];
  if (!seat) {
    throw new Error("Seat out of range");
  }
  return seat;
}

function getHandPlayer(hand: HandState, playerId: string): HandPlayerState {
  const player = hand.players.find((entry) => entry.playerId === playerId);
  if (!player) {
    throw new Error("Player is not in the current hand");
  }
  return player;
}

function getHandPlayerBySeat(hand: HandState, seatIndex: number): HandPlayerState | null {
  return hand.players.find((entry) => entry.seatIndex === seatIndex) ?? null;
}

function activeSeatIndexes(table: TableState): number[] {
  return table.seats
    .filter((seat) => seat.player && seat.player.stack > 0 && !seat.player.sitOut)
    .map((seat) => seat.seatIndex);
}

function nextOccupiedSeat(seatIndexes: number[], afterSeat: number): number {
  const sorted = [...seatIndexes].sort((left, right) => left - right);
  for (const seatIndex of sorted) {
    if (seatIndex > afterSeat) {
      return seatIndex;
    }
  }
  return sorted[0]!;
}

function nextActionSeat(hand: HandState): number | null {
  const contenders = hand.players.filter((player) => !player.folded && !player.allIn);
  if (contenders.length === 0) {
    return null;
  }

  const sorted = [...contenders].sort((left, right) => left.seatIndex - right.seatIndex);
  const actingSeatIndex = hand.actingSeatIndex ?? hand.dealerSeatIndex;
  for (const contender of sorted) {
    if (contender.seatIndex > actingSeatIndex && (!contender.actedThisRound || contender.committed !== hand.currentBet)) {
      return contender.seatIndex;
    }
  }
  for (const contender of sorted) {
    if (!contender.actedThisRound || contender.committed !== hand.currentBet) {
      return contender.seatIndex;
    }
  }
  return null;
}

function potTotal(hand: HandState): number {
  return hand.players.reduce((total, player) => total + player.totalCommitted, 0);
}

function resetStreet(
  hand: HandState,
  phase: HandState["phase"],
  actingSeatIndex: number | null,
  actionTimeMs: number,
  minRaiseBy: number,
  now?: () => string
): void {
  hand.phase = phase;
  hand.currentBet = 0;
  hand.minRaiseBy = minRaiseBy;
  hand.actingSeatIndex = actingSeatIndex;
  hand.actionDeadlineAt = actingSeatIndex === null ? null : new Date(Date.parse(nowIso(now)) + actionTimeMs).toISOString();
  for (const player of hand.players) {
    player.committed = 0;
    player.actedThisRound = false;
  }
}

function nextStreetSeat(table: TableState, hand: HandState): number | null {
  const eligible = hand.players
    .filter((player) => !player.folded && !player.allIn)
    .map((player) => player.seatIndex);

  if (eligible.length <= 1) {
    return null;
  }

  return nextOccupiedSeat(eligible, hand.dealerSeatIndex);
}

function deductChips(table: TableState, hand: HandState, seatIndex: number, amount: number): number {
  const seat = getSeat(table, seatIndex);
  const tablePlayer = seat.player;
  if (!tablePlayer) {
    throw new Error("Seat is empty");
  }
  const handPlayer = getHandPlayerBySeat(hand, seatIndex);
  if (!handPlayer) {
    throw new Error("Player missing from hand");
  }
  const actual = Math.min(amount, tablePlayer.stack);
  tablePlayer.stack -= actual;
  handPlayer.committed += actual;
  handPlayer.totalCommitted += actual;
  handPlayer.allIn = tablePlayer.stack === 0;
  return actual;
}

function eligibleForNewHand(table: TableState): TablePlayer[] {
  return table.seats
    .map((seat) => seat.player)
    .filter((player): player is TablePlayer => Boolean(player && player.stack > 0 && !player.sitOut));
}

function determineWinners(table: TableState, hand: HandState, now?: () => string): HandResult {
  const contenders = hand.players.filter((player) => !player.folded);
  const thresholds = Array.from(new Set(hand.players.map((player) => player.totalCommitted).filter((value) => value > 0))).sort((a, b) => a - b);
  const winners = new Map<string, WinnerSummary>();
  let previousLevel = 0;

  for (const level of thresholds) {
    const contributors = hand.players.filter((player) => player.totalCommitted >= level);
    const potAmount = (level - previousLevel) * contributors.length;
    previousLevel = level;
    if (potAmount === 0) {
      continue;
    }

    const eligible = contenders.filter((player) => player.totalCommitted >= level);
    if (eligible.length === 0) {
      continue;
    }

    let bestPlayers: HandPlayerState[] = [eligible[0]!];
    for (const contender of eligible.slice(1)) {
      const contenderCards = [...contender.holeCards, ...hand.community];
      const bestCards = [...bestPlayers[0]!.holeCards, ...hand.community];
      const comparison = compareHands(contenderCards, bestCards);
      if (comparison > 0) {
        bestPlayers = [contender];
      } else if (comparison === 0) {
        bestPlayers.push(contender);
      }
    }

    const share = Math.floor(potAmount / bestPlayers.length);
    let remainder = potAmount % bestPlayers.length;
    const orderedWinners = [...bestPlayers].sort((left, right) => left.seatIndex - right.seatIndex);
    for (const winner of orderedWinners) {
      const seat = getSeat(table, winner.seatIndex);
      const tablePlayer = seat.player!;
      const cards = [...winner.holeCards, ...hand.community];
      const evaluated = evaluateSeven(cards);
      const amount = share + (remainder > 0 ? 1 : 0);
      if (remainder > 0) {
        remainder -= 1;
      }
      tablePlayer.stack += amount;
      const existing = winners.get(winner.playerId);
      if (existing) {
        existing.amount += amount;
      } else {
        winners.set(winner.playerId, {
          playerId: winner.playerId,
          displayName: tablePlayer.displayName,
          amount,
          handLabel: evaluated.label,
          holeCards: winner.holeCards
        });
      }
    }
  }

  return {
    handId: hand.handId,
    board: clone(hand.community),
    winners: Array.from(winners.values()),
    totalPot: potTotal(hand),
    endedAt: nowIso(now)
  };
}

function maybeAwardSingleWinner(table: TableState, hand: HandState, now?: () => string): HandResult | null {
  const contenders = hand.players.filter((player) => !player.folded);
  if (contenders.length !== 1) {
    return null;
  }

  const winner = contenders[0]!;
  const tablePlayer = getSeat(table, winner.seatIndex).player!;
  const amount = potTotal(hand);
  tablePlayer.stack += amount;
  return {
    handId: hand.handId,
    board: clone(hand.community),
    winners: [
      {
        playerId: winner.playerId,
        displayName: tablePlayer.displayName,
        amount,
        handLabel: "Uncontested",
        holeCards: winner.holeCards
      }
    ],
    totalPot: amount,
    endedAt: nowIso(now)
  };
}

function completeHand(table: TableState, result: HandResult): HandResult {
  table.handHistory = [result, ...table.handHistory].slice(0, HAND_HISTORY_LIMIT);
  table.currentHand = null;
  table.status = "waiting";
  return result;
}

function maybeAdvanceStreet(table: TableState, options?: EngineOptions): HandResult | null {
  const hand = table.currentHand;
  if (!hand) {
    return null;
  }

  const singleWinner = maybeAwardSingleWinner(table, hand, options?.now);
  if (singleWinner) {
    return completeHand(table, singleWinner);
  }

  const unsettled = hand.players.filter(
    (player) => !player.folded && !player.allIn && (!player.actedThisRound || player.committed !== hand.currentBet)
  );
  if (unsettled.length > 0) {
    return null;
  }

  const canAct = hand.players.filter((player) => !player.folded && !player.allIn);
  if (hand.phase === "river" || canAct.length <= 1) {
    while (hand.community.length < 5) {
      const next = hand.deck.shift();
      if (!next) {
        throw new Error("Deck exhausted");
      }
      hand.community.push(next);
    }
    hand.phase = "showdown";
    const result = determineWinners(table, hand, options?.now);
    return completeHand(table, result);
  }

  if (hand.phase === "preflop") {
    hand.community.push(hand.deck.shift()!, hand.deck.shift()!, hand.deck.shift()!);
    resetStreet(table.currentHand!, "flop", nextStreetSeat(table, hand), table.config.actionTimeMs, table.config.bigBlind, options?.now);
  } else if (hand.phase === "flop") {
    hand.community.push(hand.deck.shift()!);
    resetStreet(table.currentHand!, "turn", nextStreetSeat(table, hand), table.config.actionTimeMs, table.config.bigBlind, options?.now);
  } else if (hand.phase === "turn") {
    hand.community.push(hand.deck.shift()!);
    resetStreet(table.currentHand!, "river", nextStreetSeat(table, hand), table.config.actionTimeMs, table.config.bigBlind, options?.now);
  }

  if (table.currentHand) {
    table.currentHand.pot = potTotal(table.currentHand);
    if (table.currentHand.actingSeatIndex === null) {
      return maybeAdvanceStreet(table, options);
    }
    table.currentHand.actionDeadlineAt = new Date(
      Date.parse(nowIso(options?.now)) + table.config.actionTimeMs
    ).toISOString();
  }

  return null;
}

export function createTable(input: CreateTableInput, options?: EngineOptions): TableState {
  const now = nowIso(options?.now);
  const mode = input.mode ?? "play";
  return {
    tableId: createId(),
    tableCode: createTableCode(),
    hostGuestId: input.guestId,
    lastDealerSeatIndex: null,
    config: {
      visibility: input.config.visibility,
      seatCount: 6,
      smallBlind: input.config.smallBlind,
      bigBlind: input.config.bigBlind,
      minBuyIn: input.config.minBuyIn,
      maxBuyIn: input.config.maxBuyIn,
      aiSeatCount: mode === "crypto" ? 0 : input.config.aiSeatCount,
      actionTimeMs: DEFAULT_ACTION_MS
    },
    mode,
    cryptoConfig: mode === "crypto" ? input.cryptoConfig : undefined,
    status: "waiting",
    seats: Array.from({ length: 6 }, (_, seatIndex) => makeSeat(seatIndex)),
    observers: [],
    currentHand: null,
    handHistory: [],
    createdAt: now,
    updatedAt: now
  };
}

export function addObserver(table: TableState, guest: { guestId: string; displayName: string }, options?: EngineOptions): TableState {
  const next = clone(table);
  const existing = next.observers.find((observer) => observer.guestId === guest.guestId);
  const now = nowIso(options?.now);
  if (existing) {
    existing.displayName = guest.displayName;
    existing.updatedAt = now;
  } else {
    next.observers.push({
      guestId: guest.guestId,
      displayName: guest.displayName,
      createdAt: now,
      updatedAt: now
    });
  }
  next.updatedAt = now;
  return next;
}

export function seatPlayer(
  table: TableState,
  input: { guestId: string | null; displayName: string; seatIndex: number; buyIn: number; isBot?: boolean; walletAddress?: string },
  options?: EngineOptions
): TableState {
  const next = clone(table);
  const seat = getSeat(next, input.seatIndex);
  if (seat.player) {
    throw new Error("Seat is already occupied");
  }
  if (input.buyIn < next.config.minBuyIn || input.buyIn > next.config.maxBuyIn) {
    throw new Error("Buy-in is outside table limits");
  }
  if (next.mode === "crypto") {
    if (input.isBot) {
      throw new Error("Bots are not allowed at crypto tables");
    }
    if (!input.walletAddress) {
      throw new Error("Wallet address is required for crypto tables");
    }
  }
  const now = nowIso(options?.now);
  const resolvedGuestId = input.isBot ? (input.guestId ?? createId()) : input.guestId;
  seat.player = {
    playerId: createId(),
    guestId: resolvedGuestId,
    displayName: input.displayName,
    isBot: input.isBot ?? false,
    stack: input.buyIn,
    totalBuyIn: input.buyIn,
    connected: !input.isBot,
    sitOut: false,
    seatIndex: input.seatIndex,
    joinedAt: now,
    lastSeenAt: now,
    walletAddress: input.walletAddress
  };
  next.updatedAt = now;
  if (options?.autoStart !== false) {
    maybeStartHand(next, options);
  }
  return next;
}

export function leaveTable(table: TableState, guestId: string, options?: EngineOptions): TableState {
  const next = clone(table);
  for (const seat of next.seats) {
    if (seat.player?.guestId === guestId) {
      if (next.currentHand) {
        const handPlayer = getHandPlayerBySeat(next.currentHand, seat.seatIndex);
        if (handPlayer && !handPlayer.folded) {
          handPlayer.folded = true;
          handPlayer.lastAction = "fold";
        }
      }
      seat.player = null;
    }
  }
  next.observers = next.observers.filter((observer) => observer.guestId !== guestId);
  next.updatedAt = nowIso(options?.now);
  if (next.currentHand) {
    maybeAdvanceStreet(next, options);
  } else {
    maybeStartHand(next, options);
  }
  return next;
}

export function rebuyPlayer(table: TableState, guestId: string, amount: number, options?: EngineOptions): TableState {
  const next = clone(table);
  const seat = next.seats.find((entry) => entry.player?.guestId === guestId);
  if (!seat?.player) {
    throw new Error("Player is not seated");
  }
  const total = seat.player.stack + amount;
  if (total > next.config.maxBuyIn) {
    throw new Error("Rebuy exceeds max buy-in");
  }
  seat.player.stack = total;
  seat.player.totalBuyIn += amount;
  seat.player.lastSeenAt = nowIso(options?.now);
  next.updatedAt = seat.player.lastSeenAt;
  if (options?.autoStart !== false) {
    maybeStartHand(next, options);
  }
  return next;
}

export function setConnectionState(table: TableState, guestId: string, connected: boolean, options?: EngineOptions): TableState {
  const next = clone(table);
  for (const seat of next.seats) {
    if (seat.player?.guestId === guestId) {
      seat.player.connected = connected;
      seat.player.lastSeenAt = nowIso(options?.now);
    }
  }
  next.updatedAt = nowIso(options?.now);
  return next;
}

export function maybeStartHand(table: TableState, options?: EngineOptions): TableState {
  if (table.currentHand) {
    return table;
  }

  const seatedPlayers = eligibleForNewHand(table);
  if (seatedPlayers.length < 2) {
    table.status = "waiting";
    return table;
  }

  const previousDealer = table.lastDealerSeatIndex ?? -1;
  const occupied = seatedPlayers.map((player) => player.seatIndex);
  const dealerSeatIndex = nextOccupiedSeat(occupied, previousDealer);
  const headsUp = occupied.length === 2;
  const smallBlindSeatIndex = headsUp ? dealerSeatIndex : nextOccupiedSeat(occupied, dealerSeatIndex);
  const bigBlindSeatIndex = headsUp ? nextOccupiedSeat(occupied, dealerSeatIndex) : nextOccupiedSeat(occupied, smallBlindSeatIndex);
  const deck = options?.deck ? clone(options.deck) : shuffleDeck(createDeck(), options?.random);

  const hand: HandState = {
    handId: createId(),
    phase: "preflop",
    dealerSeatIndex,
    smallBlindSeatIndex,
    bigBlindSeatIndex,
    actingSeatIndex: null,
    currentBet: 0,
    minRaiseBy: table.config.bigBlind,
    deck,
    community: [],
    pot: 0,
    players: seatedPlayers.map((player) => ({
      playerId: player.playerId,
      seatIndex: player.seatIndex,
      holeCards: [],
      committed: 0,
      totalCommitted: 0,
      folded: false,
      allIn: false,
      actedThisRound: false,
      lastAction: null,
      lastAmount: 0
    })),
    actionDeadlineAt: null,
    startedAt: nowIso(options?.now)
  };

  for (let round = 0; round < 2; round += 1) {
    for (const seatIndex of occupied) {
      const handPlayer = getHandPlayerBySeat(hand, seatIndex)!;
      const nextCard = hand.deck.shift();
      if (!nextCard) {
        throw new Error("Deck exhausted");
      }
      handPlayer.holeCards.push(nextCard);
    }
  }

  deductChips(table, hand, smallBlindSeatIndex, table.config.smallBlind);
  deductChips(table, hand, bigBlindSeatIndex, table.config.bigBlind);
  hand.currentBet = Math.max(getHandPlayerBySeat(hand, bigBlindSeatIndex)?.committed ?? 0, table.config.bigBlind);
  hand.pot = potTotal(hand);
  hand.actingSeatIndex = headsUp ? dealerSeatIndex : nextOccupiedSeat(occupied, bigBlindSeatIndex);
  hand.actionDeadlineAt = new Date(Date.parse(nowIso(options?.now)) + table.config.actionTimeMs).toISOString();
  table.currentHand = hand;
  table.lastDealerSeatIndex = dealerSeatIndex;
  table.status = "active";
  table.updatedAt = nowIso(options?.now);

  if (hand.players.every((player) => player.allIn || player.folded)) {
    maybeAdvanceStreet(table, options);
  }
  return table;
}

export function getLegalActions(table: TableState, guestId: string | null): LegalActions | null {
  const hand = table.currentHand;
  if (!hand || hand.actingSeatIndex === null) {
    return null;
  }
  const actingSeat = getSeat(table, hand.actingSeatIndex);
  if (!actingSeat.player || actingSeat.player.guestId !== guestId) {
    return null;
  }
  const handPlayer = getHandPlayerBySeat(hand, hand.actingSeatIndex);
  if (!handPlayer || handPlayer.folded || handPlayer.allIn) {
    return null;
  }

  const toCall = Math.max(0, hand.currentBet - handPlayer.committed);
  const max = actingSeat.player.stack + handPlayer.committed;
  const minRaiseTarget = hand.currentBet === 0 ? hand.minRaiseBy : hand.currentBet + hand.minRaiseBy;

  return {
    canFold: toCall > 0,
    canCheck: toCall === 0,
    callAmount: toCall > 0 ? Math.min(toCall, actingSeat.player.stack) : null,
    betRange: hand.currentBet === 0 && actingSeat.player.stack > 0 ? { min: Math.min(hand.minRaiseBy, max), max } : null,
    raiseRange: hand.currentBet > 0 && max > hand.currentBet ? { min: Math.min(minRaiseTarget, max), max } : null
  };
}

export function applyPlayerAction(
  table: TableState,
  input: { guestId: string; action: PlayerActionType; amount?: number },
  options?: EngineOptions
): { table: TableState; result: HandResult | null } {
  const next = clone(table);
  const hand = next.currentHand;
  if (!hand || hand.actingSeatIndex === null) {
    throw new Error("No active hand");
  }

  const seat = getSeat(next, hand.actingSeatIndex);
  if (!seat.player || seat.player.guestId !== input.guestId) {
    throw new Error("It is not this player's turn");
  }

  const actor = getHandPlayerBySeat(hand, seat.seatIndex);
  if (!actor || actor.folded || actor.allIn) {
    throw new Error("Player cannot act");
  }

  const toCall = Math.max(0, hand.currentBet - actor.committed);
  switch (input.action) {
    case "fold":
      if (toCall === 0) {
        throw new Error("Cannot fold when checking is available");
      }
      actor.folded = true;
      actor.lastAction = "fold";
      actor.lastAmount = 0;
      actor.actedThisRound = true;
      break;
    case "check":
      if (toCall !== 0) {
        throw new Error("Cannot check facing a bet");
      }
      actor.lastAction = "check";
      actor.lastAmount = 0;
      actor.actedThisRound = true;
      break;
    case "call": {
      if (toCall === 0) {
        throw new Error("Nothing to call");
      }
      const paid = deductChips(next, hand, seat.seatIndex, toCall);
      actor.lastAction = "call";
      actor.lastAmount = paid;
      actor.actedThisRound = true;
      break;
    }
    case "bet": {
      if (hand.currentBet !== 0) {
        throw new Error("Use raise when there is an existing bet");
      }
      if (!input.amount) {
        throw new Error("Bet amount is required");
      }
      if (input.amount < hand.minRaiseBy || input.amount > seat.player.stack + actor.committed) {
        throw new Error("Bet amount is outside valid range");
      }
      deductChips(next, hand, seat.seatIndex, input.amount - actor.committed);
      hand.currentBet = input.amount;
      hand.minRaiseBy = input.amount;
      actor.lastAction = "bet";
      actor.lastAmount = input.amount;
      actor.actedThisRound = true;
      for (const player of hand.players) {
        if (player.playerId !== actor.playerId && !player.folded && !player.allIn) {
          player.actedThisRound = false;
        }
      }
      break;
    }
    case "raise": {
      if (hand.currentBet === 0) {
        throw new Error("Use bet when no current bet exists");
      }
      if (!input.amount) {
        throw new Error("Raise amount is required");
      }
      if (input.amount <= hand.currentBet || input.amount > seat.player.stack + actor.committed) {
        throw new Error("Raise amount is outside valid range");
      }
      const raiseBy = input.amount - hand.currentBet;
      const isAllIn = input.amount === seat.player.stack + actor.committed;
      if (raiseBy < hand.minRaiseBy && !isAllIn) {
        throw new Error("Raise amount is too small");
      }
      deductChips(next, hand, seat.seatIndex, input.amount - actor.committed);
      hand.currentBet = input.amount;
      if (raiseBy >= hand.minRaiseBy) {
        hand.minRaiseBy = raiseBy;
      }
      actor.lastAction = "raise";
      actor.lastAmount = input.amount;
      actor.actedThisRound = true;
      for (const player of hand.players) {
        if (player.playerId !== actor.playerId && !player.folded && !player.allIn) {
          player.actedThisRound = false;
        }
      }
      break;
    }
    case "sitOut":
      seat.player.sitOut = true;
      actor.folded = true;
      actor.lastAction = "sitOut";
      actor.actedThisRound = true;
      break;
    default:
      throw new Error(`Unsupported action: ${String(input.action)}`);
  }

  hand.pot = potTotal(hand);
  hand.actingSeatIndex = nextActionSeat(hand);
  hand.actionDeadlineAt =
    hand.actingSeatIndex === null ? null : new Date(Date.parse(nowIso(options?.now)) + next.config.actionTimeMs).toISOString();
  next.updatedAt = nowIso(options?.now);

  const result = maybeAdvanceStreet(next, options);
  if (!result && next.currentHand && next.currentHand.actingSeatIndex === null) {
    next.currentHand.actingSeatIndex = nextActionSeat(next.currentHand);
  }
  if (!next.currentHand) {
    maybeStartHand(next, options);
  }
  return { table: next, result };
}

export function applyAutoAction(table: TableState, guestId: string, options?: EngineOptions): { table: TableState; result: HandResult | null } {
  const legal = getLegalActions(table, guestId);
  if (!legal) {
    throw new Error("No legal action available");
  }
  if (legal.canCheck) {
    return applyPlayerAction(table, { guestId, action: "check" }, options);
  }
  return applyPlayerAction(table, { guestId, action: "fold" }, options);
}

export function createTableSnapshot(table: TableState, viewerGuestId: string | null): TableSnapshot {
  const hand = table.currentHand;
  const seats: VisibleSeatState[] = table.seats.map((seat) => {
    const player = seat.player;
    const handPlayer = hand ? getHandPlayerBySeat(hand, seat.seatIndex) : null;
    const visibleHoleCards =
      player && handPlayer && (player.guestId === viewerGuestId || hand?.phase === "complete") ? clone(handPlayer.holeCards) : [];

    return {
      seatIndex: seat.seatIndex,
      player: player
        ? {
            playerId: player.playerId,
            guestId: player.guestId,
            displayName: player.displayName,
            isBot: player.isBot,
            stack: player.stack,
            totalBuyIn: player.totalBuyIn,
            connected: player.connected,
            sitOut: player.sitOut,
            seatIndex: player.seatIndex
          }
        : null,
      holeCards: visibleHoleCards,
      committed: handPlayer?.committed ?? 0,
      folded: handPlayer?.folded ?? false,
      allIn: handPlayer?.allIn ?? false,
      lastAction: handPlayer?.lastAction ?? null,
      legalActions: player?.guestId === viewerGuestId ? getLegalActions(table, viewerGuestId) : null
    };
  });

  return {
    tableId: table.tableId,
    tableCode: table.tableCode,
    status: table.status,
    config: clone(table.config),
    mode: table.mode,
    cryptoConfig: table.cryptoConfig ? clone(table.cryptoConfig) : undefined,
    viewerGuestId,
    seats,
    board: clone(hand?.community ?? []),
    pot: hand?.pot ?? 0,
    phase: hand?.phase ?? null,
    actingSeatIndex: hand?.actingSeatIndex ?? null,
    dealerSeatIndex: hand?.dealerSeatIndex ?? null,
    smallBlindSeatIndex: hand?.smallBlindSeatIndex ?? null,
    bigBlindSeatIndex: hand?.bigBlindSeatIndex ?? null,
    actionDeadlineAt: hand?.actionDeadlineAt ?? null,
    handHistory: clone(table.handHistory),
    createdAt: table.createdAt,
    updatedAt: table.updatedAt
  };
}

export function publicTableSummary(table: TableState) {
  return {
    tableId: table.tableId,
    tableCode: table.tableCode,
    visibility: table.config.visibility,
    mode: table.mode,
    smallBlind: table.config.smallBlind,
    bigBlind: table.config.bigBlind,
    minBuyIn: table.config.minBuyIn,
    maxBuyIn: table.config.maxBuyIn,
    playerCount: table.seats.filter((seat) => seat.player).length,
    openSeats: table.seats.filter((seat) => !seat.player).length
  };
}

export function buildHandOverview(table: TableState): string {
  const hand = table.currentHand;
  if (!hand) {
    return "No active hand.";
  }
  return `${hand.phase} | board ${cardsToString(hand.community)} | pot ${hand.pot}`;
}
