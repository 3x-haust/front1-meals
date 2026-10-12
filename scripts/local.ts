import { z } from "zod";
import { configuration, languageSchema, save } from "../src/config/secrets";
import { createBot } from "../src/bot/handler";
import { telegram, updateSchema } from "../src/bot/telegram";

const config = await configuration();
const send = telegram(config.token);
console.log("FRONT1_READY");
let offset = Number((await Bun.secrets.get({ service: "front1-meals", name: "update-offset" })) ?? 0);
while (true) {
  const updates = z.array(updateSchema).parse(await send("getUpdates", {
    offset, timeout: 30, allowed_updates: ["message", "callback_query"],
  }));
  for (const update of updates) {
    const message = update.callback_query?.message ?? update.message;
    if (message?.chat.type === "private") {
      const key = `language:${message.chat.id}`;
      const language = languageSchema.parse(
        (await Bun.secrets.get({ service: "front1-meals", name: key })) ?? "ko",
      );
      await createBot({
        chatId: message.chat.id, language, send,
        saveLanguage: (value) => save(key, value),
      }).handle(update);
    }
    offset = update.update_id + 1;
    await save("update-offset", String(offset));
  }
}
