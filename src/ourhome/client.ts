import { z } from "zod";

const base = "https://mealcareapi.ourhome.co.kr/ohcare/v1/api";
export const dateSchema = z.string().regex(/^\d{8}$/).refine((value) => {
  const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10).replaceAll("-", "") === value;
});

export class SourceError extends Error {
  constructor(readonly code: string) {
    super(`Ourhome request failed (${code})`);
  }
}

export function koreanDate(now = new Date(), offset = 0): string {
  return new Date(now.valueOf() + (9 + offset * 24) * 3600000)
    .toISOString().slice(0, 10).replaceAll("-", "");
}

export function envelope(params: Readonly<Record<string, unknown>>, appKey: string, now = new Date()) {
  const d = new Date(now.valueOf() + 9 * 3600000);
  const year = String(d.getUTCFullYear());
  const digit = Number(`${d.getUTCSeconds() % 10}${d.getUTCMinutes() % 10}${d.getUTCHours() % 10}`);
  return {
    REQ_PARAMS: params,
    ISJSONPARA: "Y",
    EX_STOR_INFO: {
      EX_STOR_CD: 1030,
      ACCESS_TOKEN: appKey,
      SENDDTTM: d.toISOString().slice(0, 19).replaceAll(/[-T:]/g, ""),
      OURHOMEKEY: 100 - Number(year.slice(0, 2)) + 100 - Number(year.slice(2)) +
        100 - (d.getUTCMonth() + 1) + (100 - d.getUTCDate()) * digit + 1030 + 24,
    },
  };
}

export async function source(params: Readonly<Record<string, unknown>>, endpoint = "menu"): Promise<unknown> {
  const response = await fetch(`${base}/${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json", "x-app-version": "3.2.26",
      "x-client-context": "", "user-agent": "Dart/3.5 (dart:io)",
    },
    body: JSON.stringify(envelope(params, z.string().min(1).parse(process.env["OURHOME_APP_KEY"]))),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new SourceError(String(response.status));
  const data: unknown = await response.json();
  const status = z.object({ returnCode: z.string() }).parse(data);
  if (status.returnCode !== "1") throw new SourceError(status.returnCode);
  return data;
}

const cornerSchema = z.object({
  CORNER_CD: z.string(), CORNER_NM: z.string(),
  MENU_KOR: z.string(), MENU_ENG: z.string(),
  MENU_DTL_KOR: z.string(), MENU_DTL_ENG: z.string(),
  MENU_IMG_NM: z.string(), KCAL: z.string(),
  CONNER_DISPLAY_YN: z.string(),
});
const mealSchema = z.object({
  MENU_DT: dateSchema, MEALCLASS_KOR: z.string(), MEALCLASS_ENG: z.string(),
  FR_TM: z.string(), TO_TM: z.string(), CORNER_INFO: z.array(cornerSchema),
});
export const menuResponse = z.object({ returnList: z.array(mealSchema) });
export type Meal = z.infer<typeof mealSchema>;
const calendarResponse = z.object({
  returnList: z.array(z.object({
    DT: dateSchema, NON_WORK_YN: z.string(), HOLIDAY_YN: z.string(), CONFIRM_YN: z.string(),
  })),
});

export async function menu(date: string): Promise<readonly Meal[]> {
  return menuResponse.parse(await source({
    GUBUN: "TODAY_MENU_S1", ID: "", BUSIPLCD: "FA1N2",
    MENU_DT: dateSchema.parse(date), MEALCLASS_CD: null,
  })).returnList;
}

export async function day(date: string) {
  dateSchema.parse(date);
  const calendar = calendarResponse.parse(await source({
    GUBUN: "OH_CALENDAR_S1", BUSIPLCD: "FA1N2", FROM_DT: date, TO_DT: date,
  })).returnList.find((item) => item.DT === date);
  const status = calendar?.NON_WORK_YN === "Y" || calendar?.HOLIDAY_YN === "Y"
    ? "closed" : calendar?.CONFIRM_YN === "Y" ? "published" : "unpublished";
  return { date, status, meals: status === "published" ? await menu(date) : [] };
}

export async function week(now = new Date()) {
  const date = koreanDate(now);
  const monday = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return Promise.all(Array.from({ length: 7 }, (_, i) =>
    day(koreanDate(new Date(monday.valueOf() - 9 * 3600000), i))));
}

export function photoUrl(value: string): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
}
