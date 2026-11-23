import { format, isToday, isYesterday, differenceInCalendarDays } from "date-fns";

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
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "";

    if (isToday(date)) {
      return format(date, "h:mm a");
    }

    if (isYesterday(date)) {
      return "Yesterday";
    }

    const now = new Date();
    const diffDays = differenceInCalendarDays(now, date);

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
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "";

    const timeStr = format(date, "h:mm a");

    if (isToday(date)) {
      return `today at ${timeStr}`;
    }

    if (isYesterday(date)) {
      return `yesterday at ${timeStr}`;
    }

    const now = new Date();
    const diffDays = differenceInCalendarDays(now, date);

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
