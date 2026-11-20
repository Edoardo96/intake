import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import type { LanguageResponse } from "@intake/shared";
import { isLanguage, type LanguageStore } from "../db/languageStore.js";

export interface LanguageRoutesOptions {
  language: LanguageStore;
  requireOwner: preHandlerHookHandler;
}

/**
 * GET /api/language is public, so the sign-in page already shows the chosen language; only the owner can change it.
 */
export const languageRoutes: FastifyPluginAsync<LanguageRoutesOptions> = async (app, { language, requireOwner }) => {
  app.get("/language", async (): Promise<LanguageResponse> => ({ language: language.get() }));

  app.put("/language", { preHandler: requireOwner }, async (request, reply) => {
    const value = (request.body as { language?: unknown } | null)?.language;
    if (!isLanguage(value)) return reply.code(400).send({ error: "invalid_language" });
    return { language: language.set(value) } satisfies LanguageResponse;
  });
};
