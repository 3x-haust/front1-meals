import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

const service = "front1-meals";
export const languageSchema = z.enum(["ko", "en"]);
export type Language = z.infer<typeof languageSchema>;

export async function secret(name: string, variable?: string): Promise<string> {
  const value = variable ? process.env[variable] : undefined;
  return z.string().min(1).parse(value || await Bun.secrets.get({ service, name }));
}

export async function save(name: string, value: string): Promise<void> {
  await Bun.secrets.set({ service, name, value });
}

export async function configuration() {
  const appKey = await secret("ourhome-app-key", "OURHOME_APP_KEY");
  process.env["OURHOME_APP_KEY"] = appKey;
  return {
    token: await secret("telegram-bot-token", "TELEGRAM_TOKEN"),
    appKey,
  };
}

export function authorized(header: string | null, key: string): boolean {
  const supplied = Buffer.from(header ?? "");
  const expected = Buffer.from(key);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
