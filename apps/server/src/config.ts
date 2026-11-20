import { z } from "zod";

const secret = z.string().min(32, "must be at least 32 characters");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.url().transform((url) => url.replace(/\/+$/, "")),
  DATA_DIR: z.string().min(1).default("./data"),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  OWNER_EMAIL: z.email().transform((email) => email.toLowerCase()),
  SESSION_SECRET: secret,
  TOKEN_ENCRYPTION_KEY: secret,
  NUTRITION_MCP_URL: z.url().default("https://nutrition-mcp.com/mcp"),
  WEB_DIST_DIR: z.string().optional(),
  /** Hevy API key (Hevy Pro → Settings → Developer); workouts are hidden without it. */
  HEVY_API_KEY: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  /** openGym base URL (self-hosted gym tracker), e.g. the DMZ address; workouts can come from openGym instead of Hevy. */
  OPENGYM_URL: z
    .string()
    .optional()
    .transform((value) => value?.trim().replace(/\/+$/, "") || undefined),
  /** openGym scoped API token (Settings → API tokens), "view" on workouts and plans is enough. */
  OPENGYM_TOKEN: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  /** Claude API key (console.anthropic.com) for recognizing meals from a photo or a description; hidden without it. */
  ANTHROPIC_API_KEY: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  /** Claude model for the recognition until one is chosen in Impostazioni; Haiku when empty. */
  RECOGNITION_MODEL: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  /** Address used for "Apri in openGym" links when OPENGYM_URL is an internal one; defaults to OPENGYM_URL. */
  OPENGYM_PUBLIC_URL: z
    .string()
    .optional()
    .transform((value) => value?.trim().replace(/\/+$/, "") || undefined),
});

export type Config = z.infer<typeof envSchema>;

/** Reads and validates the environment. Exits early with a readable error if anything is missing. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join("\n")}`);
  }
  return result.data;
}
