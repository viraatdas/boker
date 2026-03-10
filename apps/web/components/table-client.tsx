"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Card, LegalActions, TableSnapshot } from "@boker/shared";
import { createGuest, fetchSnapshot, getWsBaseUrl, guestStorage, joinTable, leaveTable, rebuy, seatAtTable } from "../lib/api";

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

export function TableClient({ tableId }: TableClientProps) {
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
  const socketRef = useRef<WebSocket | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const localGuest = guestStorage.read();
    if (localGuest) {
      setGuestId(localGuest.guestId);
      setDisplayName(localGuest.displayName);
    }
  }, []);

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
          | { type: "table.snapshot"; snapshot: TableSnapshot }
          | { type: "table.event"; event: FeedEvent }
          | { type: "table.timer"; remainingMs: number }
          | { type: "table.handResult"; result: HandResultMessage }
          | { type: "table.error"; message: string };

        switch (payload.type) {
          case "table.snapshot":
            setSnapshot(payload.snapshot);
            break;
          case "table.event":
            setFeed((current) => [payload.event, ...current].slice(0, 30));
            break;
          case "table.timer":
            setRemainingMs(payload.remainingMs);
            break;
          case "table.handResult":
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

  // Keep bet amount synced to available range
  useEffect(() => {
    const range = legalActions?.betRange ?? legalActions?.raiseRange;
    if (range) setBetAmount(range.min);
  }, [legalActions?.betRange?.min, legalActions?.raiseRange?.min, legalActions?.betRange, legalActions?.raiseRange]);

  const actionTimeMs = snapshot?.config.actionTimeMs ?? 25000;
  const timerPct = actionTimeMs > 0 ? Math.max(0, Math.min(100, (remainingMs / actionTimeMs) * 100)) : 0;

  async function ensureNamedGuest() {
    const session = await createGuest(displayName, guestId ?? undefined);
    guestStorage.write({ guestId: session.guestId, displayName: session.displayName });
    setGuestId(session.guestId);
    setDisplayName(session.displayName);
    return session;
  }

  async function takeSeat(seatIndex: number) {
    try {
      const session = await ensureNamedGuest();
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
      setError(e instanceof Error ? e.message : "Could not sit down");
    }
  }

  function sendAction(action: "fold" | "check" | "call" | "bet" | "raise", amount?: number) {
    if (!guestId || !socketRef.current) return;
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
      const next = await leaveTable(tableId, guestId);
      setSnapshot(next);
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
          <h1>{snapshot.config.smallBlind}/{snapshot.config.bigBlind} NLHE</h1>
        </div>
        <div className="header-actions">
          <span className="pill">{snapshot.config.visibility}</span>
          <button className="secondary-button" onClick={() => navigator.clipboard.writeText(window.location.href)}>
            Copy link
          </button>
          <button className="secondary-button" onClick={() => void handleLeave()}>Leave</button>
        </div>
      </section>

      {handBanner ? <div className="result-banner">{handBanner}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      <section className="table-layout">
        {/* ── Felt + actions column ── */}
        <div className="felt-col">
          <div className="felt-shell">
            <div className="board-center">
              <div className="pot-pill">Pot {snapshot.pot}</div>
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
              const isFolded = seat.folded;
              return (
                <button
                  type="button"
                  key={seat.seatIndex}
                  className={`seat seat-${index} ${occupied ? "occupied" : "open"} ${isActing ? "acting" : ""} ${isFolded ? "folded" : ""}`}
                  onClick={() => {
                    if (canTakeSeat) {
                      setSelectedSeat(seat.seatIndex);
                      void takeSeat(seat.seatIndex);
                    }
                  }}
                >
                  {occupied ? (
                    <>
                      <span className="seat-name">{seat.player?.displayName}</span>
                      <span className="seat-stack">{seat.player?.stack}</span>
                      <span className="seat-meta">
                        {seat.folded ? "fold" : seat.allIn ? "ALL IN" : seat.lastAction ?? ""}
                        {seat.player?.isBot ? <span className="bot-badge">AI</span> : null}
                      </span>
                      {seat.committed > 0 && <span className="seat-committed">{seat.committed}</span>}
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

          {/* ── Action bar below felt, next to your cards ── */}
          {viewerSeat && (
            <div className="action-bar">
              <div className="action-bar-main">
                <div className="action-bar-cards">
                  {viewerSeat.holeCards.length > 0
                    ? viewerSeat.holeCards.map((card) => (
                        <PlayingCard card={card} size="board-size" key={`ab-${card.rank}${card.suit}`} />
                      ))
                    : snapshot.phase && snapshot.phase !== "complete"
                      ? [0, 1].map((i) => <PlayingCard card={null} size="board-size" key={`ab-${i}`} />)
                      : null
                  }
                </div>

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
                  >Call{legalActions?.callAmount ? ` ${legalActions.callAmount}` : ""}</button>
                  <button
                    className="action-button bet-btn"
                    disabled={!legalActions?.betRange}
                    onClick={() => sendAction("bet", betAmount)}
                  >Bet{legalActions?.betRange ? ` ${betAmount}` : ""}</button>
                  <button
                    className="action-button raise-btn"
                    disabled={!legalActions?.raiseRange}
                    onClick={() => sendAction("raise", betAmount)}
                  >Raise{legalActions?.raiseRange ? ` ${betAmount}` : ""}</button>
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
                    <button className="bet-preset-btn" onClick={() => setBetAmount(activeRange.min)}>Min</button>
                    {snapshot.pot > 0 && (
                      <>
                        <button className="bet-preset-btn" onClick={() => setBetAmount(Math.min(activeRange.max, Math.max(activeRange.min, Math.floor(snapshot.pot * 0.5))))}>½ pot</button>
                        <button className="bet-preset-btn" onClick={() => setBetAmount(Math.min(activeRange.max, Math.max(activeRange.min, snapshot.pot)))}>Pot</button>
                      </>
                    )}
                    <button className="bet-preset-btn" onClick={() => setBetAmount(activeRange.max)}>All-in</button>
                  </div>
                  <div className="bet-amount-display">{betAmount}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Side panel (history + feed + rebuy) ── */}
        <aside className="side-panel">
          {viewerSeat && (
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
