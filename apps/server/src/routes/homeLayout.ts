import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { HOME_CARDS } from "@intake/shared";
import { z } from "zod";
import type { HomeLayoutStore } from "../db/homeLayoutStore.js";

export interface HomeLayoutRoutesOptions {
  layout: HomeLayoutStore;
  requireOwner: preHandlerHookHandler;
}

const card = z.enum(HOME_CARDS);
const body = z.object({ order: z.array(card).max(50), hidden: z.array(card).max(50) }).strict();

/** GET / PUT /api/home-layout: which cards Oggi shows and in which order (Profilo › Personalizza home). */
export const homeLayoutRoutes: FastifyPluginAsync<HomeLayoutRoutesOptions> = async (app, { layout, requireOwner }) => {
  app.addHook("preHandler", requireOwner);
  app.get("/home-layout", async () => layout.get());
  app.put("/home-layout", async (request, reply) => {
    const parsed = body.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_layout" });
    return layout.set(parsed.data);
  });
};
