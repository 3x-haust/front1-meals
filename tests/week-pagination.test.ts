import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { z } from "zod";
import { createBot } from "../src/bot/handler";
import { updateSchema } from "../src/bot/telegram";

const originalFetch = globalThis.fetch;
const originalKey = process.env["OURHOME_APP_KEY"];
const queries: string[] = [];

beforeEach(() => {
  setSystemTime(new Date("2026-10-14T03:00:00Z"));
  process.env["OURHOME_APP_KEY"] = "fixture-key";
  queries.length = 0;
  globalThis.fetch = Object.assign(async (_input: unknown, init?: RequestInit) => {
    const params = z.object({ REQ_PARAMS: z.object({
      GUBUN: z.string(), FROM_DT: z.string().optional(), MENU_DT: z.string().optional(),
    }) }).parse(JSON.parse(String(init?.body))).REQ_PARAMS;
    const date = params.MENU_DT ?? params.FROM_DT;
    if (!date) throw new RangeError("Missing fixture date");
    queries.push(date);
    return Response.json({ returnCode: "1", returnList: params.GUBUN === "OH_CALENDAR_S1"
      ? [{ DT: date, NON_WORK_YN: date.endsWith("17") || date.endsWith("18") ? "Y" : "N",
        HOLIDAY_YN: "N", CONFIRM_YN: date.endsWith("15") ? "N" : "Y" }]
      : [{
        MENU_DT: date, MEALCLASS_KOR: "중식", MEALCLASS_ENG: "Lunch",
        FR_TM: `${date}1130`, TO_TM: `${date}1300`,
        CORNER_INFO: [{
          CORNER_CD: "A", CORNER_NM: "한식", MENU_KOR: "국밥", MENU_ENG: "Soup",
          MENU_DTL_KOR: "쌀밥", MENU_DTL_ENG: "Rice", KCAL: "851",
          MENU_IMG_NM: "", CONNER_DISPLAY_YN: "Y",
        }],
      }] });
  }, { preconnect: originalFetch.preconnect });
});

afterEach(() => {
  setSystemTime();
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env["OURHOME_APP_KEY"];
  else process.env["OURHOME_APP_KEY"] = originalKey;
});

function fixture(language: "ko" | "en" = "ko") {
  const calls: { method: string; payload: Readonly<Record<string, unknown>> }[] = [];
  return {
    calls,
    bot: createBot({
      chatId: 42, language, saveLanguage: async () => {},
      send: async (method, payload) => { calls.push({ method, payload }); return true; },
    }),
  };
}

function callback(data: string) {
  return updateSchema.parse({
    update_id: 2, callback_query: {
      id: "page", from: { id: 42 }, data,
      message: { message_id: 88, chat: { id: 42, type: "private" } },
    },
  });
}

test("week sends only the Monday page and its next button", async () => {
  const { bot, calls } = fixture();
  await bot.handle({
    update_id: 1, message: { from: { id: 42 }, chat: { id: 42, type: "private" }, text: "/week" },
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.method).toBe("sendMessage");
  expect(calls[0]?.payload).toMatchObject({
    chat_id: 42, parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[expect.objectContaining({ callback_data: "week:20261012:1" })]] },
  });
  expect(calls[0]?.payload["text"]).toContain("<i>1 / 7</i>");
  expect(queries).toEqual(["20261012", "20261012"]);
});

test("page callbacks edit the same message and keep navigation inside the week", async () => {
  const { bot, calls } = fixture("en");
  await bot.handle(callback("week:20261012:1"));
  expect(calls.map((c) => c.method)).toEqual(["answerCallbackQuery", "editMessageText"]);
  expect(calls[1]?.payload).toMatchObject({
    chat_id: 42, message_id: 88,
    reply_markup: { inline_keyboard: [[
      expect.objectContaining({ callback_data: "week:20261012:0" }),
      expect.objectContaining({ callback_data: "week:20261012:2" }),
    ]] },
  });
  expect(queries).toEqual(["20261013", "20261013"]);
  calls.length = 0;
  queries.length = 0;
  await bot.handle(callback("week:20261012:6"));
  expect(calls[1]?.payload).toMatchObject({
    message_id: 88,
    reply_markup: { inline_keyboard: [[expect.objectContaining({ callback_data: "week:20261012:5" })]] },
  });
  expect(calls[1]?.payload["text"]).toContain("<i>7 / 7</i>");
  expect(queries).toEqual(["20261018"]);
});

test("unpublished pages remain navigable and invalid page data never loads menus", async () => {
  const { bot, calls } = fixture();
  await bot.handle(callback("week:20261012:3"));
  expect(calls[1]?.method).toBe("editMessageText");
  expect(queries).toEqual(["20261015"]);
  calls.length = 0;
  queries.length = 0;
  for (const data of ["week:20261012:7", "week:20260230:1"]) await bot.handle(callback(data));
  expect(calls.map((c) => c.method)).toEqual(["answerCallbackQuery", "answerCallbackQuery"]);
  expect(queries).toEqual([]);
});
