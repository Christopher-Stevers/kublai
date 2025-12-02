import { type DateRange } from "react-day-picker";

/**
 * Check if two dates are on the same calendar day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Check if a date is at the start of a day (00:00:00.000)
 */
export function isStartOfDay(date: Date): boolean {
  return (
    date.getHours() === 0 &&
    date.getMinutes() === 0 &&
    date.getSeconds() === 0 &&
    date.getMilliseconds() === 0
  );
}

/**
 * Get the start of a day (00:00:00.000)
 */
export function getStartOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Get the start of the day after the given date (00:00:00.000 of next day)
 * This creates exactly 24 hours when used with getStartOfDay
 */
export function getStartOfNextDay(date: Date): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + 1);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Check if a date range represents effectively a single day
 * (endDate is the start of the day immediately after startDate)
 */
export function isEffectivelySingleDay(startDate: Date, endDate: Date): boolean {
  const nextDayStart = getStartOfNextDay(startDate);
  return isSameDay(endDate, nextDayStart) && isStartOfDay(endDate);
}

/**
 * Normalize a date range for display (keeps single-day selections as same day)
 * This is used for calendar display to show only one day when user selects a single day
 */
export function normalizeDateRangeForDisplay(
  range: DateRange | undefined,
): DateRange | undefined {
  if (!range?.from) {
    return range;
  }

  const normalizedFrom = getStartOfDay(range.from);

  // If to is not set, return just the normalized from
  if (!range.to) {
    return {
      from: normalizedFrom,
      to: undefined,
    };
  }

  // For display, keep single-day selections as the same day
  // This prevents the calendar from showing two days
  if (isSameDay(range.from, range.to)) {
    return {
      from: normalizedFrom,
      to: normalizedFrom, // Keep as same day for display
    };
  }

  // For different days, ensure from is start of day and to is start of the selected end date
  return {
    from: normalizedFrom,
    to: getStartOfDay(range.to),
  };
}

/**
 * Normalize a date range for use in slots/pricing (ensures proper 24-hour boundaries)
 * - If from and to are the same calendar day, set from to start of day and to to start of next day (exactly 24 hours)
 * - If from and to are different days, ensure from is start of day and to is start of the day after the selected end date
 */
export function normalizeDateRangeForUse(
  range: DateRange | undefined,
): DateRange | undefined {
  if (!range?.from) {
    return range;
  }

  const normalizedFrom = getStartOfDay(range.from);

  // If to is not set, return just the normalized from
  if (!range.to) {
    return {
      from: normalizedFrom,
      to: undefined,
    };
  }

  // If from and to are the same calendar day, set to to start of next day (exactly 24 hours)
  if (isSameDay(range.from, range.to)) {
    return {
      from: normalizedFrom,
      to: getStartOfNextDay(range.from),
    };
  }

  // For different days, ensure from is start of day and to is start of the day after the selected end date
  return {
    from: normalizedFrom,
    to: getStartOfNextDay(range.to),
  };
}

/**
 * @deprecated Use normalizeDateRangeForDisplay or normalizeDateRangeForUse instead
 * Normalize a date range to ensure proper day boundaries
 */
export function normalizeDateRange(
  range: DateRange | undefined,
): DateRange | undefined {
  return normalizeDateRangeForDisplay(range);
}

/**
 * Format a date for display
 */
function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format a date range for display
 * Shows single date if effectively one day (endDate is start of next day after startDate)
 */
export function formatDateRange(
  startDate: Date | null,
  endDate: Date | null,
): string {
  if (!startDate) {
    return "N/A";
  }

  if (!endDate) {
    return formatDate(startDate);
  }

  // Check if this is effectively a single day (endDate is start of next day)
  if (isEffectivelySingleDay(startDate, endDate)) {
    return formatDate(startDate);
  }

  // Multi-day range
  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

