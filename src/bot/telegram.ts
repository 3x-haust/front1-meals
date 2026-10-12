import { z } from "zod";

const person = z.object({ id: z.number().int() });
const message = z.object({
  message_id: z.number().int().optional(),
  from: person.optional(),
  chat: z.object({ id: z.number().int(), type: z.string() }),
  text: z.string().optional(),
});
export const updateSchema = z.object({
  update_id: z.number().int(),
  message: message.optional(),
  callback_query: z.object({
    id: z.string(), from: person, data: z.string().optional(),
    message: message.optional(),
  }).optional(),
});
export type Update = z.infer<typeof updateSchema>;

export class TelegramError extends Error {
  constructor(readonly code: number) {
    super(`Telegram request failed (${code})`);
  }
}

export function telegram(token: string) {
  return async (method: string, payload: Readonly<Record<string, unknown>>): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(45000),
      });
    } catch (error) {
      if (error instanceof Error) throw new TelegramError(0);
      throw error;
    }
    if (!response.ok) throw new TelegramError(response.status);
    const result = z.object({ ok: z.boolean(), result: z.unknown(), error_code: z.number().optional() })
      .parse(await response.json());
    if (!result.ok) throw new TelegramError(result.error_code ?? 0);
    return result.result;
  };
}
export type Telegram = ReturnType<typeof telegram>;
