import { createCipheriv, randomUUID } from "node:crypto";
import { z } from "zod";
import { source } from "../src/ourhome/client";
import { save, secret } from "../src/config/secrets";

const username = process.env["OURHOME_USERNAME"];
const inputPassword = process.env["OURHOME_PASSWORD"];
const credentials = z.object({ username: z.string().min(1), password: z.string().min(1) })
  .parse(username || inputPassword
    ? { username, password: inputPassword }
    : JSON.parse(await secret("ourhome-credentials")));
process.env["OURHOME_APP_KEY"] = await secret("ourhome-app-key", "OURHOME_APP_KEY");
const key = Buffer.from(await secret("ourhome-password-key", "OURHOME_PASSWORD_KEY"));
const cipher = createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
const password = Buffer.concat([cipher.update(credentials.password, "utf8"), cipher.final()]).toString("base64");
const response = z.object({ returnList: z.array(z.object({ SESSION_ID: z.string().min(1) })) })
  .parse(await source({
    GUBUN: "LOGIN_S1", ID: credentials.username, PASSWORD: password,
    DEVICE_ID: randomUUID(), DEVICE_OS: "android", DEVICE_OS_VERSION: "16",
    DEVICE_MANUFACTURER: "Google", DEVICE_MODEL: "sdk_gphone64_arm64",
    APP_VERSION: "3.2.26", PUSH_ID: "",
  }, "login"));
const session = response.returnList[0];
if (!session) throw new RangeError("Login returned no session");
await save("ourhome-session", session.SESSION_ID);
console.log("OURHOME_LOGIN_OK");
