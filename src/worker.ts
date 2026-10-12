import type { DurableObjectNamespace, DurableObjectState } from "@cloudflare/workers-types";
import { createBot } from "./bot/handler";
import { authorized, languageSchema } from "./config/secrets";
import { telegram, updateSchema } from "./bot/telegram";

export interface Env {
  readonly BOT: DurableObjectNamespace;
  readonly TELEGRAM_TOKEN: string;
  readonly WEBHOOK_SECRET: string;
  readonly OURHOME_APP_KEY: string;
}

export class MealBot {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  fetch(request: Request): Promise<Response> {
    const run = async () => {
      const update = updateSchema.parse(await request.json());
      const message = update.callback_query?.message ?? update.message;
      if (!message || message.chat.type !== "private") return new Response(null, { status: 204 });
      const last = (await this.state.storage.get<number>("last-update")) ?? -1;
      if (update.update_id <= last) return new Response(null, { status: 204 });
      const language = languageSchema.parse((await this.state.storage.get<string>("language")) ?? "ko");
      const bot = createBot({
        chatId: message.chat.id,
        language, send: telegram(this.env.TELEGRAM_TOKEN),
        saveLanguage: async (value) => { await this.state.storage.put("language", value); },
      });
      await bot.handle(update);
      await this.state.storage.put("last-update", update.update_id);
      return new Response(null, { status: 204 });
    };
    const response = this.queue.then(run, run);
    this.queue = response;
    return response;
  }
}

export async function workerFetch(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path !== "/telegram") return new Response(null, { status: 404 });
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (!env.WEBHOOK_SECRET || !authorized(request.headers.get("x-telegram-bot-api-secret-token"), env.WEBHOOK_SECRET)) {
    return new Response(null, { status: 401 });
  }
  const body = await request.text();
  const update = updateSchema.parse(JSON.parse(body));
  const message = update.callback_query?.message ?? update.message;
  if (!message || message.chat.type !== "private") return new Response(null, { status: 204 });
  const bot = env.BOT.get(env.BOT.idFromName(`chat:${message.chat.id}`));
  const response = await bot.fetch(request.url, {
    method: "POST", headers: { "content-type": "application/json" },
    body,
  });
  return new Response(await response.arrayBuffer(), { status: response.status });
}

export default { fetch: workerFetch };
