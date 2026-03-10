import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import {
  createGuestSchema,
  createTableSchema,
  joinTableSchema,
  leaveTableSchema,
  rebuySchema,
  seatPlayerSchema,
  tableActionSchema,
  wsClientMessageSchema
} from "@boker/shared";
import { createRepository, type Repository } from "./repository.js";
import { GeminiBotService } from "./bot-service.js";
import { TableManager } from "./table-manager.js";

export interface BuildServerOptions {
  repository?: Repository;
  manager?: TableManager;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const repository = options.repository ?? (await createRepository(process.env.DATABASE_URL));
  const manager = options.manager ?? new TableManager(repository, new GeminiBotService());
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    credentials: false
  });
  await app.register(websocket);

  app.get("/healthz", async () => ({ ok: true }));

  app.post("/v1/guests", async (request, reply) => {
    const parsed = createGuestSchema.parse(request.body);
    const session = await manager.createGuest(parsed);
    return reply.send(session);
  });

  app.post("/v1/tables", async (request, reply) => {
    const parsed = createTableSchema.parse(request.body);
    const { table, snapshot } = await manager.createTable(parsed);
    return reply.code(201).send({
      tableId: table.tableId,
      tableCode: table.tableCode,
      snapshot
    });
  });

  app.get("/v1/tables/public", async () => manager.listPublicTables());

  app.get("/v1/tables/:tableId", async (request) => {
    const params = request.params as { tableId: string };
    const query = request.query as { guestId?: string };
    return manager.snapshot(params.tableId, query.guestId ?? null);
  });

  app.get("/v1/tables/code/:tableCode", async (request, reply) => {
    const params = request.params as { tableCode: string };
    const table = await manager.getTable(params.tableCode);
    if (!table) {
      return reply.code(404).send({ message: "Table not found" });
    }
    return reply.send({
      tableId: table.tableId,
      tableCode: table.tableCode
    });
  });

  app.post("/v1/tables/:tableId/join", async (request) => {
    const params = request.params as { tableId: string };
    const parsed = joinTableSchema.parse(request.body);
    return manager.joinTable(params.tableId, parsed);
  });

  app.post("/v1/tables/:tableId/seat", async (request) => {
    const params = request.params as { tableId: string };
    const parsed = seatPlayerSchema.parse(request.body);
    return manager.seatPlayer(params.tableId, parsed);
  });

  app.post("/v1/tables/:tableId/leave", async (request) => {
    const params = request.params as { tableId: string };
    const parsed = leaveTableSchema.parse(request.body);
    return manager.leaveTable(params.tableId, parsed.guestId);
  });

  app.post("/v1/tables/:tableId/rebuy", async (request) => {
    const params = request.params as { tableId: string };
    const parsed = rebuySchema.parse(request.body);
    return manager.rebuy(params.tableId, parsed.guestId, parsed.amount);
  });

  app.post("/v1/tables/:tableId/action", async (request) => {
    const params = request.params as { tableId: string };
    const parsed = tableActionSchema.parse(request.body);
    return manager.action(params.tableId, parsed.guestId, parsed.action, parsed.amount);
  });

  app.get("/v1/tables/:tableId/ws", { websocket: true }, async (socket, request) => {
    const params = request.params as { tableId: string };
    const query = request.query as { guestId?: string };
    const guestId = query.guestId;
    if (!guestId) {
      socket.send(JSON.stringify({ type: "table.error", message: "guestId is required" }));
      socket.close();
      return;
    }

    const unsubscribe = await manager.subscribe(params.tableId, guestId, (message) => {
      socket.send(JSON.stringify(message));
    });

    socket.on("message", async (buffer: Buffer) => {
      try {
        const raw = JSON.parse(buffer.toString());
        const message = wsClientMessageSchema.parse(raw);
        switch (message.type) {
          case "table.subscribe":
            socket.send(JSON.stringify({ type: "table.event", event: { kind: "table.subscribe", detail: "Subscribed" } }));
            break;
          case "table.action":
            await manager.action(params.tableId, message.guestId, message.action, message.amount);
            break;
          case "table.rebuy":
            await manager.rebuy(params.tableId, message.guestId, message.amount);
            break;
          case "table.leave":
            await manager.leaveTable(params.tableId, message.guestId);
            break;
          case "table.coachMode":
            manager.setCoachMode(params.tableId, message.guestId, message.enabled);
            break;
        }
      } catch (error) {
        socket.send(
          JSON.stringify({
            type: "table.error",
            message: error instanceof Error ? error.message : "Invalid message"
          })
        );
      }
    });

    socket.on("close", () => {
      void unsubscribe();
    });
  });

  app.setErrorHandler((error: unknown, _request, reply) => {
    const message = error instanceof Error ? error.message : "Unexpected error";
    const statusCode = message === "Table not found" ? 404 : 400;
    reply.code(statusCode).send({ message });
  });

  app.addHook("onClose", async () => {
    manager.dispose();
  });

  return app;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  const port = Number(process.env.PORT ?? 8080);
  buildServer()
    .then((app) => app.listen({ port, host: "0.0.0.0" }))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
