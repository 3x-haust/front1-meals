import { afterEach, expect, test } from "bun:test";
import { createBot, dateLabel, keyboard, mealText } from "../src/bot/handler";
import { dateSchema, envelope, koreanDate, menu, photoUrl, week } from "../src/ourhome/client";
import { authorized, secret } from "../src/config/secrets";
import type { Language } from "../src/config/secrets";
import { telegram } from "../src/bot/telegram";
import { z } from "zod";

const originalFetch = globalThis.fetch;
const originalAppKey = process.env["OURHOME_APP_KEY"];
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAppKey === undefined) delete process.env["OURHOME_APP_KEY"];
  else process.env["OURHOME_APP_KEY"] = originalAppKey;
});

const fixture = {
  MENU_DT: "20261012", MEALCLASS_KOR: "중식", MEALCLASS_ENG: "Lunch",
  FR_TM: "202610121130", TO_TM: "202610121300",
  CORNER_INFO: [{
    CORNER_CD: "A", CORNER_NM: "한식", MENU_KOR: "설렁탕", MENU_ENG: "Beef soup",
    MENU_DTL_KOR: "쌀밥", MENU_DTL_ENG: "Rice", KCAL: "851",
    MENU_IMG_NM: "https://example.com/meal.jpg", CONNER_DISPLAY_YN: "Y",
  }],
};

function mockSource() {
  process.env["OURHOME_APP_KEY"] = "fixture-app-key";
  const bodies: unknown[] = [];
  globalThis.fetch = Object.assign(async (_input: unknown, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("user-agent")).toBe("Dart/3.5 (dart:io)");
    const body = z.object({ REQ_PARAMS: z.object({
      GUBUN: z.string(), FROM_DT: z.string().optional(), MENU_DT: z.string().optional(),
    }).passthrough() }).parse(JSON.parse(String(init?.body)));
    bodies.push(body);
    const p = body.REQ_PARAMS;
    return Response.json({ returnCode: "1", returnList: p.GUBUN === "OH_CALENDAR_S1"
      ? [{ DT: p.FROM_DT, NON_WORK_YN: p.FROM_DT?.endsWith("17") ? "Y" : "N",
        HOLIDAY_YN: "N", CONFIRM_YN: p.FROM_DT?.endsWith("15") ? "N" : "Y" }]
      : [{ ...fixture, MENU_DT: p.MENU_DT }] });
  }, { preconnect: originalFetch.preconnect });
  return bodies;
}

test("uses the KST clock and exact application envelope", () => {
  const instant = new Date("2026-10-12T03:45:56Z");
  const result = envelope({ GUBUN: "TODAY_MENU_S1" }, "fixture-app-key", instant);
  expect(result.ISJSONPARA).toBe("Y");
  expect(result.EX_STOR_INFO.SENDDTTM).toBe("20261012124556");
  expect(result.EX_STOR_INFO.OURHOMEKEY).toBe(80 + 74 + 90 + 88 * 652 + 1054);
  expect(koreanDate(new Date("2026-10-11T15:00:00Z"))).toBe("20261012");
  expect(koreanDate(new Date("2026-10-11T15:00:00Z"), 1)).toBe("20261013");
  expect(dateSchema.safeParse("20260230").success).toBe(false);
});

test("queries menus anonymously and retains source photo URLs", async () => {
  const requests = mockSource();
  const result = await menu("20261012");
  expect(requests).toMatchObject([{ REQ_PARAMS: { ID: "", BUSIPLCD: "FA1N2", MENU_DT: "20261012" } }]);
  expect(photoUrl(result[0]?.CORNER_INFO[0]?.MENU_IMG_NM ?? "")).toBe("https://example.com/meal.jpg");
  expect(photoUrl("")).toBeUndefined();
  expect(photoUrl("file:///private/image")).toBeUndefined();
});

test("week distinguishes unpublished and closed days without menu requests", async () => {
  const requests = mockSource();
  const result = await week(new Date("2026-10-14T03:00:00Z"));
  expect(result.map((d) => d.date)).toEqual(["20261012", "20261013", "20261014", "20261015", "20261016", "20261017", "20261018"]);
  expect(result[3]?.status).toBe("unpublished");
  expect(result[5]?.status).toBe("closed");
  expect(requests).not.toContainEqual(expect.objectContaining({
    REQ_PARAMS: expect.objectContaining({ GUBUN: "TODAY_MENU_S1", MENU_DT: "20261015" }),
  }));
});

test("webhook authentication rejects missing and incorrect shared secrets", () => {
  expect(authorized(null, "fixture-webhook-key")).toBe(false);
  expect(authorized("wrong", "fixture-webhook-key")).toBe(false);
  expect(authorized("fixture-webhook-key", "fixture-webhook-key")).toBe(true);
});

test("local secrets use configured environment values without requiring Keychain entries", async () => {
  const previous = process.env["FRONT1_TEST_SECRET"];
  process.env["FRONT1_TEST_SECRET"] = "fixture-environment-value";
  try {
    expect(await secret("nonexistent-test-entry", "FRONT1_TEST_SECRET")).toBe("fixture-environment-value");
  } finally {
    if (previous === undefined) delete process.env["FRONT1_TEST_SECRET"];
    else process.env["FRONT1_TEST_SECRET"] = previous;
  }
});

test("chat-scoped bot persists language changes and sends registered photos", async () => {
  mockSource();
  const calls: { method: string; payload: Readonly<Record<string, unknown>> }[] = [];
  const stored: Language[] = [];
  const bot = createBot({ chatId: 1, language: "ko",
    send: async (method, payload) => { calls.push({ method, payload }); return true; },
    saveLanguage: async (language) => { stored.push(language); },
  });
  await bot.handle({ update_id: 1, message: { from: { id: 2 }, chat: { id: 2, type: "private" }, text: "/today" } });
  expect(calls).toHaveLength(0);
  await bot.handle({ update_id: 2, message: { from: { id: 1 }, chat: { id: 1, type: "private" }, text: "/today" } });
  expect(calls).toContainEqual(expect.objectContaining({ method: "sendPhoto", payload: expect.objectContaining({ photo: "https://example.com/meal.jpg" }) }));
  calls.length = 0;
  await bot.handle({ update_id: 3, callback_query: {
    id: "callback", from: { id: 1 }, data: "lang:en",
    message: { chat: { id: 1, type: "private" } },
  } });
  expect(stored).toEqual(["en"]);
  expect(calls[0]?.method).toBe("answerCallbackQuery");
  expect(calls.some((c) => c.method === "setMyCommands")).toBe(true);
  calls.length = 0;
  await bot.handle({ update_id: 4, message: { from: { id: 1 }, chat: { id: -10, type: "group" }, text: "/today" } });
  expect(calls).toHaveLength(0);
});

test("different private users receive their own replies and independent language settings", async () => {
  mockSource();
  const calls: Readonly<Record<string, unknown>>[] = [];
  const first = createBot({
    chatId: 1, language: "ko", saveLanguage: async () => {},
    send: async (_method, payload) => { calls.push(payload); return true; },
  });
  const second = createBot({
    chatId: 2, language: "ko", saveLanguage: async () => {},
    send: async (_method, payload) => { calls.push(payload); return true; },
  });
  await first.handle({ update_id: 1, callback_query: {
    id: "language", from: { id: 1 }, data: "lang:en", message: { chat: { id: 1, type: "private" } },
  } });
  expect(calls.at(-1)).toMatchObject({ chat_id: 1, reply_markup: keyboard("en") });
  calls.length = 0;
  await second.handle({ update_id: 2, message: {
    from: { id: 2 }, chat: { id: 2, type: "private" }, text: "/today",
  } });
  expect(calls[0]).toMatchObject({ chat_id: 2, reply_markup: keyboard("ko") });
  expect(calls.every((payload) => payload["chat_id"] === 2)).toBe(true);
});

test("Telegram failures never include the token in error text", async () => {
  globalThis.fetch = Object.assign(async () => { throw new TypeError("secret-url"); },
    { preconnect: originalFetch.preconnect });
  await expect(telegram("private-token")("getUpdates", {})).rejects.toThrow("Telegram request failed (0)");
});

test("start and help send an introduction with language callbacks without loading menus", async () => {
  const upstream = mockSource();
  const messages: Readonly<Record<string, unknown>>[] = [];
  const bot = createBot({
    chatId: 1, language: "ko",
    send: async (method, payload) => {
      if (method === "sendMessage") messages.push(payload);
      return true;
    },
    saveLanguage: async () => { throw new RangeError("Start must not change language"); },
  });
  for (const [i, text] of ["/start", "/help"].entries()) {
    await bot.handle({
      update_id: i,
      message: { from: { id: 1 }, chat: { id: 1, type: "private" }, text },
    });
  }
  expect(upstream).toHaveLength(0);
  expect(messages).toHaveLength(4);
  for (const payload of [messages[1], messages[3]]) {
    expect(payload).toMatchObject({
      chat_id: 1,
      reply_markup: { inline_keyboard: [[
        expect.objectContaining({ callback_data: "lang:ko" }),
        expect.objectContaining({ callback_data: "lang:en" }),
      ]] },
    });
  }
});

test("meal formatting uses a full local date and supported escaped HTML without serving times", () => {
  expect(dateLabel("20261013", "ko")).toBe(new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "full", timeZone: "Asia/Seoul",
  }).format(new Date("2026-10-13T03:00:00Z")));
  const result = mealText({ ...fixture, CORNER_INFO: [{ ...fixture.CORNER_INFO[0],
    CORNER_CD: "A", CORNER_NM: "한식", MENU_KOR: "<국>&밥", MENU_ENG: "Soup",
    MENU_DTL_KOR: "반찬", MENU_DTL_ENG: "Sides", KCAL: "851",
    MENU_IMG_NM: "", CONNER_DISPLAY_YN: "Y",
  }] }, "ko");
  expect(result).toContain("&lt;국&gt;&amp;밥");
  expect(result).toContain("(851 kcal)");
  expect(result).toContain("<blockquote>&lt;국&gt;&amp;밥\n반찬</blockquote>");
  expect(result).not.toContain("<code>");
  expect(result).not.toContain("11:30");
  expect(result).not.toContain("13:00");
});

test("localized reply buttons route to menus and change with the selected language", async () => {
  mockSource();
  const calls: Readonly<Record<string, unknown>>[] = [];
  const bot = createBot({
    chatId: 1, language: "ko", saveLanguage: async () => {},
    send: async (_method, payload) => { calls.push(payload); return true; },
  });
  const button = keyboard("ko").keyboard[0]?.[0]?.text;
  if (!button) throw new RangeError("Missing today button");
  await bot.handle({ update_id: 1, message: { from: { id: 1 }, chat: { id: 1, type: "private" }, text: button } });
  expect(calls[0]).toMatchObject({ parse_mode: "HTML", reply_markup: keyboard("ko") });
  await bot.handle({ update_id: 2, callback_query: {
    id: "language", from: { id: 1 }, data: "lang:en", message: { chat: { id: 1, type: "private" } },
  } });
  expect(calls.at(-1)).toMatchObject({ reply_markup: keyboard("en") });
});
