import { randomBytes } from "node:crypto";
import { z } from "zod";
import { configuration, save } from "../src/config/secrets";
import { telegram } from "../src/bot/telegram";
import { commandList, introduction } from "../src/bot/handler";

const action = z.enum(["secrets", "webhook", "profile"]).parse(process.argv[2]);
const config = await configuration();
let webhookSecret = process.env["WEBHOOK_SECRET"] ||
  await Bun.secrets.get({ service: "front1-meals", name: "webhook-secret" });
if (!webhookSecret) {
  webhookSecret = randomBytes(32).toString("hex");
  await save("webhook-secret", webhookSecret);
}
if (action === "secrets") {
  const child = Bun.spawn(["pnpm", "exec", "wrangler", "secret", "bulk"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdin: "pipe", stdout: "inherit", stderr: "inherit",
  });
  child.stdin.write(JSON.stringify({
    TELEGRAM_TOKEN: config.token,
    OURHOME_APP_KEY: config.appKey, WEBHOOK_SECRET: webhookSecret,
  }));
  child.stdin.end();
  if (await child.exited !== 0) process.exit(1);
} else if (action === "profile") {
  const send = telegram(config.token);
  await send("setMyDescription", { description: introduction("ko") });
  await send("setMyShortDescription", { short_description: "프론트원 마포 식단 · 오늘/내일/이번 주 · 한국어/English" });
  await send("setMyCommands", { scope: { type: "default" }, commands: commandList("ko") });
  console.log(JSON.stringify(await send("getMyDescription", {})));
} else {
  const input = z.url().parse(process.argv[3]);
  const origin = new URL(input);
  if (origin.protocol !== "https:" || !origin.hostname.endsWith(".workers.dev") || origin.pathname !== "/") {
    throw new RangeError("Expected an HTTPS workers.dev origin");
  }
  const send = telegram(config.token);
  await send("setMyCommands", { scope: { type: "default" }, commands: commandList("ko") });
  await send("setWebhook", {
    url: `${origin.origin}/telegram`, secret_token: webhookSecret,
    max_connections: 1, allowed_updates: ["message", "callback_query"],
  });
  const info = z.object({ url: z.string(), pending_update_count: z.number() })
    .parse(await send("getWebhookInfo", {}));
  console.log(JSON.stringify({ webhook: info.url, pending: info.pending_update_count }));
}
