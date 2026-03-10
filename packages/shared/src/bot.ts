import { cardsToString } from "./cards.js";
import type { BotDecision, BotPersonality, TableState } from "./types.js";
import { getLegalActions } from "./engine.js";

export interface BotView {
  playerId: string;
  displayName: string;
  seatIndex: number;
  stack: number;
  holeCards: string[];
  legalActions: ReturnType<typeof getLegalActions>;
  board: string[];
  pot: number;
  phase: string | null;
  players: Array<{
    seatIndex: number;
    displayName: string;
    stack: number;
    committed: number;
    folded: boolean;
    allIn: boolean;
  }>;
  actionHistory: Array<{
    seatIndex: number;
    displayName: string;
    action: string | null;
    amount: number;
  }>;
}

export function buildBotView(table: TableState, botGuestId: string | null): BotView {
  const seat = table.seats.find((entry) => entry.player?.guestId === botGuestId || (botGuestId === null && entry.player?.isBot));
  if (!seat?.player || !table.currentHand) {
    throw new Error("Bot is not seated in an active hand");
  }
  const handPlayer = table.currentHand.players.find((entry) => entry.playerId === seat.player?.playerId);
  if (!handPlayer) {
    throw new Error("Bot is not part of the current hand");
  }

  const resolvedGuestId = seat.player.guestId;
  return {
    playerId: seat.player.playerId,
    displayName: seat.player.displayName,
    seatIndex: seat.seatIndex,
    stack: seat.player.stack,
    holeCards: handPlayer.holeCards.map((card) => `${card.rank}${card.suit}`),
    legalActions: getLegalActions(table, resolvedGuestId),
    board: table.currentHand.community.map((card) => `${card.rank}${card.suit}`),
    pot: table.currentHand.pot,
    phase: table.currentHand.phase,
    players: table.seats
      .filter((entry) => entry.player)
      .map((entry) => {
        const state = table.currentHand?.players.find((player) => player.playerId === entry.player?.playerId);
        return {
          seatIndex: entry.seatIndex,
          displayName: entry.player!.displayName,
          stack: entry.player!.stack,
          committed: state?.committed ?? 0,
          folded: state?.folded ?? false,
          allIn: state?.allIn ?? false
        };
      }),
    actionHistory: table.currentHand.players.map((player) => {
      const entry = table.seats.find((seatEntry) => seatEntry.player?.playerId === player.playerId);
      return {
        seatIndex: player.seatIndex,
        displayName: entry?.player?.displayName ?? "Unknown",
        action: player.lastAction,
        amount: player.lastAmount
      };
    })
  };
}

const PERSONALITY_PROMPTS: Record<BotPersonality, string> = {
  aggressive: "You are an aggressive, fearless No Limit Hold'em bot. You love to bet and raise. You apply maximum pressure with big bets, frequent bluffs, and 3-bets. You rarely just call — you either raise or fold. You punish limpers.",
  tight: "You are a tight, disciplined No Limit Hold'em bot. You only play premium and strong hands. You fold marginal hands without hesitation. When you do play, you bet for value. You rarely bluff.",
  loose: "You are a loose, fun-loving No Limit Hold'em bot. You play lots of hands and like to see flops. You call with speculative hands, suited connectors, and any ace. You enjoy gambling and chasing draws.",
  tricky: "You are a tricky, deceptive No Limit Hold'em bot. You mix up your play — sometimes slow-playing monsters, sometimes bluffing with nothing. You check-raise often and make unexpected bet sizes to confuse opponents.",
  passive: "You are a passive, cautious No Limit Hold'em bot. You prefer to check and call rather than bet and raise. You avoid big pots without strong hands. You are risk-averse and wait for the nuts."
};

export function buildBotPrompt(view: BotView, personality?: BotPersonality): string {
  const persona = personality ? PERSONALITY_PROMPTS[personality] : "You are a cheap, competent No Limit Hold'em bot.";
  return [
    persona,
    "Respond with JSON only in the shape {\"action\":\"fold|check|call|bet|raise\",\"amount\":number?}.",
    "Never mention hidden cards, and do not explain your reasoning.",
    `Your seat: ${view.seatIndex}. Stack: ${view.stack}.`,
    `Hole cards: ${view.holeCards.join(" ")}.`,
    `Board: ${view.board.join(" ") || "none"}. Pot: ${view.pot}. Phase: ${view.phase}.`,
    `Legal actions: ${JSON.stringify(view.legalActions)}.`,
    `Table state: ${view.players
      .map((player) => `${player.displayName} seat ${player.seatIndex} stack ${player.stack} committed ${player.committed}`)
      .join("; ")}.`,
    `Recent actions: ${view.actionHistory.map((action) => `${action.displayName}:${action.action ?? "none"}:${action.amount}`).join("; ")}.`
  ].join(" ");
}

export function parseBotDecision(raw: string): BotDecision | null {
  try {
    const parsed = JSON.parse(raw) as BotDecision;
    if (!parsed || !["fold", "check", "call", "bet", "raise"].includes(parsed.action)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function fallbackBotDecision(table: TableState, botGuestId: string | null, personality?: BotPersonality): BotDecision {
  const view = buildBotView(table, botGuestId);
  const legal = view.legalActions;
  if (!legal) {
    return { action: "check" };
  }

  const p = personality ?? "tight";

  if (p === "aggressive") {
    // Aggressive: raise often, rarely just call
    if (legal.raiseRange) {
      const size = Math.min(legal.raiseRange.max, Math.max(legal.raiseRange.min, Math.floor(view.pot * 0.75)));
      return { action: "raise", amount: size };
    }
    if (legal.betRange) {
      const size = Math.min(legal.betRange.max, Math.max(legal.betRange.min, Math.floor(view.pot * 0.66)));
      return { action: "bet", amount: size };
    }
    if (legal.callAmount) return { action: "call" };
    return { action: "check" };
  }

  if (p === "loose") {
    // Loose: call most bets, bet with anything
    if (legal.canCheck && legal.betRange) {
      return { action: "bet", amount: legal.betRange.min };
    }
    if (legal.callAmount) return { action: "call" };
    return { action: "check" };
  }

  if (p === "tricky") {
    // Tricky: mix it up randomly
    const roll = Math.random();
    if (legal.raiseRange && roll > 0.6) {
      return { action: "raise", amount: legal.raiseRange.min };
    }
    if (legal.canCheck && legal.betRange && roll > 0.4) {
      return { action: "bet", amount: legal.betRange.min };
    }
    if (legal.callAmount && roll > 0.3) return { action: "call" };
    if (legal.canCheck) return { action: "check" };
    return { action: "fold" };
  }

  if (p === "passive") {
    // Passive: check/call, rarely bet
    if (legal.canCheck) return { action: "check" };
    if (legal.callAmount && legal.callAmount <= Math.max(8, Math.floor(view.pot * 0.5))) {
      return { action: "call" };
    }
    return { action: "fold" };
  }

  // Default (tight): original logic
  if (legal.canCheck) {
    if (legal.betRange && view.holeCards.some((card) => card[0] === "A" || card[0] === "K")) {
      return { action: "bet", amount: legal.betRange.min };
    }
    return { action: "check" };
  }
  if ((legal.callAmount ?? Number.MAX_SAFE_INTEGER) <= Math.max(4, Math.floor(view.pot * 0.25))) {
    return { action: "call" };
  }
  return { action: "fold" };
}
