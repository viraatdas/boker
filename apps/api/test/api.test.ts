import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MemoryRepository } from "../src/repository";
import type { Repository } from "../src/repository";
import { GeminiBotService } from "../src/bot-service";
import { TableManager } from "../src/table-manager";
import { buildServer } from "../src/server";

describe("api", () => {
  let repository: MemoryRepository;
  let manager: TableManager;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    repository = new MemoryRepository();
    manager = new TableManager(repository, new GeminiBotService(undefined));
    app = await buildServer({ repository, manager });
  });

  afterEach(async () => {
    await app.close();
  });

  test("creates a guest, creates a table, joins and seats a player, and lists public tables", async () => {
    const guest = await app.inject({
      method: "POST",
      url: "/v1/guests",
      payload: { displayName: "Host" }
    });
    expect(guest.statusCode).toBe(200);
    const session = guest.json();

    const tableResponse = await app.inject({
      method: "POST",
      url: "/v1/tables",
      payload: {
        guestId: session.guestId,
        displayName: "Host",
        config: {
          visibility: "public",
          smallBlind: 5,
          bigBlind: 10,
          minBuyIn: 100,
          maxBuyIn: 500,
          aiSeatCount: 1
        }
      }
    });
    expect(tableResponse.statusCode).toBe(201);
    const tablePayload = tableResponse.json();

    const listing = await app.inject({
      method: "GET",
      url: "/v1/tables/public"
    });
    expect(listing.statusCode).toBe(200);
    expect(listing.json()).toHaveLength(1);

    const join = await app.inject({
      method: "POST",
      url: `/v1/tables/${tablePayload.tableId}/join`,
      payload: {
        guestId: session.guestId,
        displayName: "Host"
      }
    });
    expect(join.statusCode).toBe(200);

    const seat = await app.inject({
      method: "POST",
      url: `/v1/tables/${tablePayload.tableId}/seat`,
      payload: {
        guestId: session.guestId,
        displayName: "Host",
        seatIndex: 0,
        buyIn: 100
      }
    });
    expect(seat.statusCode).toBe(200);
    const snapshot = seat.json();
    expect(snapshot.seats[0].player.displayName).toBe("Host");
    expect(snapshot.seats.some((entry: { player: { isBot: boolean } | null }) => entry.player?.isBot)).toBe(true);
  });

  test("recovers latest table state from persisted event logs", async () => {
    const firstGuest = await app.inject({
      method: "POST",
      url: "/v1/guests",
      payload: { displayName: "Al" }
    });
    const secondGuest = await app.inject({
      method: "POST",
      url: "/v1/guests",
      payload: { displayName: "Bo" }
    });
    const a = firstGuest.json();
    const b = secondGuest.json();

    const tableResponse = await app.inject({
      method: "POST",
      url: "/v1/tables",
      payload: {
        guestId: a.guestId,
        displayName: "Al",
        config: {
          visibility: "private",
          smallBlind: 5,
          bigBlind: 10,
          minBuyIn: 100,
          maxBuyIn: 500,
          aiSeatCount: 0
        }
      }
    });
    const tablePayload = tableResponse.json();
    await app.inject({
      method: "POST",
      url: `/v1/tables/${tablePayload.tableId}/seat`,
      payload: { guestId: a.guestId, displayName: "Al", seatIndex: 0, buyIn: 100 }
    });
    await app.inject({
      method: "POST",
      url: `/v1/tables/${tablePayload.tableId}/join`,
      payload: { guestId: b.guestId, displayName: "Bo" }
    });
    await app.inject({
      method: "POST",
      url: `/v1/tables/${tablePayload.tableId}/seat`,
      payload: { guestId: b.guestId, displayName: "Bo", seatIndex: 1, buyIn: 100 }
    });

    const recoveredManager = new TableManager(repository, new GeminiBotService(undefined));
    const recoveredServer = await buildServer({ repository, manager: recoveredManager });
    const snapshot = await recoveredServer.inject({
      method: "GET",
      url: `/v1/tables/${tablePayload.tableId}?guestId=${a.guestId}`
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json().seats.filter((seat: { player: object | null }) => seat.player).length).toBe(2);
    await recoveredServer.close();
  });

  test("skips malformed persisted tables when listing public games", async () => {
    const malformedRepository: Repository = {
      async init() {},
      async upsertGuest() {},
      async getGuest() {
        return null;
      },
      async saveTable() {},
      async getTable() {
        return null;
      },
      async getTableByCode() {
        return null;
      },
      async listTables() {
        return [
          {
            tableId: "bad-table",
            tableCode: "BAD123",
            seats: []
          } as never
        ];
      },
      async appendEvent() {},
      async getEvents() {
        return [];
      },
      async saveCryptoTransaction() {},
      async getCryptoTransaction() {
        return null;
      },
      async listCryptoTransactions() {
        return [];
      },
      async updateGuestWallet() {}
    };

    const malformedManager = new TableManager(malformedRepository, new GeminiBotService(undefined));
    const malformedApp = await buildServer({ repository: malformedRepository, manager: malformedManager });
    const response = await malformedApp.inject({
      method: "GET",
      url: "/v1/tables/public"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
    await malformedApp.close();
  });

  test("broadcasts websocket snapshots and events", async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const firstGuest = (
      await app.inject({
        method: "POST",
        url: "/v1/guests",
        payload: { displayName: "Al" }
      })
    ).json();
    const secondGuest = (
      await app.inject({
        method: "POST",
        url: "/v1/guests",
        payload: { displayName: "Bo" }
      })
    ).json();

    const tablePayload = (
      await app.inject({
        method: "POST",
        url: "/v1/tables",
        payload: {
          guestId: firstGuest.guestId,
          displayName: "Al",
          config: {
            visibility: "private",
            smallBlind: 5,
            bigBlind: 10,
            minBuyIn: 100,
            maxBuyIn: 500,
            aiSeatCount: 0
          }
        }
      })
    ).json();

    await app.inject({
      method: "POST",
      url: `/v1/tables/${tablePayload.tableId}/seat`,
      payload: { guestId: firstGuest.guestId, displayName: "Al", seatIndex: 0, buyIn: 100 }
    });
    await app.inject({
      method: "POST",
      url: `/v1/tables/${tablePayload.tableId}/join`,
      payload: { guestId: secondGuest.guestId, displayName: "Bo" }
    });
    await app.inject({
      method: "POST",
      url: `/v1/tables/${tablePayload.tableId}/seat`,
      payload: { guestId: secondGuest.guestId, displayName: "Bo", seatIndex: 1, buyIn: 100 }
    });

    const messages: Array<{ type: string }> = [];
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/tables/${tablePayload.tableId}/ws?guestId=${firstGuest.guestId}`);
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("Timed out waiting for websocket messages"));
      }, 3000);

      socket.addEventListener("message", (event) => {
        const payload = JSON.parse(String(event.data)) as { type: string };
        messages.push(payload);
        if (messages.filter((message) => message.type === "table.snapshot").length >= 1) {
          socket.send(JSON.stringify({ type: "table.action", guestId: firstGuest.guestId, action: "call" }));
        }
        if (messages.some((message) => message.type === "table.event")) {
          clearTimeout(timeout);
          socket.close();
          resolve();
        }
      });

      socket.addEventListener("error", (event) => {
        clearTimeout(timeout);
        reject(event);
      });
    });

    expect(messages.some((message) => message.type === "table.snapshot")).toBe(true);
    expect(messages.some((message) => message.type === "table.event")).toBe(true);
  });
});
