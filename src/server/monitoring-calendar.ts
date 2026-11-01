import { AppError } from "./errors";
import type { MonitoringPurpose } from "@/lib/monitoring-contracts";

const DAY_MS = 86_400_000;
const CATCH_UP_MS = 48 * 3_600_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

export function validateTimezone(timezone: string): string {
  if (timezone.length > 80) throw new AppError(400, "TIMEZONE_INVALID", "项目时区无效。");
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    return timezone;
  } catch {
    throw new AppError(400, "TIMEZONE_INVALID", "请选择有效的项目时区。");
  }
}

function dateParts(at: Date, timezone: string) {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    validateTimezone(timezone);
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    // An application has only a few project timezones; bound this cache anyway.
    if (formatters.size >= 64) formatters.clear();
    formatters.set(timezone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(at).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour, minute: +parts.minute, second: +parts.second };
}

export function localDate(at: Date | string, timezone = "Asia/Shanghai"): string {
  const parts = dateParts(new Date(at), timezone);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

export function parseCalendarDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError(400, "DATE_INVALID", "请使用 YYYY-MM-DD 日期。");
  const at = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(at.getTime()) || at.toISOString().slice(0, 10) !== value) throw new AppError(400, "DATE_INVALID", "日历日期无效。");
  return at;
}

export function addCalendarDays(value: string, days: number): string {
  return new Date(parseCalendarDate(value).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

// Convert the wall-clock hour by observing IANA offsets rather than assuming a
// fixed +08 offset. Revalidation rejects nonexistent local times during DST.
export function localHourToUtc(date: string, timezone: string, hour = 10): string {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new AppError(400, "HOUR_INVALID", "执行小时无效。");
  const target = parseCalendarDate(date).getTime() + hour * 3_600_000;
  let candidate = target;
  for (let step = 0; step < 5; step++) {
    const parts = dateParts(new Date(candidate), timezone);
    const observed = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const delta = target - observed;
    candidate += delta;
    if (delta === 0) {
      return new Date(candidate).toISOString();
    }
  }
  throw new AppError(400, "LOCAL_TIME_UNAVAILABLE", "该日期的本地执行时间不存在，请调整日期。");
}

export interface CalendarSlot { purpose: MonitoringPurpose; localDate: string; scheduledAt: string }

export function planCalendar(firstBaselineDate: string, timezone: string, from: string, through: string): CalendarSlot[] {
  validateTimezone(timezone);
  parseCalendarDate(firstBaselineDate);
  parseCalendarDate(from);
  parseCalendarDate(through);
  const count = (parseCalendarDate(through).getTime() - parseCalendarDate(from).getTime()) / DAY_MS;
  if (count < 0 || count > 370) throw new AppError(400, "CALENDAR_RANGE_INVALID", "日历范围应在一年以内。");
  const slots: CalendarSlot[] = [];
  const baselineDates = [0, 1, 2].map((offset) => addCalendarDays(firstBaselineDate, offset));
  for (let offset = 0; offset <= count; offset++) {
    const date = addCalendarDays(from, offset);
    if (date < firstBaselineDate) continue;
    const scheduledAt = localHourToUtc(date, timezone);
    if (baselineDates.includes(date)) slots.push({ purpose: "baseline", localDate: date, scheduledAt });
    const weekday = parseCalendarDate(date).getUTCDay();
    if (weekday === 0) slots.push({ purpose: "full", localDate: date, scheduledAt });
    if (weekday === 2 || weekday === 5) slots.push({ purpose: "focus", localDate: date, scheduledAt });
  }
  return slots;
}

export function reviewCalendar(verifiedAt: string, timezone: string): CalendarSlot[] {
  const date = localDate(verifiedAt, timezone);
  return [7, 8, 9, 14, 15, 16].map((day) => {
    const local = addCalendarDays(date, day);
    return { purpose: day <= 9 ? "review-1" : "review-2", localDate: local, scheduledAt: localHourToUtc(local, timezone) };
  });
}

// Keep only the latest missed occurrence in a catch-up group. Dispatch records
// use `now` and evidence uses actual provider collection time, never this slot.
export function chooseCatchUp<T extends { id: string; scheduledAt: string }>(occurrences: T[], now = new Date()): { dispatch: T[]; missed: T[]; future: T[] } {
  const sorted = [...occurrences].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const future = sorted.filter((item) => new Date(item.scheduledAt).getTime() > now.getTime());
  const due = sorted.filter((item) => new Date(item.scheduledAt).getTime() <= now.getTime());
  const latest = due.at(-1);
  const eligible = latest && now.getTime() - new Date(latest.scheduledAt).getTime() <= CATCH_UP_MS ? latest : null;
  return { dispatch: eligible ? [eligible] : [], missed: due.filter((item) => item !== eligible), future };
}
