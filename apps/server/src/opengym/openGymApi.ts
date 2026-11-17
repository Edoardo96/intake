import type { z } from "zod";
import {
  muscleBalanceSchema,
  parseOpenGymState,
  previewSchema,
  routineDetailSchema,
  weekPlanSchema,
  workoutDetailSchema,
  type OpenGymMuscleBalance,
  type OpenGymPreview,
  type OpenGymState,
  type OpenGymWeekPlan,
} from "../parsers/openGym.js";

export class OpenGymError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "OpenGymError";
  }
}

/** Reads are kept in memory this long; openGym is on the owner's own server, so this is about speed, not limits. */
const CACHE_MS = 60_000;
const TIMEOUT_MS = 10_000;

/**
 * Read-only client of a self-hosted openGym with a scoped API token (Authorization: Bearer ogt_…):
 * the raw state for workout times, and the MCP endpoint (POST /mcp, stateless JSON-RPC) for what openGym
 * computes. Nothing is written and nothing is stored on Intake's side.
 */
export class OpenGymApi {
  private readonly cache = new Map<string, { at: number; value: Promise<unknown> }>();
  /** Exercise names per workout id: a finished workout does not change, so they are kept for the process lifetime. */
  private readonly names = new Map<string, Promise<Map<string, string>>>();
  private rpcId = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < CACHE_MS) return hit.value as Promise<T>;
    const value = load();
    this.cache.set(key, { at: this.now(), value });
    value.catch(() => this.cache.delete(key));
    return value;
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${this.token}`, accept: "application/json, text/event-stream", ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new OpenGymError(`openGym request failed: ${(error as Error).message}`);
    }
    if (!response.ok) throw new OpenGymError(`openGym answered ${response.status}`, response.status);
    const body = await response.json().catch(() => null);
    if (body === null) throw new OpenGymError("Unexpected openGym response");
    return body;
  }

  /** Calls an openGym MCP tool; its result is JSON in the first text content. */
  private tool<S extends z.ZodType>(name: string, args: Record<string, unknown>, schema: S): Promise<z.infer<S>> {
    return this.cached(`tool:${name}:${JSON.stringify(args)}`, async () => {
      const body = (await this.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.rpcId, method: "tools/call", params: { name, arguments: args } }),
      })) as { result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean }; error?: { message?: string } };
      if (body.error) throw new OpenGymError(`openGym tool ${name} failed: ${body.error.message ?? "error"}`);
      const text = body.result?.content?.find((c) => c.type === "text")?.text;
      if (!text || body.result?.isError) throw new OpenGymError(`openGym tool ${name} returned no result`);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new OpenGymError(`openGym tool ${name} returned text that is not JSON`);
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) throw new OpenGymError(`Unexpected openGym ${name} result`);
      return parsed.data;
    });
  }

  /** The app state the token can view (routines, week plan, workouts with start and end). */
  state(): Promise<OpenGymState> {
    return this.cached("state", async () => {
      const body = await this.request("/api/token/data");
      try {
        return parseOpenGymState(body);
      } catch {
        throw new OpenGymError("Unexpected openGym state");
      }
    });
  }

  weekPlan(): Promise<OpenGymWeekPlan> {
    return this.tool("get_week_plan", {}, weekPlanSchema);
  }

  /** The session a routine opens with on a date, after openGym's progression policy. */
  preview(date: string): Promise<OpenGymPreview> {
    return this.tool("preview_session", { date }, previewSchema);
  }

  muscleBalance(): Promise<OpenGymMuscleBalance> {
    return this.tool("muscle_balance", { period: "month" }, muscleBalanceSchema);
  }

  /** Exercise names (library ids → names) of the given routines, for exercises not in the workouts read in detail. */
  async routineExerciseNames(routineIds: string[]): Promise<Map<string, string>> {
    const routines = await Promise.all(routineIds.map((id) => this.tool("get_routine", { routine_id: id }, routineDetailSchema).catch(() => null)));
    return new Map(routines.flatMap((r) => (r ? r.exercises.map((e) => [e.id, e.name] as const) : [])));
  }

  /** Exercise names (openGym library ids → names) of one workout. */
  exerciseNames(workoutId: string): Promise<Map<string, string>> {
    const known = this.names.get(workoutId);
    if (known) return known;
    const value = this.tool("get_workout", { workout_id: workoutId }, workoutDetailSchema).then((w) => new Map(w.entries.map((e) => [e.id, e.name])));
    this.names.set(workoutId, value);
    value.catch(() => this.names.delete(workoutId));
    return value;
  }
}
