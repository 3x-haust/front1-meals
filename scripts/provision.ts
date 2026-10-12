import { z } from "zod";
import { createProvisionHandler } from "./provision-handler";

const challenge = z.string().min(32).parse(process.env["SETUP_KEY"]);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 18763,
  maxRequestBodySize: 1024,
  fetch: createProvisionHandler(challenge, async (value) => {
    await Bun.secrets.set({
      service: "front1-meals",
      name: "telegram-bot-token",
      value,
    });
    console.log("TELEGRAM_TOKEN_STORED");
  }),
});
console.log(`PROVISION_READY ${server.port}`);
