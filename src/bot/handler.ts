import { z } from "zod";
import { dateSchema, day, koreanDate, photoUrl, weekStart } from "../ourhome/client";
import type { Meal } from "../ourhome/client";
import { languageSchema } from "../config/secrets";
import type { Language } from "../config/secrets";
import type { Telegram, Update } from "./telegram";

const copy = {
  ko: { today: "오늘 식단", tomorrow: "내일 식단", week: "이번 주 식단", settings: "언어 설정",
    closed: "휴무", unpublished: "식단 미등록", empty: "등록된 식단이 없습니다.",
    failure: "식단을 불러오지 못했습니다. 잠시 후 다시 요청해 주세요.", saved: "한국어로 설정했습니다.",
    previous: "이전", next: "다음" },
  en: { today: "Today's menu", tomorrow: "Tomorrow's menu", week: "This week's menu", settings: "Language",
    closed: "Closed", unpublished: "Not published", empty: "No menu is available.",
    failure: "Could not load the menu. Please try again later.", saved: "Language set to English.",
    previous: "Previous", next: "Next" },
} as const;

const weekCallback = z.tuple([z.literal("week"), dateSchema, z.coerce.number().int().min(0).max(6)]);

export function dateLabel(date: string, language: Language): string {
  const instant = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T12:00:00+09:00`);
  return new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", {
    dateStyle: "full", timeZone: "Asia/Seoul",
  }).format(instant);
}

export function keyboard(language: Language) {
  const c = copy[language];
  return {
    keyboard: [[{ text: c.today }, { text: c.tomorrow }], [{ text: c.week }, { text: c.settings }]],
    resize_keyboard: true, is_persistent: true,
  };
}

function html(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function commandList(language: Language) {
  const c = copy[language];
  return [
    { command: "today", description: c.today }, { command: "tomorrow", description: c.tomorrow },
    { command: "week", description: c.week }, { command: "settings", description: c.settings },
  ];
}

export function introduction(language: Language): string {
  const c = copy[language];
  return [
    language === "ko"
      ? "Front1 Meals\n프론트원 마포 구내식당 식단을 확인하세요."
      : "Front1 Meals\nView the Front1 Mapo cafeteria menu.",
    `/today — ${c.today}\n/tomorrow — ${c.tomorrow}\n/week — ${c.week}\n/settings — ${c.settings}`,
    language === "ko"
      ? "등록된 음식 사진도 함께 보내드립니다.\n아래에서 한국어 또는 English를 선택할 수 있습니다."
      : "Registered meal photos are included.\nChoose Korean or English below.",
  ].join("\n\n");
}

export function mealText(meal: Meal, language: Language): string {
  const title = language === "ko" ? meal.MEALCLASS_KOR : meal.MEALCLASS_ENG;
  const corners = meal.CORNER_INFO.filter((c) => c.CONNER_DISPLAY_YN === "Y");
  return [
    `<b>${dateLabel(meal.MENU_DT, language)} · <u>${html(title)}</u></b>`,
    ...corners.map((c) => [
      `<b>${html(language === "ko" ? c.CORNER_NM : `Corner ${c.CORNER_CD}`)} (${html(c.KCAL)} kcal)</b>`,
      `<blockquote>${html((language === "ko" ? c.MENU_KOR : c.MENU_ENG).trim())}\n${html((language === "ko" ? c.MENU_DTL_KOR : c.MENU_DTL_ENG).trim())}</blockquote>`,
    ].join("\n")),
  ].join("\n\n");
}

export function createBot(options: {
  readonly chatId: number;
  readonly language: Language;
  readonly send: Telegram;
  readonly saveLanguage: (language: Language) => Promise<void>;
}) {
  let language = options.language;
  const sendText = async (text: string, extra: Readonly<Record<string, unknown>> = {}) => {
    for (let i = 0; i < text.length; i += 4000) {
      await options.send("sendMessage", {
        chat_id: options.chatId, text: text.slice(i, i + 4000),
        parse_mode: "HTML", reply_markup: keyboard(language), ...extra,
      });
    }
  };
  const commands = async () => {
    await options.send("setMyCommands", {
      scope: { type: "chat", chat_id: options.chatId },
      commands: commandList(language),
    });
  };
  const showDay = async (date: string) => {
    const result = await day(date);
    const c = copy[language];
    if (result.status !== "published") {
      await sendText(`${dateLabel(date, language)} · ${result.status === "closed" ? c.closed : c.unpublished}`);
      return;
    }
    if (!result.meals.length) await sendText(`${dateLabel(date, language)} · ${c.empty}`);
    for (const meal of result.meals) {
      await sendText(mealText(meal, language));
      for (const corner of meal.CORNER_INFO.filter((c) => c.CONNER_DISPLAY_YN === "Y")) {
        const photo = photoUrl(corner.MENU_IMG_NM);
        if (photo) await options.send("sendPhoto", {
          chat_id: options.chatId, photo,
          caption: (language === "ko" ? corner.MENU_KOR : corner.MENU_ENG).slice(0, 1024),
        });
      }
    }
  };
  const showWeek = async (start: string, page: number, messageId?: number) => {
    const monday = new Date(`${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6)}T00:00:00+09:00`);
    const result = await day(koreanDate(monday, page));
    const c = copy[language];
    const content = result.status === "published"
      ? result.meals.map((meal) => mealText(meal, language)).join("\n\n") || `${dateLabel(result.date, language)} · ${c.empty}`
      : `${dateLabel(result.date, language)} · ${result.status === "closed" ? c.closed : c.unpublished}`;
    const text = `${content}\n\n<i>${page + 1} / 7</i>`;
    const buttons = [
      ...(page > 0 ? [{ text: c.previous, callback_data: `week:${start}:${page - 1}` }] : []),
      ...(page < 6 ? [{ text: c.next, callback_data: `week:${start}:${page + 1}` }] : []),
    ];
    const reply_markup = { inline_keyboard: [buttons] };
    if (messageId === undefined) await sendText(text, { reply_markup });
    else await options.send("editMessageText", {
      chat_id: options.chatId, message_id: messageId, text, parse_mode: "HTML", reply_markup,
    });
  };
  const handle = async (update: Update) => {
    const callback = update.callback_query;
    const message = callback?.message ?? update.message;
    if (message?.chat.id !== options.chatId || message.chat.type !== "private") return;
    try { // no-excuse-ok: catch -- Responses never expose upstream errors or credentials.
      if (callback) {
        await options.send("answerCallbackQuery", { callback_query_id: callback.id });
        const page = weekCallback.safeParse(callback.data?.split(":"));
        if (page.success) {
          if (message.message_id !== undefined) await showWeek(page.data[1], page.data[2], message.message_id);
          return;
        }
        const parsed = languageSchema.safeParse(callback.data?.replace(/^lang:/, ""));
        if (!parsed.success) return;
        await options.saveLanguage(parsed.data);
        language = parsed.data;
        await commands();
        await sendText(copy[language].saved);
        return;
      }
      const text = message.text ?? "";
      const selected = Object.entries(copy[language]).find(([key, value]) =>
        ["today", "tomorrow", "week", "settings"].includes(key) && value === text);
      const command = selected ? `/${selected[0]}` : text.split(/\s/)[0]?.split("@")[0];
      if (command === "/settings" || command === "/language" || command === "/start" || command === "/help") {
        if (command === "/start" || command === "/help") {
          await commands();
          await sendText(introduction(language));
        }
        await sendText(copy[language].settings, { reply_markup: { inline_keyboard: [[
          { text: "한국어", callback_data: "lang:ko" },
          { text: "English", callback_data: "lang:en" },
        ]] } });
      } else if (command === "/week") {
        await showWeek(weekStart(), 0);
      } else if (command === "/today" || command === "/tomorrow") {
        await showDay(koreanDate(new Date(), command === "/tomorrow" ? 1 : 0));
      } else {
        await sendText("/today · /tomorrow · /week · /settings");
      }
    } catch {
      await sendText(copy[language].failure);
      console.error("BOT_REQUEST_FAILED");
    }
  };
  return { handle, commands };
}
