import { z } from "zod";

export const TABLE_MODES = ["play", "crypto"] as const;
export type TableMode = (typeof TABLE_MODES)[number];

export interface CryptoConfig {
  currency: "SOL";
  buyInLamports: number;
  escrowAddress: string;
}

export interface WalletInfo {
  address: string;
  chain: "solana";
}

export interface CryptoTransaction {
  id: string;
  tableId: string;
  guestId: string;
  type: "deposit" | "withdrawal";
  amountLamports: number;
  txSignature: string;
  status: "pending" | "confirmed" | "failed";
  createdAt: string;
}

export const cryptoConfigSchema = z.object({
  currency: z.literal("SOL"),
  buyInLamports: z.number().int().positive(),
  escrowAddress: z.string().min(32).max(44)
});

export const walletInfoSchema = z.object({
  address: z.string().min(32).max(44),
  chain: z.literal("solana")
});

export const depositRequestSchema = z.object({
  guestId: z.string().uuid(),
  txSignature: z.string().min(64).max(128),
  expectedAmountLamports: z.number().int().positive()
});

export const withdrawRequestSchema = z.object({
  guestId: z.string().uuid(),
  amountLamports: z.number().int().positive(),
  toAddress: z.string().min(32).max(44)
});

/** Convert lamports to SOL for display */
export function lamportsToSol(lamports: number): number {
  return lamports / 1_000_000_000;
}

/** Convert SOL to lamports */
export function solToLamports(sol: number): number {
  return Math.round(sol * 1_000_000_000);
}

/** Format lamports as SOL string (e.g. "0.5 SOL") */
export function formatSol(lamports: number): string {
  const sol = lamportsToSol(lamports);
  if (sol >= 1) return `${sol.toFixed(2)} SOL`;
  if (sol >= 0.01) return `${sol.toFixed(4)} SOL`;
  return `${sol.toFixed(6)} SOL`;
}
