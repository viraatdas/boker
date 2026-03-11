import type {
  CreateTableInput,
  GuestSession,
  JoinTableInput,
  PublicTableSummary,
  TableActionInput,
  TableRebuyInput,
  TableSnapshot
} from "@boker/shared";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

export interface LocalGuestSession {
  guestId: string;
  displayName: string;
}

function buildUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

export function getWsBaseUrl(): string {
  return API_BASE_URL.replace(/^http/, "ws");
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({ message: "Request failed" }))) as { message?: string };
    throw new Error(payload.message ?? "Request failed");
  }

  return response.json() as Promise<T>;
}

export async function createGuest(displayName: string, guestId?: string): Promise<GuestSession> {
  return apiFetch("/v1/guests", {
    method: "POST",
    body: JSON.stringify({ guestId, displayName })
  });
}

export async function createTableRequest(input: CreateTableInput): Promise<{ tableId: string; tableCode: string; snapshot: TableSnapshot }> {
  return apiFetch("/v1/tables", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function listPublicTables(): Promise<PublicTableSummary[]> {
  return apiFetch("/v1/tables/public");
}

export async function resolveTableCode(tableCode: string): Promise<{ tableId: string; tableCode: string }> {
  return apiFetch(`/v1/tables/code/${encodeURIComponent(tableCode)}`);
}

export async function joinTable(tableId: string, input: JoinTableInput): Promise<TableSnapshot> {
  return apiFetch(`/v1/tables/${tableId}/join`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function seatAtTable(tableId: string, input: { guestId: string; displayName: string; seatIndex: number; buyIn: number; walletAddress?: string }): Promise<TableSnapshot> {
  return apiFetch(`/v1/tables/${tableId}/seat`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function leaveTable(tableId: string, guestId: string): Promise<TableSnapshot | null> {
  return apiFetch(`/v1/tables/${tableId}/leave`, {
    method: "POST",
    body: JSON.stringify({ guestId })
  });
}

export async function rebuy(tableId: string, input: TableRebuyInput): Promise<TableSnapshot> {
  return apiFetch(`/v1/tables/${tableId}/rebuy`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function fetchSnapshot(tableId: string, guestId?: string): Promise<TableSnapshot> {
  const query = guestId ? `?guestId=${encodeURIComponent(guestId)}` : "";
  return apiFetch(`/v1/tables/${tableId}${query}`);
}

export async function postAction(tableId: string, input: TableActionInput): Promise<TableSnapshot> {
  return apiFetch(`/v1/tables/${tableId}/action`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

// ── Crypto endpoints ──

export async function getEscrowInfo(): Promise<{ enabled: boolean; escrowAddress: string | null }> {
  return apiFetch("/v1/crypto/escrow");
}

export async function submitDeposit(
  tableId: string,
  input: { guestId: string; txSignature: string; expectedAmountLamports: number; fromAddress?: string }
): Promise<{ verified: boolean; chipsCredited: number }> {
  return apiFetch(`/v1/tables/${tableId}/deposit`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function requestWithdrawal(
  tableId: string,
  input: { guestId: string; amountLamports: number; toAddress: string }
): Promise<{ txSignature: string }> {
  return apiFetch(`/v1/tables/${tableId}/withdraw`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export const guestStorage = {
  read(): LocalGuestSession | null {
    if (typeof window === "undefined") {
      return null;
    }
    const raw = window.localStorage.getItem("boker.guest");
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as LocalGuestSession;
    } catch {
      return null;
    }
  },
  write(session: LocalGuestSession): void {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("boker.guest", JSON.stringify(session));
    }
  }
};
