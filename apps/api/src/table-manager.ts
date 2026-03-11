import {
  addObserver,
  applyAutoAction,
  applyPlayerAction,
  createTable,
  createTableSnapshot,
  publicTableSummary,
  rebuyPlayer,
  seatPlayer as seatPlayerInEngine,
  setConnectionState,
  leaveTable as leaveTableInEngine,
  BOT_PERSONALITIES,
  createId,
  type BotPersonality,
  type CreateGuestInput,
  type CreateTableInput,
  type GuestSession,
  type HandResult,
  type JoinTableInput,
  type PlayerActionType,
  type PublicTableSummary,
  type TableSnapshot,
  type TableState
} from "@boker/shared";
import { GeminiBotService } from "./bot-service.js";
import { CryptoService } from "./crypto-service.js";
import type { Repository } from "./repository.js";

interface Subscriber {
  guestId: string;
  send: (message: unknown) => void;
}

interface MutateOptions {
  eventType: Parameters<Repository["appendEvent"]>[0]["type"];
  payload: Record<string, unknown>;
  detail: string;
  handResult?: HandResult | null;
}

function isPublicListableTable(table: unknown): table is TableState {
  if (!table || typeof table !== "object") {
    return false;
  }

  const candidate = table as Partial<TableState> & {
    config?: Partial<TableState["config"]>;
    seats?: unknown;
  };

  return (
    typeof candidate.tableId === "string" &&
    typeof candidate.tableCode === "string" &&
    !!candidate.config &&
    candidate.config.visibility === "public" &&
    typeof candidate.config.smallBlind === "number" &&
    typeof candidate.config.bigBlind === "number" &&
    typeof candidate.config.minBuyIn === "number" &&
    typeof candidate.config.maxBuyIn === "number" &&
    Array.isArray(candidate.seats)
  );
}

const BOT_NAMES = [
  "Ace", "Bluff", "Chip", "Dolly", "Edge",
  "Flick", "Gus", "Hank", "Izzy", "Jinx",
  "Kai", "Luna", "Mav", "Nyx", "Ozzy",
  "Phil", "Quinn", "Rex", "Sage", "Tex",
  "Vex", "Wren", "Zara", "Duke", "Fern",
  "Grit", "Juno", "Knox", "Milo", "Nash",
];

function pickBotName(takenNames: Set<string>): string {
  const available = BOT_NAMES.filter((n) => !takenNames.has(n));
  if (available.length === 0) return `Bot ${Math.floor(Math.random() * 1000)}`;
  return available[Math.floor(Math.random() * available.length)]!;
}

export class TableManager {
  private activeTables = new Map<string, TableState>();
  private subscribers = new Map<string, Set<Subscriber>>();
  private actionTimeouts = new Map<string, NodeJS.Timeout>();
  private timerIntervals = new Map<string, NodeJS.Timeout>();
  private botTimeouts = new Map<string, NodeJS.Timeout>();
  private botPersonalities = new Map<string, BotPersonality>(); // guestId → personality
  private coachModeGuests = new Map<string, Set<string>>(); // tableId → Set<guestId>

  private readonly crypto: CryptoService | null;

  constructor(
    private readonly repository: Repository,
    private readonly bots = new GeminiBotService(),
    crypto?: CryptoService
  ) {
    // Only initialize crypto service if ESCROW_PRIVATE_KEY is set or explicitly provided
    this.crypto = crypto ?? (process.env.ESCROW_PRIVATE_KEY ? new CryptoService() : null);
  }

  async createGuest(input: CreateGuestInput): Promise<GuestSession> {
    const existing = input.guestId ? await this.repository.getGuest(input.guestId) : null;
    const now = new Date().toISOString();
    const session: GuestSession = {
      guestId: existing?.guestId ?? input.guestId ?? crypto.randomUUID(),
      displayName: input.displayName.trim(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    await this.repository.upsertGuest(session);
    return session;
  }

  async createTable(input: CreateTableInput): Promise<{ table: TableState; snapshot: TableSnapshot }> {
    await this.createGuest({ guestId: input.guestId, displayName: input.displayName });

    // For crypto tables, inject the escrow address into cryptoConfig
    if (input.mode === "crypto") {
      if (!this.crypto) {
        throw new Error("Crypto tables are not enabled on this server (no ESCROW_PRIVATE_KEY)");
      }
      input = {
        ...input,
        cryptoConfig: {
          currency: "SOL",
          buyInLamports: input.cryptoConfig?.buyInLamports ?? 0,
          escrowAddress: this.crypto.escrowAddress
        }
      };
    }

    let table = createTable(input);
    table = addObserver(table, { guestId: input.guestId, displayName: input.displayName });
    await this.persist(table, {
      eventType: "table.created",
      payload: { hostGuestId: input.guestId, config: table.config, mode: table.mode },
      detail: table.mode === "crypto" ? "Crypto table created" : "Table created"
    });
    return {
      table,
      snapshot: createTableSnapshot(table, input.guestId)
    };
  }

  async listPublicTables(): Promise<PublicTableSummary[]> {
    const tables = await this.repository.listTables();
    return tables.filter(isPublicListableTable).map(publicTableSummary);
  }

  async getTable(tableIdOrCode: string): Promise<TableState | null> {
    const fromId = await this.loadTable(tableIdOrCode);
    if (fromId) {
      return fromId;
    }
    return this.repository.getTableByCode(tableIdOrCode);
  }

  async joinTable(tableIdOrCode: string, input: JoinTableInput): Promise<TableSnapshot> {
    await this.createGuest({ guestId: input.guestId, displayName: input.displayName });
    const table = await this.requireTable(tableIdOrCode);
    this.assertUniqueName(table, input.guestId, input.displayName);
    const next = addObserver(table, input);
    await this.persist(next, {
      eventType: "player.joined",
      payload: { guestId: input.guestId },
      detail: `${input.displayName} joined the lobby`
    });
    return createTableSnapshot(next, input.guestId);
  }

  async seatPlayer(
    tableId: string,
    input: { guestId: string; displayName: string; seatIndex: number; buyIn: number; walletAddress?: string }
  ): Promise<TableSnapshot> {
    const table = await this.requireTable(tableId);
    this.assertUniqueName(table, input.guestId, input.displayName);
    let next = seatPlayerInEngine(table, input);
    // Skip bots for crypto tables
    if (next.mode !== "crypto") {
      next = this.ensureBotSeats(next);
    }
    const handStarted = !table.currentHand && !!next.currentHand;
    await this.persist(next, {
      eventType: "player.seated",
      payload: { guestId: input.guestId, seatIndex: input.seatIndex, buyIn: input.buyIn },
      detail: `${input.displayName} took seat ${input.seatIndex + 1}`
    });
    if (handStarted && next.currentHand) {
      await this.persist(next, {
        eventType: "hand.started",
        payload: { handId: next.currentHand.handId },
        detail: "A new hand started"
      }, true);
    }
    return createTableSnapshot(next, input.guestId);
  }

  async leaveTable(tableId: string, guestId: string): Promise<TableSnapshot | null> {
    const table = await this.requireTable(tableId);
    const seatData = table.seats.find((seat) => seat.player?.guestId === guestId);
    const displayName = seatData?.player?.displayName ??
      table.observers.find((observer) => observer.guestId === guestId)?.displayName ??
      "Player";

    // For crypto tables, auto-withdraw remaining chips before leaving
    if (table.mode === "crypto" && seatData?.player && seatData.player.stack > 0 && seatData.player.walletAddress) {
      await this.processWithdrawal(table.tableId, guestId, seatData.player.walletAddress, seatData.player.stack);
    }

    const next = leaveTableInEngine(table, guestId);
    await this.persist(next, {
      eventType: "player.left",
      payload: { guestId },
      detail: `${displayName} left the table`
    });
    return createTableSnapshot(next, guestId);
  }

  async rebuy(tableId: string, guestId: string, amount: number): Promise<TableSnapshot> {
    const table = await this.requireTable(tableId);
    const next = rebuyPlayer(table, guestId, amount);
    await this.persist(next, {
      eventType: "player.rebuy",
      payload: { guestId, amount },
      detail: `Player rebought ${amount} chips`
    });
    return createTableSnapshot(next, guestId);
  }

  async action(tableId: string, guestId: string, action: PlayerActionType, amount?: number): Promise<TableSnapshot> {
    const table = await this.requireTable(tableId);
    const actor = table.seats.find((seat) => seat.player?.guestId === guestId)?.player;
    if (!actor) {
      throw new Error("Player is not seated");
    }
    const { table: next, result } = applyPlayerAction(table, { guestId, action, amount });
    await this.persist(next, {
      eventType: "player.acted",
      payload: { guestId, action, amount },
      detail: `${actor.displayName} ${action}${amount ? ` ${amount}` : ""}`,
      handResult: result
    });
    return createTableSnapshot(next, guestId);
  }

  async snapshot(tableId: string, guestId: string | null): Promise<TableSnapshot> {
    const table = await this.requireTable(tableId);
    return createTableSnapshot(table, guestId);
  }

  // ── Crypto methods ──

  getEscrowAddress(): string | null {
    return this.crypto?.escrowAddress ?? null;
  }

  async verifyDeposit(
    tableId: string,
    guestId: string,
    txSignature: string,
    expectedAmountLamports: number,
    fromAddress: string
  ): Promise<{ verified: boolean; chipsCredited: number }> {
    if (!this.crypto) {
      throw new Error("Crypto is not enabled on this server");
    }

    const table = await this.requireTable(tableId);
    if (table.mode !== "crypto") {
      throw new Error("This is not a crypto table");
    }

    // Check for duplicate tx
    const existing = await this.repository.getCryptoTransaction(txSignature);
    if (existing) {
      throw new Error("This transaction has already been processed");
    }

    const verification = await this.crypto.verifyDeposit(txSignature, expectedAmountLamports, fromAddress);

    const txRecord = {
      id: createId(),
      tableId,
      guestId,
      type: "deposit" as const,
      amountLamports: verification.amountLamports,
      txSignature,
      status: verification.verified ? ("confirmed" as const) : ("failed" as const),
      createdAt: new Date().toISOString()
    };
    await this.repository.saveCryptoTransaction(txRecord);

    if (!verification.verified) {
      return { verified: false, chipsCredited: 0 };
    }

    // In crypto mode, chips = lamports. Credit the deposited amount.
    const chipsCredited = verification.amountLamports;
    return { verified: true, chipsCredited };
  }

  async processWithdrawal(
    tableId: string,
    guestId: string,
    toAddress: string,
    amountLamports: number
  ): Promise<{ txSignature: string }> {
    if (!this.crypto) {
      throw new Error("Crypto is not enabled on this server");
    }

    const table = await this.requireTable(tableId);
    if (table.mode !== "crypto") {
      throw new Error("This is not a crypto table");
    }

    const seat = table.seats.find((s) => s.player?.guestId === guestId);
    if (!seat?.player) {
      throw new Error("Player is not seated");
    }

    if (amountLamports > seat.player.stack) {
      throw new Error("Withdrawal amount exceeds available chips");
    }

    const result = await this.crypto.sendWithdrawal(toAddress, amountLamports);

    const txRecord = {
      id: createId(),
      tableId,
      guestId,
      type: "withdrawal" as const,
      amountLamports,
      txSignature: result.txSignature,
      status: "confirmed" as const,
      createdAt: new Date().toISOString()
    };
    await this.repository.saveCryptoTransaction(txRecord);

    return { txSignature: result.txSignature };
  }

  async getEscrowBalance(): Promise<number> {
    if (!this.crypto) {
      throw new Error("Crypto is not enabled on this server");
    }
    return this.crypto.getEscrowBalance();
  }

  dispose(): void {
    for (const timeout of this.actionTimeouts.values()) {
      clearTimeout(timeout);
    }
    for (const timeout of this.botTimeouts.values()) {
      clearTimeout(timeout);
    }
    for (const interval of this.timerIntervals.values()) {
      clearInterval(interval);
    }
    this.actionTimeouts.clear();
    this.botTimeouts.clear();
    this.timerIntervals.clear();
  }

  async subscribe(tableId: string, guestId: string, send: Subscriber["send"]): Promise<() => Promise<void>> {
    const table = await this.requireTable(tableId);
    const subscribers = this.subscribers.get(table.tableId) ?? new Set<Subscriber>();
    const subscriber = { guestId, send };
    subscribers.add(subscriber);
    this.subscribers.set(table.tableId, subscribers);

    const next = setConnectionState(table, guestId, true);
    await this.persist(next, {
      eventType: "table.updated",
      payload: { guestId, connected: true },
      detail: "Player connected"
    }, true);

    const coachGuests = Array.from(this.getCoachModeGuests(table.tableId));
    const botMeta: Record<string, string> = {};
    for (const seat of next.seats) {
      if (seat.player?.isBot && seat.player.guestId) {
        const p = this.getBotPersonality(seat.player.guestId);
        if (p) botMeta[seat.player.guestId] = p;
      }
    }
    send({
      type: "table.snapshot",
      snapshot: createTableSnapshot(next, guestId),
      coachModeGuestIds: coachGuests,
      botPersonalities: botMeta
    });
    this.startTimerBroadcast(table.tableId);

    return async () => {
      const currentSubscribers = this.subscribers.get(table.tableId);
      if (currentSubscribers) {
        currentSubscribers.delete(subscriber);
        if (currentSubscribers.size === 0) {
          this.subscribers.delete(table.tableId);
          this.stopTimerBroadcast(table.tableId);
        }
      }
      const latest = await this.requireTable(table.tableId);
      const disconnected = setConnectionState(latest, guestId, false);
      await this.persist(disconnected, {
        eventType: "table.updated",
        payload: { guestId, connected: false },
        detail: "Player disconnected"
      }, true);
    };
  }

  private async requireTable(tableIdOrCode: string): Promise<TableState> {
    const table = (await this.loadTable(tableIdOrCode)) ?? (await this.repository.getTableByCode(tableIdOrCode));
    if (!table) {
      throw new Error("Table not found");
    }
    this.activeTables.set(table.tableId, table);
    return table;
  }

  private async loadTable(tableId: string): Promise<TableState | null> {
    const active = this.activeTables.get(tableId);
    if (active) {
      return active;
    }
    const table = await this.repository.getTable(tableId);
    if (table) {
      this.activeTables.set(table.tableId, table);
    }
    return table;
  }

  private assertUniqueName(table: TableState, guestId: string, displayName: string): void {
    const normalized = displayName.trim().toLowerCase();
    const inUse = table.seats.some(
      (seat) => seat.player && seat.player.guestId !== guestId && seat.player.displayName.trim().toLowerCase() === normalized
    );
    if (inUse) {
      throw new Error("Display name is already in use at this table");
    }
  }

  setCoachMode(tableId: string, guestId: string, enabled: boolean): void {
    if (!this.coachModeGuests.has(tableId)) {
      this.coachModeGuests.set(tableId, new Set());
    }
    const guests = this.coachModeGuests.get(tableId)!;
    if (enabled) {
      guests.add(guestId);
    } else {
      guests.delete(guestId);
    }
    // Broadcast to all subscribers
    this.broadcastEvent(tableId, {
      type: "table.coachMode",
      guestId,
      enabled
    });
  }

  getCoachModeGuests(tableId: string): Set<string> {
    return this.coachModeGuests.get(tableId) ?? new Set();
  }

  private assignBotPersonality(guestId: string): BotPersonality {
    const existing = this.botPersonalities.get(guestId);
    if (existing) return existing;
    const personality = BOT_PERSONALITIES[Math.floor(Math.random() * BOT_PERSONALITIES.length)]!;
    this.botPersonalities.set(guestId, personality);
    return personality;
  }

  getBotPersonality(guestId: string): BotPersonality | null {
    return this.botPersonalities.get(guestId) ?? null;
  }

  private ensureBotSeats(table: TableState): TableState {
    let next = table;
    const currentBots = next.seats.filter((seat) => seat.player?.isBot).length;
    const needed = Math.max(0, next.config.aiSeatCount - currentBots);
    if (needed === 0) {
      return next;
    }

    const takenNames = new Set(
      next.seats.filter((seat) => seat.player).map((seat) => seat.player!.displayName)
    );
    const emptySeats = next.seats.filter((seat) => !seat.player).map((seat) => seat.seatIndex).sort((left, right) => right - left);
    for (let index = 0; index < Math.min(needed, emptySeats.length); index += 1) {
      const name = pickBotName(takenNames);
      takenNames.add(name);
      const result = seatPlayerInEngine(next, {
        guestId: null,
        displayName: name,
        seatIndex: emptySeats[index]!,
        buyIn: next.config.minBuyIn,
        isBot: true
      });
      next = result;
      // Assign personality to the newly seated bot
      const newBot = next.seats[emptySeats[index]!]?.player;
      if (newBot?.guestId) {
        this.assignBotPersonality(newBot.guestId);
      }
    }
    return next;
  }

  private async persist(table: TableState, options: MutateOptions, skipBroadcast = false): Promise<void> {
    this.activeTables.set(table.tableId, table);
    await this.repository.saveTable(table);
    await this.repository.appendEvent({
      tableId: table.tableId,
      type: options.eventType,
      payload: options.payload,
      afterState: table
    });

    if (options.handResult) {
      await this.repository.appendEvent({
        tableId: table.tableId,
        type: "hand.finished",
        payload: { handId: options.handResult.handId, totalPot: options.handResult.totalPot },
        afterState: table
      });
    }

    if (!skipBroadcast) {
      this.broadcastEvent(table.tableId, {
        type: "table.event",
        event: {
          kind: options.eventType,
          detail: options.detail
        }
      });
      if (options.handResult) {
        this.broadcastEvent(table.tableId, {
          type: "table.handResult",
          result: options.handResult
        });
      }
      this.broadcastSnapshots(table.tableId, table);
    }

    this.scheduleTurn(table.tableId);
  }

  private broadcastSnapshots(tableId: string, table: TableState): void {
    const subscribers = this.subscribers.get(tableId);
    if (!subscribers) {
      return;
    }
    const coachGuests = Array.from(this.getCoachModeGuests(tableId));
    const botMeta: Record<string, string> = {};
    for (const seat of table.seats) {
      if (seat.player?.isBot && seat.player.guestId) {
        const p = this.getBotPersonality(seat.player.guestId);
        if (p) botMeta[seat.player.guestId] = p;
      }
    }
    for (const subscriber of subscribers) {
      const snapshot = createTableSnapshot(table, subscriber.guestId);
      subscriber.send({
        type: "table.snapshot",
        snapshot,
        coachModeGuestIds: coachGuests,
        botPersonalities: botMeta
      });
    }
  }

  private broadcastEvent(tableId: string, message: unknown): void {
    const subscribers = this.subscribers.get(tableId);
    if (!subscribers) {
      return;
    }
    for (const subscriber of subscribers) {
      subscriber.send(message);
    }
  }

  private scheduleTurn(tableId: string): void {
    const existingActionTimeout = this.actionTimeouts.get(tableId);
    if (existingActionTimeout) {
      clearTimeout(existingActionTimeout);
      this.actionTimeouts.delete(tableId);
    }
    const existingBotTimeout = this.botTimeouts.get(tableId);
    if (existingBotTimeout) {
      clearTimeout(existingBotTimeout);
      this.botTimeouts.delete(tableId);
    }

    const table = this.activeTables.get(tableId);
    if (!table?.currentHand || table.currentHand.actingSeatIndex === null || !table.currentHand.actionDeadlineAt) {
      return;
    }

    const actingSeat = table.seats[table.currentHand.actingSeatIndex];
    if (!actingSeat?.player) {
      return;
    }

    const timeoutMs = Math.max(0, Date.parse(table.currentHand.actionDeadlineAt) - Date.now());
    this.actionTimeouts.set(
      tableId,
      setTimeout(() => {
        void this.handleTurnTimeout(tableId);
      }, timeoutMs)
    );

    if (actingSeat.player.isBot && actingSeat.player.guestId) {
      this.botTimeouts.set(
        tableId,
        setTimeout(() => {
          void this.handleBotTurn(tableId, actingSeat.player!.guestId!);
        }, 900)
      );
    }
  }

  private startTimerBroadcast(tableId: string): void {
    if (this.timerIntervals.has(tableId)) {
      return;
    }
    this.timerIntervals.set(
      tableId,
      setInterval(() => {
        const table = this.activeTables.get(tableId);
        if (!table?.currentHand?.actionDeadlineAt) {
          return;
        }
        const remainingMs = Math.max(0, Date.parse(table.currentHand.actionDeadlineAt) - Date.now());
        this.broadcastEvent(tableId, {
          type: "table.timer",
          seatIndex: table.currentHand.actingSeatIndex,
          remainingMs
        });
      }, 1000)
    );
  }

  private stopTimerBroadcast(tableId: string): void {
    const interval = this.timerIntervals.get(tableId);
    if (interval) {
      clearInterval(interval);
      this.timerIntervals.delete(tableId);
    }
  }

  private async handleTurnTimeout(tableId: string): Promise<void> {
    const table = await this.requireTable(tableId);
    if (!table.currentHand || table.currentHand.actingSeatIndex === null) {
      return;
    }
    const actingPlayer = table.seats[table.currentHand.actingSeatIndex]?.player;
    if (!actingPlayer?.guestId) {
      return;
    }
    const { table: next, result } = applyAutoAction(table, actingPlayer.guestId);
    await this.persist(next, {
      eventType: "player.acted",
      payload: { guestId: actingPlayer.guestId, action: "timeout" },
      detail: `${actingPlayer.displayName} timed out`,
      handResult: result
    });
  }

  private async handleBotTurn(tableId: string, botGuestId: string): Promise<void> {
    const table = await this.requireTable(tableId);
    if (!table.currentHand || table.currentHand.actingSeatIndex === null) {
      return;
    }
    const currentActor = table.seats[table.currentHand.actingSeatIndex]?.player ?? null;
    if (!currentActor?.isBot || currentActor.guestId !== botGuestId) {
      return;
    }

    const personality = this.getBotPersonality(botGuestId) ?? undefined;
    const decision = await this.bots.decide(table, botGuestId, personality);
    const { table: next, result } = applyPlayerAction(table, {
      guestId: botGuestId,
      action: decision.action,
      amount: decision.amount
    });
    await this.persist(next, {
      eventType: "player.acted",
      payload: { guestId: botGuestId, action: decision.action, amount: decision.amount, bot: true },
      detail: `${currentActor.displayName} ${decision.action}${decision.amount ? ` ${decision.amount}` : ""}`,
      handResult: result
    });
  }
}
