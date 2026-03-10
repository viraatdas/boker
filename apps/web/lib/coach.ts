import type { Card, LegalActions, TableSnapshot, VisibleSeatState } from "@boker/shared";

/**
 * Client-side poker coach that generates advice based on the visible game state.
 * No server calls — all logic runs in the browser.
 */

// ── Hand strength helpers ──

const RANK_ORDER = "23456789TJQKA";

function rankVal(r: string): number {
  return RANK_ORDER.indexOf(r);
}

function isPair(cards: Card[]): boolean {
  return cards.length === 2 && cards[0].rank === cards[1].rank;
}

function isSuited(cards: Card[]): boolean {
  return cards.length === 2 && cards[0].suit === cards[1].suit;
}

function highCard(cards: Card[]): number {
  return Math.max(...cards.map((c) => rankVal(c.rank)));
}

function holeStrength(cards: Card[]): "premium" | "strong" | "playable" | "weak" {
  if (cards.length !== 2) return "weak";
  const [a, b] = [rankVal(cards[0].rank), rankVal(cards[1].rank)].sort((x, y) => y - x);

  // Premium: AA, KK, QQ, AKs, AKo
  if (isPair(cards) && a >= rankVal("Q")) return "premium";
  if (a === rankVal("A") && b === rankVal("K")) return "premium";

  // Strong: JJ, TT, AQs, AJs, KQs, AQo
  if (isPair(cards) && a >= rankVal("T")) return "strong";
  if (a === rankVal("A") && b >= rankVal("J") && isSuited(cards)) return "strong";
  if (a === rankVal("A") && b === rankVal("Q")) return "strong";
  if (a === rankVal("K") && b === rankVal("Q") && isSuited(cards)) return "strong";

  // Playable: mid pairs, suited connectors, suited aces
  if (isPair(cards)) return "playable";
  if (a === rankVal("A") && isSuited(cards)) return "playable";
  if (isSuited(cards) && a - b <= 2 && b >= rankVal("6")) return "playable";
  if (a >= rankVal("T") && b >= rankVal("9")) return "playable";

  return "weak";
}

// ── Board texture helpers ──

function countFlushDraws(hole: Card[], board: Card[]): number {
  const suits: Record<string, number> = {};
  for (const c of [...hole, ...board]) suits[c.suit] = (suits[c.suit] ?? 0) + 1;
  return Math.max(...Object.values(suits));
}

function hasStraightDraw(hole: Card[], board: Card[]): boolean {
  const vals = new Set([...hole, ...board].map((c) => rankVal(c.rank)));
  // Check all windows of 5
  for (let low = 0; low <= 9; low++) {
    let count = 0;
    for (let v = low; v < low + 5; v++) if (vals.has(v)) count++;
    if (count >= 4) return true;
  }
  return false;
}

function boardIsPaired(board: Card[]): boolean {
  const ranks = board.map((c) => c.rank);
  return new Set(ranks).size < ranks.length;
}

// ── Pot odds & position ──

function potOdds(callAmount: number, pot: number): number {
  if (pot + callAmount === 0) return 0;
  return callAmount / (pot + callAmount);
}

function playerPosition(
  seatIndex: number,
  dealerSeat: number | null,
  totalSeats: number
): "early" | "middle" | "late" | "blinds" {
  if (dealerSeat === null) return "middle";
  const diff = (seatIndex - dealerSeat + totalSeats) % totalSeats;
  if (diff <= 1) return "blinds";
  if (diff <= 2) return "early";
  if (diff <= 4) return "middle";
  return "late";
}

// ── Post-action review ──

function reviewLastAction(
  snapshot: TableSnapshot,
  viewerSeat: VisibleSeatState
): string | null {
  const action = viewerSeat.lastAction;
  if (!action || !viewerSeat.holeCards.length) return null;

  const strength = holeStrength(viewerSeat.holeCards);
  const pot = snapshot.pot;

  // Check for obvious mistakes
  if (action === "fold" && strength === "premium") {
    return "Folding premium hands like this is almost always a mistake. These are the hands you want to play aggressively!";
  }

  if (action === "call" && strength === "premium" && snapshot.phase === "preflop") {
    return "With a premium hand preflop, consider raising instead of just calling. You want to build the pot and thin the field.";
  }

  if (action === "check" && strength === "premium" && snapshot.phase === "preflop") {
    return "Don't slow-play premiums preflop too often. A raise here builds the pot with your best hands.";
  }

  return null;
}

// ── Main advice generator ──

export interface CoachAdvice {
  message: string;
  type: "tip" | "warning" | "info";
}

export function generateAdvice(
  snapshot: TableSnapshot,
  viewerSeat: VisibleSeatState,
  legalActions: LegalActions | null
): CoachAdvice | null {
  const hole = viewerSeat.holeCards;
  if (!hole.length) return null;

  const phase = snapshot.phase;
  const board = snapshot.board;
  const pot = snapshot.pot;
  const position = playerPosition(
    viewerSeat.seatIndex,
    snapshot.dealerSeatIndex,
    snapshot.seats.length
  );

  // ── Post-action review (when it's NOT our turn) ──
  if (!legalActions) {
    const review = reviewLastAction(snapshot, viewerSeat);
    if (review) return { message: review, type: "warning" };
    return null;
  }

  // ── It's our turn — give advice ──

  const strength = holeStrength(hole);

  // PREFLOP advice
  if (phase === "preflop") {
    const callAmt = legalActions.callAmount ?? 0;
    const bigBlind = snapshot.config.bigBlind;

    if (strength === "premium") {
      if (legalActions.raiseRange) {
        const suggestSize = Math.min(
          legalActions.raiseRange.max,
          Math.max(legalActions.raiseRange.min, bigBlind * 3)
        );
        return { message: `Strong hand! Raise to about ${suggestSize} to build the pot and protect your hand.`, type: "tip" };
      }
      if (legalActions.betRange) {
        return { message: `You have a premium hand. Bet to build the pot!`, type: "tip" };
      }
      return { message: `Premium hand — don't let it go cheap. Call at minimum.`, type: "tip" };
    }

    if (strength === "strong") {
      if (callAmt > bigBlind * 6) {
        return { message: `Decent hand, but the raise is large (${callAmt}). Consider if you want to risk this much.`, type: "info" };
      }
      return { message: `Good hand. A standard raise to 2.5-3x the big blind is solid here.`, type: "tip" };
    }

    if (strength === "playable") {
      if (callAmt > bigBlind * 3) {
        return { message: `This hand plays well but the price is steep. Consider folding against big raises.`, type: "info" };
      }
      if (position === "late" || position === "blinds") {
        return { message: `Playable hand in ${position} position. Good spot to see a flop.`, type: "tip" };
      }
      return { message: `Marginal hand. In early position, consider folding. In late position, you can call or raise.`, type: "info" };
    }

    // Weak hand
    if (callAmt === 0 && legalActions.canCheck) {
      return { message: `Weak hand, but you can check for free. Take a look at the flop.`, type: "info" };
    }
    return { message: `Weak hand. Folding is usually the right play here unless you're getting great pot odds.`, type: "warning" };
  }

  // POSTFLOP advice (flop, turn, river)
  if (phase === "flop" || phase === "turn" || phase === "river") {
    const flushCount = countFlushDraws(hole, board);
    const hasFlushDraw = flushCount === 4;
    const hasFlush = flushCount >= 5;
    const straightDraw = hasStraightDraw(hole, board);
    const paired = boardIsPaired(board);
    const callAmt = legalActions.callAmount ?? 0;
    const odds = potOdds(callAmt, pot);

    // Made flush
    if (hasFlush) {
      return { message: `You likely have a flush! Bet for value — but watch out if the board pairs.`, type: "tip" };
    }

    // Flush draw
    if (hasFlushDraw) {
      if (phase === "river") {
        return { message: `Your flush draw missed. Unless you can bluff, folding to a bet is reasonable.`, type: "warning" };
      }
      if (callAmt > 0 && odds > 0.35) {
        return { message: `Flush draw but the price is too high (${Math.round(odds * 100)}% of pot). You need about 19% odds to call.`, type: "warning" };
      }
      return { message: `You have a flush draw (~19% to hit). ${callAmt === 0 ? "Semi-bluff with a bet!" : "The pot odds look decent to call."}`, type: "tip" };
    }

    // Straight draw
    if (straightDraw && !hasFlush) {
      if (phase === "river") {
        return { message: `Straight draw missed on the river. Be cautious about calling big bets.`, type: "warning" };
      }
      return { message: `You have a straight draw (~17% to hit). ${callAmt === 0 ? "Consider a semi-bluff." : "Check the pot odds before calling."}`, type: "info" };
    }

    // High card only on dangerous board
    if (highCard(hole) >= rankVal("A") && !paired) {
      if (callAmt === 0) {
        return { message: `You have an ace but may not have connected with the board. A small bet can take it down.`, type: "info" };
      }
    }

    // Generic postflop with a bet to call
    if (callAmt > 0) {
      if (odds > 0.4) {
        return { message: `Large bet to call (${Math.round(odds * 100)}% of pot). You need a strong hand or draw here.`, type: "warning" };
      }
      if (odds < 0.2) {
        return { message: `Small bet relative to the pot. With any piece of the board, calling is reasonable.`, type: "info" };
      }
    }

    // Can check
    if (legalActions.canCheck) {
      return { message: `No bet to face — you can check to see the next card for free, or bet to build the pot.`, type: "info" };
    }
  }

  return null;
}
