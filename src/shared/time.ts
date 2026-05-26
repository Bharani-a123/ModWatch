const SLOT_COUNT = 48;
const SLOT_MINUTES = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (value: number): string => value.toString().padStart(2, '0');

export function formatDateUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function getSlotIndexFromDate(date: Date): number {
  return date.getUTCHours() * 2 + (date.getUTCMinutes() >= 30 ? 1 : 0);
}

export function slotIndexToTime(slotIndex: number): string {
  const safeSlot = Math.max(0, Math.min(SLOT_COUNT - 1, slotIndex));
  const startMinutes = safeSlot * SLOT_MINUTES;
  const endMinutes = (startMinutes + SLOT_MINUTES) % (24 * 60);
  const startHour = Math.floor(startMinutes / 60);
  const startMinute = startMinutes % 60;
  const endHour = Math.floor(endMinutes / 60);
  const endMinute = endMinutes % 60;

  return `${pad(startHour)}:${pad(startMinute)}-${pad(endHour)}:${pad(endMinute)}`;
}

export function shiftId(date: string, slotIndex: number): string {
  return `${date}:${slotIndex}`;
}

export function addDays(date: string, delta: number): string {
  const base = new Date(`${date}T00:00:00.000Z`);
  return formatDateUtc(new Date(base.getTime() + delta * DAY_MS));
}

export function getPreviousShift(
  date: string,
  slotIndex: number
): {
  date: string;
  slotIndex: number;
} {
  if (slotIndex > 0) {
    return { date, slotIndex: slotIndex - 1 };
  }

  return { date: addDays(date, -1), slotIndex: SLOT_COUNT - 1 };
}

export function getCurrentDateAndSlot(now: Date): {
  date: string;
  slotIndex: number;
} {
  return {
    date: formatDateUtc(now),
    slotIndex: getSlotIndexFromDate(now),
  };
}

export function getWeekKey(date: Date): string {
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7
  );
  return `${target.getUTCFullYear()}-${pad(week)}`;
}

export function allSlotIndexes(): number[] {
  return Array.from({ length: SLOT_COUNT }, (_, index) => index);
}
