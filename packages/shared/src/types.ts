import { z } from "zod";

export const SUITS = ["c", "d", "h", "s"] as const;
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
export type TableVisibility = "public" | "private";
export type TableStatus = "waiting" | "active";
export type HandPhase = "preflop" | "flop" | "turn" | "river" | "showdown" | "complete";
export type PlayerActionType = "fold" | "check" | "call" | "bet" | "raise" | "sitOut";
export type TableEventType =
  | "table.created"
  | "player.joined"
  | "player.seated"
  | "player.left"
  | "player.rebuy"
  | "hand.started"
  | "player.acted"
  | "hand.finished"
  | "table.updated";

export const cardSchema = z.object({
  rank: z.enum(RANKS),
  suit: z.enum(SUITS)
});

export type Card = z.infer<typeof cardSchema>;

export interface GuestSession {
  guestId: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface TableConfig {
  visibility: TableVisibility;
  seatCount: number;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  aiSeatCount: number;
  actionTimeMs: number;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  callAmount: number | null;
  betRange: { min: number; max: number } | null;
  raiseRange: { min: number; max: number } | null;
}

export interface TablePlayer {
  playerId: string;
  guestId: string | null;
  displayName: string;
  isBot: boolean;
  stack: number;
  totalBuyIn: number;
  connected: boolean;
  sitOut: boolean;
  seatIndex: number;
  joinedAt: string;
  lastSeenAt: string;
}

export interface TableSeat {
  seatIndex: number;
  player: TablePlayer | null;
}

export interface HandPlayerState {
  playerId: string;
  seatIndex: number;
  holeCards: Card[];
  committed: number;
  totalCommitted: number;
  folded: boolean;
  allIn: boolean;
  actedThisRound: boolean;
  lastAction: PlayerActionType | null;
  lastAmount: number;
}

export interface WinnerSummary {
  playerId: string;
  displayName: string;
  amount: number;
  handLabel: string;
  holeCards: Card[];
}

export interface HandResult {
  handId: string;
  board: Card[];
  winners: WinnerSummary[];
  totalPot: number;
  endedAt: string;
}

export interface TableEvent {
  eventId: string;
  tableId: string;
  type: TableEventType;
  createdAt: string;
  payload: Record<string, unknown>;
  afterState: TableState;
}

export interface HandState {
  handId: string;
  phase: HandPhase;
  dealerSeatIndex: number;
  smallBlindSeatIndex: number;
  bigBlindSeatIndex: number;
  actingSeatIndex: number | null;
  currentBet: number;
  minRaiseBy: number;
  deck: Card[];
  community: Card[];
  pot: number;
  players: HandPlayerState[];
  actionDeadlineAt: string | null;
  startedAt: string;
}

export interface TableState {
  tableId: string;
  tableCode: string;
  hostGuestId: string;
  lastDealerSeatIndex: number | null;
  config: TableConfig;
  status: TableStatus;
  seats: TableSeat[];
  observers: GuestSession[];
  currentHand: HandState | null;
  handHistory: HandResult[];
  createdAt: string;
  updatedAt: string;
}

export interface VisibleSeatState {
  seatIndex: number;
  player: Omit<TablePlayer, "joinedAt" | "lastSeenAt"> | null;
  holeCards: Card[];
  committed: number;
  folded: boolean;
  allIn: boolean;
  lastAction: PlayerActionType | null;
  legalActions: LegalActions | null;
}

export interface TableSnapshot {
  tableId: string;
  tableCode: string;
  status: TableStatus;
  config: TableConfig;
  viewerGuestId: string | null;
  seats: VisibleSeatState[];
  board: Card[];
  pot: number;
  phase: HandPhase | null;
  actingSeatIndex: number | null;
  dealerSeatIndex: number | null;
  actionDeadlineAt: string | null;
  handHistory: HandResult[];
  createdAt: string;
  updatedAt: string;
}

export interface PublicTableSummary {
  tableId: string;
  tableCode: string;
  visibility: TableVisibility;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  playerCount: number;
  openSeats: number;
}

export interface CreateGuestInput {
  guestId?: string;
  displayName: string;
}

export interface CreateTableInput {
  guestId: string;
  displayName: string;
  config: Pick<TableConfig, "visibility" | "smallBlind" | "bigBlind" | "minBuyIn" | "maxBuyIn" | "aiSeatCount">;
}

export interface JoinTableInput {
  guestId: string;
  displayName: string;
}

export interface SeatPlayerInput {
  guestId: string;
  displayName: string;
  seatIndex: number;
  buyIn: number;
}

export interface LeaveTableInput {
  guestId: string;
}

export interface TableActionInput {
  guestId: string;
  action: PlayerActionType;
  amount?: number;
}

export interface TableRebuyInput {
  guestId: string;
  amount: number;
}

export interface BotDecision {
  action: Extract<PlayerActionType, "fold" | "check" | "call" | "bet" | "raise">;
  amount?: number;
}
