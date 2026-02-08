export const TIMEZONE_COOKIE = "np_tz";

export const TIMEZONES = [
  { id: "Asia/Shanghai", label: "中国 (Asia/Shanghai)" },
  { id: "Asia/Kolkata", label: "印度 (Asia/Kolkata)" },
] as const;

export type TimezoneId = (typeof TIMEZONES)[number]["id"];

export function isAllowedTimezone(tz: string): tz is TimezoneId {
  return (TIMEZONES as readonly { id: string }[]).some((x) => x.id === tz);
}

