import { format, isToday, isYesterday, differenceInCalendarDays } from "date-fns";

/**
 * Formats a conversation's last-message timestamp in authentic WhatsApp list style:
 * - Today: "h:mm a" (e.g., "10:45 AM")
 * - Yesterday: "Yesterday"
 * - 2 to 6 days ago: "X days ago"
 * - 7+ days ago: "dd/MM/yy" (e.g., "21/11/26")
 */
/**
 * Safely parses any date string into a Date object, handling:
 * - Standard ISO 8601 ("2026-11-23T08:15:44.795Z")
 * - Postgres timestamptz with space ("2026-11-23 08:15:44.795+00")
 * - Postgres timestamptz with 2-digit timezone ("+00" -> "+00:00")
 */
export function parseFlexibleDate(dateStr?: string | null): Date | null {
  if (!dateStr) return null;
  const direct = new Date(dateStr);
  if (!isNaN(direct.getTime())) return direct;

  const normalized = dateStr
    .trim()
    .replace(" ", "T")
    .replace(/([+-]\d{2})$/, "$1:00");
  const parsed = new Date(normalized);
  if (!isNaN(parsed.getTime())) return parsed;

  return null;
}

/**
 * Formats a conversation's last-message timestamp in authentic WhatsApp list style:
 * - Today: "h:mm a" (e.g., "10:45 AM")
 * - Yesterday: "Yesterday"
 * - 2 to 6 days ago: "X days ago"
 * - 7+ days ago: "dd/MM/yy" (e.g., "21/11/26")
 */
export function formatWhatsAppListTimestamp(dateStr?: string | null): string {
  if (!dateStr) return "";
  try {
    const date = parseFlexibleDate(dateStr);
    if (!date) return "";

    if (isToday(date)) {
      return format(date, "h:mm a");
    }

    if (isYesterday(date)) {
      return "Yesterday";
    }

    const now = new Date();
    const diffDays = differenceInCalendarDays(now, date);

    if (diffDays <= 0) {
      // Future or slight clock skew today
      return format(date, "h:mm a");
    }

    if (diffDays === 1) {
      return "Yesterday";
    }

    if (diffDays >= 2 && diffDays <= 6) {
      return `${diffDays} days ago`;
    }

    return format(date, "dd/MM/yy");
  } catch {
    return "";
  }
}

/**
 * Formats a contact's last activity/message timestamp for the chat thread header:
 * - Today: "today at 10:45 AM"
 * - Yesterday: "yesterday at 10:45 AM"
 * - 2 to 6 days ago: "X days ago"
 * - 7+ days ago: "d MMM, h:mm a" (e.g., "21 Nov, 10:45 AM")
 */
export function formatWhatsAppHeaderStatus(dateStr?: string | null): string {
  if (!dateStr) return "";
  try {
    const date = parseFlexibleDate(dateStr);
    if (!date) return "";

    const timeStr = format(date, "h:mm a");

    if (isToday(date)) {
      return `today at ${timeStr}`;
    }

    if (isYesterday(date)) {
      return `yesterday at ${timeStr}`;
    }

    const now = new Date();
    const diffDays = differenceInCalendarDays(now, date);

    if (diffDays <= 0) {
      return `today at ${timeStr}`;
    }

    if (diffDays === 1) {
      return `yesterday at ${timeStr}`;
    }

    if (diffDays >= 2 && diffDays <= 6) {
      return `${diffDays} days ago`;
    }

    return format(date, "d MMM, h:mm a");
  } catch {
    return "";
  }
}
