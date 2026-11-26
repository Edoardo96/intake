import { dishGroupUpdateSchema, dishLinkSchema, type DishGroupsResponse } from "@intake/shared";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import type { DishGroupStore } from "../db/dishGroupStore.js";

export interface DishGroupRoutesOptions {
  groups: DishGroupStore;
  requireOwner: preHandlerHookHandler;
}

/** Piatti intercambiabili under /api/dish-groups (part Alimentazione, always on). Rules in docs/dish-groups.md. */
export const dishGroupRoutes: FastifyPluginAsync<DishGroupRoutesOptions> = async (app, { groups, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  app.get("/dish-groups", async (): Promise<DishGroupsResponse> => ({ groups: groups.list() }));

  // "Aggiungi alternativa": from a favorite, by hand or the AI proposal of "Alternativa"
  app.post("/dish-groups/link", async (request, reply) => {
    const body = dishLinkSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_dish" });
    groups.link(body.data);
    return { groups: groups.list() } satisfies DishGroupsResponse;
  });

  // A dish removed from a group, or another name linked to one ("Collega anche")
  app.put<{ Params: { id: string } }>("/dish-groups/:id", async (request, reply) => {
    const id = Number(request.params.id);
    if (!groups.get(id)) return reply.code(404).send({ error: "Group not found" });
    const body = dishGroupUpdateSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_dish" });
    groups.update(id, body.data.dishes);
    return { groups: groups.list() } satisfies DishGroupsResponse;
  });

  app.delete<{ Params: { id: string } }>("/dish-groups/:id", async (request) => {
    groups.delete(Number(request.params.id));
    return { groups: groups.list() } satisfies DishGroupsResponse;
  });
};
