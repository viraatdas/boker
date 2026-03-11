import postgres from "postgres";
import { createId } from "@boker/shared";
import type { GuestSession, TableEvent, TableState } from "@boker/shared";
import type { CryptoTransaction } from "@boker/shared";

export interface Repository {
  init(): Promise<void>;
  upsertGuest(session: GuestSession): Promise<void>;
  getGuest(guestId: string): Promise<GuestSession | null>;
  saveTable(table: TableState): Promise<void>;
  getTable(tableId: string): Promise<TableState | null>;
  getTableByCode(tableCode: string): Promise<TableState | null>;
  listTables(): Promise<TableState[]>;
  appendEvent(event: Omit<TableEvent, "eventId" | "createdAt"> & { eventId?: string; createdAt?: string }): Promise<void>;
  getEvents(tableId: string): Promise<TableEvent[]>;
  saveCryptoTransaction(tx: CryptoTransaction): Promise<void>;
  getCryptoTransaction(txSignature: string): Promise<CryptoTransaction | null>;
  listCryptoTransactions(tableId: string, guestId?: string): Promise<CryptoTransaction[]>;
  updateGuestWallet(guestId: string, walletAddress: string): Promise<void>;
}

export function parseJsonColumn<T>(value: T | string | null | undefined): T | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }

  return value;
}

export class MemoryRepository implements Repository {
  private guests = new Map<string, GuestSession>();
  private tables = new Map<string, TableState>();
  private tableCodes = new Map<string, string>();
  private events = new Map<string, TableEvent[]>();
  private cryptoTransactions = new Map<string, CryptoTransaction>();
  private guestWallets = new Map<string, string>();

  async init(): Promise<void> {}

  async upsertGuest(session: GuestSession): Promise<void> {
    this.guests.set(session.guestId, structuredClone(session));
  }

  async getGuest(guestId: string): Promise<GuestSession | null> {
    return structuredClone(this.guests.get(guestId) ?? null);
  }

  async saveTable(table: TableState): Promise<void> {
    this.tables.set(table.tableId, structuredClone(table));
    this.tableCodes.set(table.tableCode, table.tableId);
  }

  async getTable(tableId: string): Promise<TableState | null> {
    const fromEvents = this.events.get(tableId)?.at(-1)?.afterState;
    if (fromEvents) {
      return structuredClone(fromEvents);
    }
    return structuredClone(this.tables.get(tableId) ?? null);
  }

  async getTableByCode(tableCode: string): Promise<TableState | null> {
    const tableId = this.tableCodes.get(tableCode);
    if (!tableId) {
      return null;
    }
    return this.getTable(tableId);
  }

  async listTables(): Promise<TableState[]> {
    return Array.from(this.tables.keys()).map((tableId) => structuredClone(this.events.get(tableId)?.at(-1)?.afterState ?? this.tables.get(tableId)!));
  }

  async appendEvent(event: Omit<TableEvent, "eventId" | "createdAt"> & { eventId?: string; createdAt?: string }): Promise<void> {
    const tableEvents = this.events.get(event.tableId) ?? [];
    tableEvents.push({
      eventId: event.eventId ?? createId(),
      tableId: event.tableId,
      type: event.type,
      payload: structuredClone(event.payload),
      afterState: structuredClone(event.afterState),
      createdAt: event.createdAt ?? new Date().toISOString()
    });
    this.events.set(event.tableId, tableEvents);
  }

  async getEvents(tableId: string): Promise<TableEvent[]> {
    return structuredClone(this.events.get(tableId) ?? []);
  }

  async saveCryptoTransaction(tx: CryptoTransaction): Promise<void> {
    this.cryptoTransactions.set(tx.txSignature, structuredClone(tx));
  }

  async getCryptoTransaction(txSignature: string): Promise<CryptoTransaction | null> {
    return structuredClone(this.cryptoTransactions.get(txSignature) ?? null);
  }

  async listCryptoTransactions(tableId: string, guestId?: string): Promise<CryptoTransaction[]> {
    return Array.from(this.cryptoTransactions.values())
      .filter((tx) => tx.tableId === tableId && (!guestId || tx.guestId === guestId));
  }

  async updateGuestWallet(guestId: string, walletAddress: string): Promise<void> {
    this.guestWallets.set(guestId, walletAddress);
  }
}

export class PostgresRepository implements Repository {
  private db: ReturnType<typeof postgres>;

  constructor(databaseUrl: string) {
    this.db = postgres(databaseUrl, {
      max: 4
    });
  }

  async init(): Promise<void> {
    await this.db`
      create table if not exists guests (
        guest_id uuid primary key,
        display_name text not null,
        created_at timestamptz not null,
        updated_at timestamptz not null
      )
    `;
    await this.db`
      create table if not exists tables (
        table_id uuid primary key,
        table_code text unique not null,
        host_guest_id uuid not null,
        visibility text not null,
        snapshot jsonb not null,
        created_at timestamptz not null,
        updated_at timestamptz not null
      )
    `;
    await this.db`
      create table if not exists table_events (
        event_id uuid primary key,
        table_id uuid not null references tables(table_id) on delete cascade,
        type text not null,
        payload jsonb not null,
        after_state jsonb not null,
        created_at timestamptz not null
      )
    `;
    await this.db`create index if not exists table_events_table_id_created_at_idx on table_events(table_id, created_at desc)`;
    await this.db`
      create table if not exists crypto_transactions (
        id uuid primary key,
        table_id uuid not null,
        guest_id uuid not null,
        type text not null,
        amount_lamports bigint not null,
        tx_signature text unique not null,
        status text not null default 'pending',
        created_at timestamptz not null
      )
    `;
    await this.db`create index if not exists crypto_tx_table_guest_idx on crypto_transactions(table_id, guest_id)`;
    await this.db`alter table guests add column if not exists wallet_address text`;
    await this.db`alter table tables add column if not exists mode text not null default 'play'`;
  }

  async upsertGuest(session: GuestSession): Promise<void> {
    await this.db`
      insert into guests (guest_id, display_name, created_at, updated_at)
      values (${session.guestId}, ${session.displayName}, ${session.createdAt}, ${session.updatedAt})
      on conflict (guest_id)
      do update set display_name = excluded.display_name, updated_at = excluded.updated_at
    `;
  }

  async getGuest(guestId: string): Promise<GuestSession | null> {
    const rows = await this.db`
      select guest_id, display_name, created_at, updated_at
      from guests
      where guest_id = ${guestId}
      limit 1
    `;
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      guestId: row.guest_id,
      displayName: row.display_name,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    };
  }

  async saveTable(table: TableState): Promise<void> {
    await this.db`
      insert into tables (table_id, table_code, host_guest_id, visibility, snapshot, created_at, updated_at)
      values (
        ${table.tableId},
        ${table.tableCode},
        ${table.hostGuestId},
        ${table.config.visibility},
        ${JSON.stringify(table)},
        ${table.createdAt},
        ${table.updatedAt}
      )
      on conflict (table_id)
      do update set
        table_code = excluded.table_code,
        visibility = excluded.visibility,
        snapshot = excluded.snapshot,
        updated_at = excluded.updated_at
    `;
  }

  private async loadLatestAfterState(tableId: string): Promise<TableState | null> {
    const rows = await this.db`
      select after_state
      from table_events
      where table_id = ${tableId}
      order by created_at desc
      limit 1
    `;
    const row = rows[0];
    return parseJsonColumn<TableState>(row?.after_state);
  }

  async getTable(tableId: string): Promise<TableState | null> {
    const fromEvents = await this.loadLatestAfterState(tableId);
    if (fromEvents) {
      return fromEvents;
    }
    const rows = await this.db`
      select snapshot
      from tables
      where table_id = ${tableId}
      limit 1
    `;
    return parseJsonColumn<TableState>(rows[0]?.snapshot);
  }

  async getTableByCode(tableCode: string): Promise<TableState | null> {
    const tableRows = await this.db`
      select table_id, snapshot
      from tables
      where table_code = ${tableCode}
      limit 1
    `;
    const row = tableRows[0];
    if (!row) {
      return null;
    }
    return (await this.loadLatestAfterState(row.table_id)) ?? parseJsonColumn<TableState>(row.snapshot);
  }

  async listTables(): Promise<TableState[]> {
    const rows = await this.db`
      select table_id
      from tables
      order by created_at desc
    `;
    const tables = await Promise.all(rows.map(async (row) => this.getTable(row.table_id)));
    return tables.filter((table): table is TableState => Boolean(table));
  }

  async appendEvent(event: Omit<TableEvent, "eventId" | "createdAt"> & { eventId?: string; createdAt?: string }): Promise<void> {
    await this.db`
      insert into table_events (event_id, table_id, type, payload, after_state, created_at)
      values (
        ${event.eventId ?? createId()},
        ${event.tableId},
        ${event.type},
        ${JSON.stringify(event.payload)},
        ${JSON.stringify(event.afterState)},
        ${event.createdAt ?? new Date().toISOString()}
      )
    `;
  }

  async getEvents(tableId: string): Promise<TableEvent[]> {
    const rows = await this.db`
      select event_id, table_id, type, payload, after_state, created_at
      from table_events
      where table_id = ${tableId}
      order by created_at asc
    `;
    return rows.flatMap((row) => {
      const afterState = parseJsonColumn<TableState>(row.after_state);
      if (!afterState) {
        return [];
      }

      return [{
        eventId: row.event_id,
        tableId: row.table_id,
        type: row.type,
        payload: parseJsonColumn<Record<string, unknown>>(row.payload) ?? {},
        afterState,
        createdAt: new Date(row.created_at).toISOString()
      }];
    });
  }

  async saveCryptoTransaction(tx: CryptoTransaction): Promise<void> {
    await this.db`
      insert into crypto_transactions (id, table_id, guest_id, type, amount_lamports, tx_signature, status, created_at)
      values (${tx.id}, ${tx.tableId}, ${tx.guestId}, ${tx.type}, ${tx.amountLamports}, ${tx.txSignature}, ${tx.status}, ${tx.createdAt})
      on conflict (tx_signature)
      do update set status = excluded.status
    `;
  }

  async getCryptoTransaction(txSignature: string): Promise<CryptoTransaction | null> {
    const rows = await this.db`
      select id, table_id, guest_id, type, amount_lamports, tx_signature, status, created_at
      from crypto_transactions
      where tx_signature = ${txSignature}
      limit 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      tableId: row.table_id,
      guestId: row.guest_id,
      type: row.type,
      amountLamports: Number(row.amount_lamports),
      txSignature: row.tx_signature,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString()
    };
  }

  async listCryptoTransactions(tableId: string, guestId?: string): Promise<CryptoTransaction[]> {
    const rows = guestId
      ? await this.db`
          select id, table_id, guest_id, type, amount_lamports, tx_signature, status, created_at
          from crypto_transactions
          where table_id = ${tableId} and guest_id = ${guestId}
          order by created_at desc
        `
      : await this.db`
          select id, table_id, guest_id, type, amount_lamports, tx_signature, status, created_at
          from crypto_transactions
          where table_id = ${tableId}
          order by created_at desc
        `;
    return rows.map((row) => ({
      id: row.id,
      tableId: row.table_id,
      guestId: row.guest_id,
      type: row.type,
      amountLamports: Number(row.amount_lamports),
      txSignature: row.tx_signature,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString()
    }));
  }

  async updateGuestWallet(guestId: string, walletAddress: string): Promise<void> {
    await this.db`
      update guests set wallet_address = ${walletAddress} where guest_id = ${guestId}
    `;
  }
}

export async function createRepository(databaseUrl?: string): Promise<Repository> {
  const repository = databaseUrl ? new PostgresRepository(databaseUrl) : new MemoryRepository();
  await repository.init();
  return repository;
}
