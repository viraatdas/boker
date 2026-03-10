"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicTableSummary } from "@boker/shared";
import { createGuest, createTableRequest, guestStorage, listPublicTables, resolveTableCode } from "../lib/api";

interface CreateConfigState {
  visibility: "public" | "private";
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  aiSeatCount: number;
}

const PRESETS: { label: string; detail: string; config: Omit<CreateConfigState, "visibility" | "aiSeatCount"> }[] = [
  { label: "Micro", detail: "1/2 · 40-200", config: { smallBlind: 1, bigBlind: 2, minBuyIn: 40, maxBuyIn: 200 } },
  { label: "Low", detail: "5/10 · 200-1K", config: { smallBlind: 5, bigBlind: 10, minBuyIn: 200, maxBuyIn: 1000 } },
  { label: "Mid", detail: "25/50 · 1K-5K", config: { smallBlind: 25, bigBlind: 50, minBuyIn: 1000, maxBuyIn: 5000 } },
  { label: "High", detail: "100/200 · 5K-20K", config: { smallBlind: 100, bigBlind: 200, minBuyIn: 5000, maxBuyIn: 20000 } },
];

const defaultConfig: CreateConfigState = {
  visibility: "private",
  smallBlind: 5,
  bigBlind: 10,
  minBuyIn: 200,
  maxBuyIn: 1000,
  aiSeatCount: 1,
};

export function HomeClient() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [guestId, setGuestId] = useState<string | null>(null);
  const [publicTables, setPublicTables] = useState<PublicTableSummary[]>([]);
  const [tableCode, setTableCode] = useState("");
  const [config, setConfig] = useState<CreateConfigState>(defaultConfig);
  const [activePreset, setActivePreset] = useState(1); // "Low" by default
  const [showCustomize, setShowCustomize] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const localGuest = guestStorage.read();
    if (localGuest) {
      setDisplayName(localGuest.displayName);
      setGuestId(localGuest.guestId);
    }
    void refreshPublicTables();
  }, []);

  const canSubmit = useMemo(() => displayName.trim().length >= 2, [displayName]);

  async function ensureGuest() {
    const session = await createGuest(displayName, guestId ?? undefined);
    guestStorage.write({ guestId: session.guestId, displayName: session.displayName });
    setGuestId(session.guestId);
    setDisplayName(session.displayName);
    return session;
  }

  async function refreshPublicTables() {
    const tables = await listPublicTables().catch(() => []);
    setPublicTables(tables);
  }

  function applyPreset(index: number) {
    const preset = PRESETS[index];
    setActivePreset(index);
    setConfig((c) => ({ ...c, ...preset.config }));
  }

  async function handleCreateTable() {
    if (!canSubmit) {
      setError("Pick a display name first (min 2 characters).");
      return;
    }
    setLoading("create");
    setError(null);
    try {
      const session = await ensureGuest();
      const response = await createTableRequest({
        guestId: session.guestId,
        displayName: session.displayName,
        config,
      });
      startTransition(() => router.push(`/tables/${response.tableId}`));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create table");
    } finally {
      setLoading(null);
    }
  }

  async function handleJoinCode() {
    if (!tableCode.trim()) return;
    setLoading("join-code");
    setError(null);
    try {
      const resolved = await resolveTableCode(tableCode.trim().toUpperCase());
      startTransition(() => router.push(`/tables/${resolved.tableId}`));
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Could not find that table");
    } finally {
      setLoading(null);
    }
  }

  return (
    <main className="home-shell">
      <section className="hero-panel">
        <div className="hero-suits">
          <span>♠</span><span>♥</span><span>♦</span><span>♣</span>
        </div>
        <p className="eyebrow">boker</p>
        <h1>No-Limit Hold&apos;em in the browser</h1>
        <p className="hero-copy">
          Private link games and public tables. No account needed &mdash; pick a name, buy in, sit down. Fill open seats with AI.
        </p>
      </section>

      <section className="identity-section">
        <label htmlFor="displayName">Display name</label>
        <input
          id="displayName"
          className="text-input"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your name at the table"
        />
        <p className="identity-hint">Stored locally. Only needs to be unique per table.</p>
      </section>

      {error ? <div className="error-banner" style={{ maxWidth: "22rem", margin: "0.75rem auto" }}>{error}</div> : null}

      <section className="home-grid">
        {/* ── Create table ── */}
        <article className="glass-card">
          <header className="card-header">
            <div>
              <p className="eyebrow">Create</p>
              <h2>New table</h2>
            </div>
            <span className="pill">{config.smallBlind}/{config.bigBlind}</span>
          </header>

          <div className="preset-row">
            {PRESETS.map((preset, i) => (
              <button
                key={preset.label}
                className={`preset-btn ${activePreset === i ? "active" : ""}`}
                onClick={() => applyPreset(i)}
              >
                <span className="preset-label">{preset.label}</span>
                <span className="preset-detail">{preset.detail}</span>
              </button>
            ))}
          </div>

          <button
            className="text-button"
            style={{ marginBottom: showCustomize ? "0.5rem" : "0.75rem" }}
            onClick={() => setShowCustomize((v) => !v)}
          >
            {showCustomize ? "Hide options" : "Customize"}
          </button>

          {showCustomize && (
            <div className="form-grid">
              <label>
                Visibility
                <select
                  className="text-input"
                  value={config.visibility}
                  onChange={(e) => setConfig((c) => ({ ...c, visibility: e.target.value as "public" | "private" }))}
                >
                  <option value="private">Private (invite link)</option>
                  <option value="public">Public (lobby)</option>
                </select>
              </label>
              <label>
                Blinds
                <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                  <input
                    className="text-input"
                    type="number"
                    min={1}
                    value={config.smallBlind}
                    onChange={(e) => {
                      const sb = Number(e.target.value);
                      setConfig((c) => ({ ...c, smallBlind: sb, bigBlind: Math.max(sb * 2, c.bigBlind) }));
                      setActivePreset(-1);
                    }}
                    style={{ flex: 1 }}
                  />
                  <span style={{ color: "var(--muted)" }}>/</span>
                  <input
                    className="text-input"
                    type="number"
                    min={2}
                    value={config.bigBlind}
                    onChange={(e) => { setConfig((c) => ({ ...c, bigBlind: Number(e.target.value) })); setActivePreset(-1); }}
                    style={{ flex: 1 }}
                  />
                </div>
              </label>
              <label>
                Min buy-in
                <input
                  className="text-input"
                  type="number"
                  min={10}
                  value={config.minBuyIn}
                  onChange={(e) => { setConfig((c) => ({ ...c, minBuyIn: Number(e.target.value) })); setActivePreset(-1); }}
                />
              </label>
              <label>
                Max buy-in
                <input
                  className="text-input"
                  type="number"
                  min={config.minBuyIn}
                  value={config.maxBuyIn}
                  onChange={(e) => { setConfig((c) => ({ ...c, maxBuyIn: Number(e.target.value) })); setActivePreset(-1); }}
                />
              </label>
              <label className="full-width">
                AI players
                <div className="ai-seat-grid">
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      className={`ai-seat-chip ${config.aiSeatCount === n ? "active" : ""}`}
                      onClick={() => setConfig((c) => ({ ...c, aiSeatCount: n }))}
                      title={`${n} AI player${n !== 1 ? "s" : ""}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </label>
            </div>
          )}

          <button className="primary-button" style={{ width: "100%" }} onClick={() => void handleCreateTable()} disabled={loading === "create" || !canSubmit}>
            {loading === "create" ? "Creating..." : "Create table"}
          </button>
        </article>

        {/* ── Join / Browse ── */}
        <article className="glass-card">
          <header className="card-header">
            <div>
              <p className="eyebrow">Join</p>
              <h2>Enter by code</h2>
            </div>
          </header>
          <div className="join-row">
            <input
              className="text-input code-input"
              value={tableCode}
              onChange={(e) => setTableCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={6}
              onKeyDown={(e) => { if (e.key === "Enter") void handleJoinCode(); }}
            />
            <button className="secondary-button" onClick={() => void handleJoinCode()} disabled={loading === "join-code" || !tableCode.trim()}>
              {loading === "join-code" ? "..." : "Go"}
            </button>
          </div>

          <div className="public-list">
            <div className="public-list-header">
              <div>
                <p className="eyebrow">Browse</p>
                <h2>Public tables</h2>
              </div>
              <button className="text-button" onClick={() => void refreshPublicTables()}>Refresh</button>
            </div>
            {publicTables.length === 0 ? (
              <p className="empty-state">No public games running. Start the first one.</p>
            ) : (
              publicTables.map((table) => (
                <button
                  className="table-row"
                  key={table.tableId}
                  onClick={() => startTransition(() => router.push(`/tables/${table.tableId}`))}
                >
                  <div>
                    <strong>{table.tableCode}</strong>
                    <span>{table.smallBlind}/{table.bigBlind} blinds</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span>{table.playerCount}/6 seated</span>
                    <span>{table.openSeats} open</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </article>
      </section>
    </main>
  );
}
