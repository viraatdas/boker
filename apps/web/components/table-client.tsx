"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Card, LegalActions, TableSnapshot } from "@boker/shared";
import { formatSol } from "@boker/shared";
import { createGuest, fetchSnapshot, getWsBaseUrl, guestStorage, joinTable, leaveTable, rebuy, seatAtTable, submitDeposit, requestWithdrawal } from "../lib/api";
import { playCardDeal, playCardFlip, playCheck, playChipBet, playClick, playFold, playAllIn, playWin, playNewHand, playYourTurn } from "../lib/sounds";
import { generateAdvice, type CoachAdvice } from "../lib/coach";
import { useWallet } from "../lib/wallet";
import { WalletButton } from "./wallet-button";
import { fetchSolPrice, lamportsToUsd } from "../lib/sol-price";

interface TableClientProps {
  tableId: string;
}

interface FeedEvent {
  kind: string;
  detail: string;
}

interface HandResultMessage {
  handId: string;
  winners: Array<{ displayName: string; amount: number; handLabel: string }>;
  totalPot: number;
}

const SUIT_SYMBOL: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

function PlayingCard({ card, size }: { card: Card | null; size: "board-size" | "hole-size" }) {
  if (!card) {
    return <div className={`playing-card ${size} face-down`} />;
  }
  return (
    <div className={`playing-card ${size} face-up suit-${card.suit}`}>
      <span className="card-rank">{card.rank}</span>
      <span className="card-suit">{SUIT_SYMBOL[card.suit]}</span>
    </div>
  );
}

function GhostCard({ size }: { size: "board-size" | "hole-size" }) {
  return <div className={`playing-card ${size} ghost`} />;
}

function ChipStack({ amount, className }: { amount: number; className?: string }) {
  if (amount <= 0) return null;
  const chipCount = Math.min(4, Math.max(1, Math.ceil(amount / 50)));
  return (
    <div className={`chip-stack ${className ?? ""}`}>
      <div className="chip-pile">
        {Array.from({ length: chipCount }, (_, i) => (
          <span key={i} className={`chip chip-color-${i % 4}`} style={{ marginTop: i > 0 ? -8 : 0 }} />
        ))}
      </div>
      <span className="chip-label">{amount}</span>
    </div>
  );
}

export function TableClient({ tableId }: TableClientProps) {
  const wallet = useWallet();
  const [snapshot, setSnapshot] = useState<TableSnapshot | null>(null);
  const [guestId, setGuestId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [buyIn, setBuyIn] = useState(200);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [handBanner, setHandBanner] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState<number>(0);
  const [betAmount, setBetAmount] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [hasLeft, setHasLeft] = useState(false);
  const [coachEnabled, setCoachEnabled] = useState(false);
  const [coachAdvice, setCoachAdvice] = useState<CoachAdvice | null>(null);
  const [coachModeGuests, setCoachModeGuests] = useState<Set<string>>(new Set());
  const [botPersonalities, setBotPersonalities] = useState<Record<string, string>>({});
  const [depositPending, setDepositPending] = useState(false);
  const [withdrawPending, setWithdrawPending] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState<"SOL" | "USD">("SOL");
  const [solPrice, setSolPrice] = useState<number>(0);
  const socketRef = useRef<WebSocket | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const prevPhaseRef = useRef<string | null>(null);
  const prevBoardLenRef = useRef<number>(0);
  const prevActingSeatRef = useRef<number | null>(null);
  const router = useRouter();

  useEffect(() => {
    const localGuest = guestStorage.read();
    if (localGuest) {
      setGuestId(localGuest.guestId);
      setDisplayName(localGuest.displayName);
    }
  }, []);

  // Fetch SOL/USD price for crypto tables
  useEffect(() => {
    if (!snapshot || snapshot.mode !== "crypto") return;
    void fetchSolPrice().then(setSolPrice);
    const interval = setInterval(() => {
      void fetchSolPrice().then(setSolPrice);
    }, 60_000);
    return () => clearInterval(interval);
  }, [snapshot?.mode]);

  useEffect(() => {
    if (!guestId || !displayName) return;
    let mounted = true;
    async function load() {
      try {
        const session = await createGuest(displayName, guestId ?? undefined);
        if (!mounted) return;
        guestStorage.write({ guestId: session.guestId, displayName: session.displayName });
        const joined = await joinTable(tableId, { guestId: session.guestId, displayName: session.displayName });
        const initial = joined ?? (await fetchSnapshot(tableId, session.guestId));
        if (!mounted) return;
        setGuestId(session.guestId);
        setDisplayName(session.displayName);
        setSnapshot(initial);
        setBuyIn(initial.config.minBuyIn);
      } catch (loadError) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : "Could not load table");
      }
    }
    void load();
    return () => { mounted = false; };
  }, [displayName, guestId, tableId]);

  useEffect(() => {
    if (!guestId) return;
    const socket = new WebSocket(`${getWsBaseUrl()}/v1/tables/${tableId}/ws?guestId=${encodeURIComponent(guestId)}`);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "table.subscribe", guestId }));
    });

    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as
          | { type: "table.snapshot"; snapshot: TableSnapshot; coachModeGuestIds?: string[]; botPersonalities?: Record<string, string> }
          | { type: "table.event"; event: FeedEvent }
          | { type: "table.timer"; remainingMs: number }
          | { type: "table.handResult"; result: HandResultMessage }
          | { type: "table.coachMode"; guestId: string; enabled: boolean }
          | { type: "table.error"; message: string };

        switch (payload.type) {
          case "table.snapshot":
            setSnapshot(payload.snapshot);
            if (payload.coachModeGuestIds) setCoachModeGuests(new Set(payload.coachModeGuestIds));
            if (payload.botPersonalities) setBotPersonalities(payload.botPersonalities);
            break;
          case "table.coachMode":
            setCoachModeGuests((prev) => {
              const next = new Set(prev);
              if (payload.enabled) next.add(payload.guestId);
              else next.delete(payload.guestId);
              return next;
            });
            break;
          case "table.event":
            setFeed((current) => [payload.event, ...current].slice(0, 30));
            break;
          case "table.timer":
            setRemainingMs(payload.remainingMs);
            break;
          case "table.handResult":
            playWin();
            setHandBanner(
              payload.result.winners.map((w) => `${w.displayName} wins ${w.amount} (${w.handLabel})`).join(" · ")
            );
            window.setTimeout(() => setHandBanner(null), 5000);
            break;
          case "table.error":
            setError(payload.message);
            break;
        }
      } catch {
        setError("Received an invalid realtime message.");
      }
    });

    socket.addEventListener("close", () => { socketRef.current = null; });
    return () => { socket.close(); };
  }, [guestId, tableId]);

  const viewerSeat = useMemo(
    () => snapshot?.seats.find((s) => s.player?.guestId === guestId) ?? null,
    [guestId, snapshot]
  );
  const legalActions = viewerSeat?.legalActions ?? null;

  // Only reset bet amount when it first becomes viewer's turn
  const isMyTurn = Boolean(viewerSeat && snapshot?.actingSeatIndex === viewerSeat.seatIndex);
  const prevIsMyTurnRef = useRef(false);
  useEffect(() => {
    const range = legalActions?.betRange ?? legalActions?.raiseRange;
    if (isMyTurn && !prevIsMyTurnRef.current && range) {
      setBetAmount(range.min);
    }
    prevIsMyTurnRef.current = isMyTurn;
  }, [isMyTurn, legalActions?.betRange?.min, legalActions?.raiseRange?.min]);

  // Sound effects based on game state changes
  useEffect(() => {
    if (!snapshot) return;
    const prevPhase = prevPhaseRef.current;
    const prevBoardLen = prevBoardLenRef.current;
    const prevActing = prevActingSeatRef.current;

    // New hand started
    if (snapshot.phase === "preflop" && prevPhase !== "preflop") {
      playNewHand();
      // Stagger card deal sounds for hole cards
      setTimeout(() => playCardDeal(), 200);
      setTimeout(() => playCardDeal(), 400);
    }

    // Community cards revealed
    if (snapshot.board.length > prevBoardLen && prevBoardLen >= 0) {
      const newCards = snapshot.board.length - prevBoardLen;
      for (let i = 0; i < newCards; i++) {
        setTimeout(() => playCardFlip(), i * 120);
      }
    }

    // It's now the viewer's turn
    if (
      snapshot.actingSeatIndex !== null &&
      snapshot.actingSeatIndex !== prevActing &&
      viewerSeat &&
      snapshot.actingSeatIndex === viewerSeat.seatIndex
    ) {
      playYourTurn();
    }

    prevPhaseRef.current = snapshot.phase;
    prevBoardLenRef.current = snapshot.board.length;
    prevActingSeatRef.current = snapshot.actingSeatIndex;
  }, [snapshot?.phase, snapshot?.board.length, snapshot?.actingSeatIndex, viewerSeat]);

  // Coach advice generation
  useEffect(() => {
    if (!coachEnabled || !snapshot || !viewerSeat) {
      setCoachAdvice(null);
      return;
    }
    const advice = generateAdvice(snapshot, viewerSeat, legalActions);
    setCoachAdvice(advice);
  }, [coachEnabled, snapshot?.phase, snapshot?.actingSeatIndex, snapshot?.board.length, viewerSeat, legalActions, snapshot]);

  const actionTimeMs = snapshot?.config.actionTimeMs ?? 25000;
  const timerPct = actionTimeMs > 0 ? Math.max(0, Math.min(100, (remainingMs / actionTimeMs) * 100)) : 0;

  async function ensureNamedGuest() {
    const session = await createGuest(displayName, guestId ?? undefined);
    guestStorage.write({ guestId: session.guestId, displayName: session.displayName });
    setGuestId(session.guestId);
    setDisplayName(session.displayName);
    return session;
  }

  const isCrypto = snapshot?.mode === "crypto";

  function formatAmount(amount: number): string {
    if (!isCrypto) return String(amount);
    if (displayCurrency === "USD" && solPrice > 0) return lamportsToUsd(amount, solPrice);
    return formatSol(amount);
  }

  async function handleDeposit() {
    if (!guestId || !wallet.connected || !wallet.address || !snapshot?.cryptoConfig) return;
    setDepositPending(true);
    setError(null);
    try {
      const escrowAddress = snapshot.cryptoConfig.escrowAddress;
      const amount = snapshot.cryptoConfig.buyInLamports;
      const txSig = await wallet.sendSol(escrowAddress, amount);
      // Wait a bit for confirmation, then verify
      await new Promise((r) => setTimeout(r, 2000));
      const result = await submitDeposit(tableId, {
        guestId,
        txSignature: txSig,
        expectedAmountLamports: amount,
        fromAddress: wallet.address ?? undefined,
      });
      if (!result.verified) {
        setError("Deposit could not be verified. Please try again.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deposit failed");
    } finally {
      setDepositPending(false);
    }
  }

  async function handleWithdraw() {
    if (!guestId || !wallet.address || !viewerSeat?.player) return;
    setWithdrawPending(true);
    setError(null);
    try {
      await requestWithdrawal(tableId, {
        guestId,
        amountLamports: viewerSeat.player.stack,
        toAddress: wallet.address,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Withdrawal failed");
    } finally {
      setWithdrawPending(false);
    }
  }

  async function takeSeat(seatIndex: number) {
    try {
      const session = await ensureNamedGuest();

      // For crypto tables: require wallet, deposit first, then seat
      if (isCrypto) {
        if (!wallet.connected || !wallet.address) {
          setError("Connect your wallet first to sit at a crypto table.");
          return;
        }
        if (!snapshot?.cryptoConfig) {
          setError("Crypto config not available.");
          return;
        }
        // Send deposit to escrow
        setDepositPending(true);
        const escrowAddress = snapshot.cryptoConfig.escrowAddress;
        const amount = snapshot.cryptoConfig.buyInLamports;
        const txSig = await wallet.sendSol(escrowAddress, amount);
        await new Promise((r) => setTimeout(r, 2000));
        const depositResult = await submitDeposit(tableId, {
          guestId: session.guestId,
          txSignature: txSig,
          expectedAmountLamports: amount,
          fromAddress: wallet.address ?? undefined,
        });
        setDepositPending(false);
        if (!depositResult.verified) {
          setError("Deposit verification failed. Cannot sit down.");
          return;
        }
        const next = await seatAtTable(tableId, {
          guestId: session.guestId,
          displayName: session.displayName,
          seatIndex,
          buyIn: depositResult.chipsCredited,
          walletAddress: wallet.address,
        });
        setSnapshot(next);
        setSelectedSeat(null);
        setError(null);
        return;
      }

      const next = await seatAtTable(tableId, {
        guestId: session.guestId,
        displayName: session.displayName,
        seatIndex,
        buyIn,
      });
      setSnapshot(next);
      setSelectedSeat(null);
      setError(null);
    } catch (e) {
      setDepositPending(false);
      setError(e instanceof Error ? e.message : "Could not sit down");
    }
  }

  function sendAction(action: "fold" | "check" | "call" | "bet" | "raise", amount?: number) {
    if (!guestId || !socketRef.current) return;
    switch (action) {
      case "fold": playFold(); break;
      case "check": playCheck(); break;
      case "call": playChipBet(); break;
      case "bet": playChipBet(); break;
      case "raise": playChipBet(); break;
    }
    socketRef.current.send(JSON.stringify({ type: "table.action", guestId, action, amount }));
  }

  async function handleRebuy() {
    if (!guestId) return;
    try {
      const next = await rebuy(tableId, { guestId, amount: buyIn });
      setSnapshot(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rebuy");
    }
  }

  async function handleLeave() {
    if (!guestId) return;
    try {
      await leaveTable(tableId, guestId);
      socketRef.current?.close();
      socketRef.current = null;
      setHasLeft(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not leave");
    }
  }

  // Username gate
  if (!guestId) {
    return (
      <main className="table-page">
        <section className="username-gate">
          <div className="hero-suits"><span>♠</span><span>♥</span><span>♦</span><span>♣</span></div>
          <p className="eyebrow">Join table</p>
          <h1>Pick a name to enter</h1>
          <input
            className="text-input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            onKeyDown={(e) => { if (e.key === "Enter") void ensureNamedGuest(); }}
          />
          <button className="primary-button" onClick={() => void ensureNamedGuest()}>Continue</button>
          {error ? <p className="error-inline">{error}</p> : null}
        </section>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="table-page">
        <div className="loading-state">Loading table...</div>
      </main>
    );
  }

  const activeRange = legalActions?.betRange ?? legalActions?.raiseRange;
  const isRaise = Boolean(legalActions?.raiseRange);

  return (
    <main className="table-page">
      {/* Header */}
      <section className="table-header">
        <div>
          <p className="eyebrow">Table {snapshot.tableCode}</p>
          <h1>
            {isCrypto
              ? `${formatSol(snapshot.config.smallBlind)}/${formatSol(snapshot.config.bigBlind)} NLHE`
              : `${snapshot.config.smallBlind}/${snapshot.config.bigBlind} NLHE`
            }
          </h1>
        </div>
        <div className="header-actions">
          {isCrypto && (
            <button
              className={`currency-toggle ${displayCurrency === "USD" ? "showing-usd" : ""}`}
              onClick={() => setDisplayCurrency((c) => c === "SOL" ? "USD" : "SOL")}
              title={`Showing ${displayCurrency}. Click to switch.`}
            >
              <span className={displayCurrency === "SOL" ? "currency-active" : "currency-inactive"}>SOL</span>
              <span className="currency-divider">/</span>
              <span className={displayCurrency === "USD" ? "currency-active" : "currency-inactive"}>USD</span>
            </button>
          )}
          {isCrypto && <WalletButton />}
          <span className="pill">{snapshot.config.visibility}</span>
          <button
            type="button"
            className={`coach-toggle ${coachEnabled ? "active" : ""}`}
            onClick={() => {
              const next = !coachEnabled;
              setCoachEnabled(next);
              if (guestId && socketRef.current) {
                socketRef.current.send(JSON.stringify({ type: "table.coachMode", guestId, enabled: next }));
              }
            }}
            title="Toggle poker coach"
          >
            <span className="coach-toggle-icon">💡</span>
            <span>Coach</span>
          </button>
          <button className="secondary-button" onClick={() => navigator.clipboard.writeText(window.location.href)}>
            Copy link
          </button>
          {hasLeft ? (
            <button className="primary-button" onClick={() => router.push("/")}>Home</button>
          ) : (
            <button className="secondary-button" onClick={() => void handleLeave()}>Leave</button>
          )}
        </div>
      </section>

      {handBanner ? <div className="result-banner">{handBanner}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      <section className="table-layout">
        {/* ── Felt + actions column ── */}
        <div className="felt-col">
          <div className="felt-shell">
            {/* Committed chips — positioned between seats and center */}
            {snapshot.seats.map((seat, index) =>
              seat.committed > 0 ? (
                <div key={`chips-${index}`} className={`committed-chips chips-pos-${index}`}>
                  <ChipStack amount={seat.committed} />
                </div>
              ) : null
            )}

            <div className="board-center">
              <div className="pot-pill">
                {snapshot.pot > 0 && (
                  <span className="pot-chips">
                    <span className="chip chip-color-0" />
                    <span className="chip chip-color-1" style={{ marginLeft: -6 }} />
                    <span className="chip chip-color-2" style={{ marginLeft: -6 }} />
                  </span>
                )}
                <span>Pot {formatAmount(snapshot.pot)}</span>
              </div>
              <div className="board-row">
                {snapshot.board.length === 0
                  ? Array.from({ length: 5 }, (_, i) => <GhostCard size="board-size" key={i} />)
                  : snapshot.board.map((card) => (
                      <PlayingCard card={card} size="board-size" key={`${card.rank}${card.suit}`} />
                    ))
                }
                {snapshot.board.length > 0 && snapshot.board.length < 5
                  ? Array.from({ length: 5 - snapshot.board.length }, (_, i) => <GhostCard size="board-size" key={`g${i}`} />)
                  : null
                }
              </div>
              <div className="table-meta">
                <span>{snapshot.phase ?? "waiting"}</span>
                {snapshot.actingSeatIndex !== null && (
                  <span>Seat {snapshot.actingSeatIndex + 1} to act</span>
                )}
              </div>
            </div>

            {snapshot.seats.map((seat, index) => {
              const occupied = Boolean(seat.player);
              const canTakeSeat = !occupied && !viewerSeat;
              const isActing = snapshot.actingSeatIndex === index;
              const isDealer = snapshot.dealerSeatIndex === index;
              const isSB = snapshot.smallBlindSeatIndex === index;
              const isBB = snapshot.bigBlindSeatIndex === index;
              const isFolded = seat.folded;
              const hasCoach = seat.player?.guestId ? coachModeGuests.has(seat.player.guestId) : false;
              const botPersonality = seat.player?.guestId ? botPersonalities[seat.player.guestId] : null;
              return (
                <button
                  type="button"
                  key={seat.seatIndex}
                  className={`seat seat-${index} ${occupied ? "occupied" : "open"} ${isActing ? "acting" : ""} ${isFolded ? "folded" : ""}`}
                  onClick={() => {
                    if (canTakeSeat) {
                      if (isCrypto && !wallet.connected) {
                        setError("Connect your wallet to sit at a crypto table.");
                        return;
                      }
                      playClick();
                      setSelectedSeat(seat.seatIndex);
                      void takeSeat(seat.seatIndex);
                    }
                  }}
                >
                  {isDealer && <span className="dealer-chip">D</span>}
                  {isSB && !isDealer && <span className="blind-chip sb-chip">SB</span>}
                  {isBB && <span className="blind-chip bb-chip">BB</span>}
                  {occupied ? (
                    <>
                      <span className="seat-name">{seat.player?.displayName}</span>
                      <span className="seat-stack">{formatAmount(seat.player?.stack ?? 0)}</span>
                      <span className="seat-meta">
                        {seat.folded ? "fold" : seat.allIn ? "ALL IN" : seat.lastAction ?? ""}
                        {seat.player?.isBot && botPersonality ? (
                          <span className={`bot-badge personality-${botPersonality}`}>{botPersonality}</span>
                        ) : seat.player?.isBot ? (
                          <span className="bot-badge">AI</span>
                        ) : null}
                        {hasCoach && <span className="coach-badge">💡</span>}
                      </span>
                      {/* committed shown as positioned chips outside seat */}
                      <div className="hole-row">
                        {seat.holeCards.length > 0
                          ? seat.holeCards.map((card) => (
                              <PlayingCard card={card} size="hole-size" key={`${card.rank}${card.suit}`} />
                            ))
                          : snapshot.phase && snapshot.phase !== "complete"
                            ? [0, 1].map((i) => <PlayingCard card={null} size="hole-size" key={i} />)
                            : null
                        }
                      </div>
                      {isActing && (
                        <div className="timer-bar-container">
                          <div
                            className={`timer-bar ${timerPct < 25 ? "urgent" : ""}`}
                            style={{ width: `${timerPct}%` }}
                          />
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="seat-name" style={{ opacity: 0.5 }}>Empty</span>
                      <span className="seat-stack" style={{ fontSize: "0.7rem" }}>
                        {selectedSeat === seat.seatIndex ? "Sitting..." : "Click to sit"}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>

          {/* ── Coach speech bubble ── */}
          {coachEnabled && coachAdvice && viewerSeat && (
            <div className={`coach-bubble coach-${coachAdvice.type}`}>
              <div className="coach-bubble-arrow" />
              <span className="coach-bubble-icon">
                {coachAdvice.type === "warning" ? "⚠️" : coachAdvice.type === "tip" ? "💡" : "ℹ️"}
              </span>
              <p className="coach-bubble-text">{coachAdvice.message}</p>
              <button type="button" className="coach-dismiss" onClick={() => setCoachAdvice(null)}>×</button>
            </div>
          )}

          {/* ── Action bar below felt, next to your cards ── */}
          {viewerSeat && (
            <div className="action-bar">
              <div className="action-bar-main">
                <div className="action-bar-buttons">
                  <button
                    className="action-button fold-btn"
                    disabled={!legalActions?.canFold}
                    onClick={() => sendAction("fold")}
                  >Fold</button>
                  <button
                    className="action-button check-btn"
                    disabled={!legalActions?.canCheck}
                    onClick={() => sendAction("check")}
                  >Check</button>
                  <button
                    className="action-button call-btn"
                    disabled={!legalActions?.callAmount}
                    onClick={() => sendAction("call")}
                  >Call{legalActions?.callAmount ? ` ${formatAmount(legalActions.callAmount)}` : ""}</button>
                  <button
                    className="action-button bet-btn"
                    disabled={!legalActions?.betRange}
                    onClick={() => sendAction("bet", betAmount)}
                  >Bet{legalActions?.betRange ? ` ${formatAmount(betAmount)}` : ""}</button>
                  <button
                    className="action-button raise-btn"
                    disabled={!legalActions?.raiseRange}
                    onClick={() => sendAction("raise", betAmount)}
                  >Raise{legalActions?.raiseRange ? ` ${formatAmount(betAmount)}` : ""}</button>
                </div>
              </div>

              {activeRange && (
                <div className="action-bar-sizing">
                  <input
                    type="range"
                    className="bet-slider"
                    min={activeRange.min}
                    max={activeRange.max}
                    step={Math.max(1, snapshot.config.bigBlind)}
                    value={betAmount}
                    onChange={(e) => setBetAmount(Number(e.target.value))}
                  />
                  <div className="bet-presets">
                    <button type="button" className={`bet-preset-btn ${betAmount === activeRange.min ? "active" : ""}`} onPointerDown={(e) => { e.stopPropagation(); playClick(); setBetAmount(activeRange.min); }}>Min</button>
                    <button type="button" className={`bet-preset-btn ${snapshot.pot > 0 && betAmount === Math.min(activeRange.max, Math.max(activeRange.min, Math.floor(snapshot.pot * 0.5))) ? "active" : ""}`} onPointerDown={(e) => { e.stopPropagation(); playClick(); setBetAmount(Math.min(activeRange.max, Math.max(activeRange.min, Math.floor(snapshot.pot * 0.5)))); }}>½ pot</button>
                    <button type="button" className={`bet-preset-btn ${snapshot.pot > 0 && betAmount === Math.min(activeRange.max, Math.max(activeRange.min, snapshot.pot)) ? "active" : ""}`} onPointerDown={(e) => { e.stopPropagation(); playClick(); setBetAmount(Math.min(activeRange.max, Math.max(activeRange.min, snapshot.pot))); }}>Pot</button>
                    <button type="button" className={`bet-preset-btn ${betAmount === activeRange.max ? "active" : ""}`} onPointerDown={(e) => { e.stopPropagation(); playAllIn(); setBetAmount(activeRange.max); }}>All-in</button>
                  </div>
                  <div className="bet-amount-display">{formatAmount(betAmount)}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Side panel (history + feed + rebuy) ── */}
        <aside className="side-panel">
          {viewerSeat && isCrypto && (
            <section className="glass-card">
              <div className="card-header">
                <div>
                  <p className="eyebrow">Crypto</p>
                  <h2>Wallet</h2>
                </div>
              </div>
              <div className="crypto-seat-info">
                <div className="crypto-balance-row">
                  <span>Stack</span>
                  <strong>{formatAmount(viewerSeat.player?.stack ?? 0)}</strong>
                </div>
                {solPrice > 0 && (
                  <div className="crypto-balance-row crypto-secondary">
                    <span>1 SOL</span>
                    <span>${solPrice.toFixed(2)}</span>
                  </div>
                )}
                {wallet.connected && (
                  <>
                    <button
                      className="action-button"
                      onClick={() => void handleDeposit()}
                      disabled={depositPending || !snapshot.cryptoConfig}
                    >
                      {depositPending ? "Depositing..." : `Deposit ${formatSol(snapshot.cryptoConfig?.buyInLamports ?? 0)}`}
                    </button>
                    <button
                      className="action-button"
                      onClick={() => void handleWithdraw()}
                      disabled={withdrawPending || !viewerSeat.player?.stack}
                    >
                      {withdrawPending ? "Withdrawing..." : `Withdraw ${formatAmount(viewerSeat.player?.stack ?? 0)}`}
                    </button>
                  </>
                )}
                {!wallet.connected && <WalletButton />}
              </div>
            </section>
          )}

          {viewerSeat && !isCrypto && (
            <section className="glass-card">
              <div className="card-header">
                <div>
                  <p className="eyebrow">Seat {viewerSeat.seatIndex + 1}</p>
                  <h2>Rebuy</h2>
                </div>
              </div>
              <div className="buyin-row">
                <input
                  className="text-input"
                  type="number"
                  min={snapshot.config.minBuyIn}
                  max={snapshot.config.maxBuyIn}
                  value={buyIn}
                  onChange={(e) => setBuyIn(Number(e.target.value))}
                />
                <button
                  className="action-button rebuy-btn"
                  disabled={!viewerSeat}
                  onClick={() => void handleRebuy()}
                >Rebuy</button>
              </div>
            </section>
          )}

          <section className="glass-card history-card">
            <div className="card-header">
              <div>
                <p className="eyebrow">History</p>
                <h2>Hands</h2>
              </div>
            </div>
            <div className="history-list">
              {snapshot.handHistory.length === 0 ? (
                <p className="empty-state">No hands played yet.</p>
              ) : (
                snapshot.handHistory.map((hand) => (
                  <article className="history-entry" key={hand.handId}>
                    <strong>{hand.winners.map((w) => `${w.displayName} +${w.amount}`).join(" · ")}</strong>
                    <span>
                      {hand.winners.map((w) => w.handLabel).join(" / ")} &middot;{" "}
                      {hand.board.map((c) => `${c.rank}${SUIT_SYMBOL[c.suit]}`).join(" ")}
                    </span>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="glass-card feed-card">
            <div className="card-header">
              <div>
                <p className="eyebrow">Live</p>
                <h2>Feed</h2>
              </div>
            </div>
            <div className="feed-list" ref={feedRef}>
              {feed.length === 0 ? (
                <p className="empty-state">Events appear here.</p>
              ) : (
                feed.map((event, index) => (
                  <div className="feed-row" key={`${event.kind}-${index}`}>
                    <span>{event.detail}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
