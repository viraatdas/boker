import { z } from "zod";
import { RANKS, SUITS } from "./types.js";

export const createGuestSchema = z.object({
  guestId: z.string().uuid().optional(),
  displayName: z.string().trim().min(2).max(24)
});

export const createTableSchema = z.object({
  guestId: z.string().uuid(),
  displayName: z.string().trim().min(2).max(24),
  config: z.object({
    visibility: z.enum(["public", "private"]),
    smallBlind: z.number().int().positive(),
    bigBlind: z.number().int().positive(),
    minBuyIn: z.number().int().positive(),
    maxBuyIn: z.number().int().positive(),
    aiSeatCount: z.number().int().min(0).max(5)
  })
});

export const joinTableSchema = z.object({
  guestId: z.string().uuid(),
  displayName: z.string().trim().min(2).max(24)
});

export const seatPlayerSchema = z.object({
  guestId: z.string().uuid(),
  displayName: z.string().trim().min(2).max(24),
  seatIndex: z.number().int().min(0).max(5),
  buyIn: z.number().int().positive()
});

export const leaveTableSchema = z.object({
  guestId: z.string().uuid()
});

export const rebuySchema = z.object({
  guestId: z.string().uuid(),
  amount: z.number().int().positive()
});

export const tableActionSchema = z.object({
  guestId: z.string().uuid(),
  action: z.enum(["fold", "check", "call", "bet", "raise", "sitOut"]),
  amount: z.number().int().positive().optional()
});

export const cardPayloadSchema = z.object({
  rank: z.enum(RANKS),
  suit: z.enum(SUITS)
});

export const wsClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("table.subscribe"),
    guestId: z.string().uuid()
  }),
  z.object({
    type: z.literal("table.action"),
    guestId: z.string().uuid(),
    action: z.enum(["fold", "check", "call", "bet", "raise", "sitOut"]),
    amount: z.number().int().positive().optional()
  }),
  z.object({
    type: z.literal("table.rebuy"),
    guestId: z.string().uuid(),
    amount: z.number().int().positive()
  }),
  z.object({
    type: z.literal("table.leave"),
    guestId: z.string().uuid()
  }),
  z.object({
    type: z.literal("table.coachMode"),
    guestId: z.string().uuid(),
    enabled: z.boolean()
  })
]);

export const wsServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("table.snapshot"),
    snapshot: z.unknown()
  }),
  z.object({
    type: z.literal("table.event"),
    event: z.object({
      kind: z.string(),
      detail: z.string()
    })
  }),
  z.object({
    type: z.literal("table.timer"),
    seatIndex: z.number().int().nullable(),
    remainingMs: z.number().int().nonnegative()
  }),
  z.object({
    type: z.literal("table.handResult"),
    result: z.unknown()
  }),
  z.object({
    type: z.literal("table.coachMode"),
    guestId: z.string(),
    enabled: z.boolean()
  }),
  z.object({
    type: z.literal("table.error"),
    message: z.string()
  })
]);
