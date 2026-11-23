import { describe, it, expect } from "vitest";
import {
  formatWhatsAppListTimestamp,
  formatWhatsAppHeaderStatus,
} from "./date-format";

describe("formatWhatsAppListTimestamp", () => {
  it("returns empty string on null or undefined", () => {
    expect(formatWhatsAppListTimestamp(null)).toBe("");
    expect(formatWhatsAppListTimestamp(undefined)).toBe("");
    expect(formatWhatsAppListTimestamp("invalid-date")).toBe("");
  });

  it("formats today's timestamp as h:mm a", () => {
    const today = new Date();
    today.setHours(14, 30, 0, 0);
    expect(formatWhatsAppListTimestamp(today.toISOString())).toBe("2:30 PM");

    const todayMorning = new Date();
    todayMorning.setHours(9, 15, 0, 0);
    expect(formatWhatsAppListTimestamp(todayMorning.toISOString())).toBe("9:15 AM");

    // Also formats Postgres timestamp with space
    const pgFormatted = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')} 14:30:00+00`;
    expect(formatWhatsAppListTimestamp(pgFormatted)).toBeTruthy();
  });

  it("formats yesterday's timestamp as 'Yesterday'", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(16, 0, 0, 0);
    expect(formatWhatsAppListTimestamp(yesterday.toISOString())).toBe("Yesterday");
  });

  it("formats 2-6 days ago as 'X days ago'", () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    expect(formatWhatsAppListTimestamp(twoDaysAgo.toISOString())).toBe("2 days ago");

    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    expect(formatWhatsAppListTimestamp(fiveDaysAgo.toISOString())).toBe("5 days ago");
  });

  it("formats 7+ days ago as 'dd/MM/yy'", () => {
    const tenDaysAgo = new Date(2026, 10, 10, 10, 0, 0); // Nov 10, 2026
    const res = formatWhatsAppListTimestamp(tenDaysAgo.toISOString());
    expect(res).toBe("10/11/26");
  });
});

describe("formatWhatsAppHeaderStatus", () => {
  it("returns empty string on null or undefined", () => {
    expect(formatWhatsAppHeaderStatus(null)).toBe("");
    expect(formatWhatsAppHeaderStatus(undefined)).toBe("");
    expect(formatWhatsAppHeaderStatus("invalid-date")).toBe("");
  });

  it("formats today as 'today at h:mm a'", () => {
    const today = new Date();
    today.setHours(10, 45, 0, 0);
    expect(formatWhatsAppHeaderStatus(today.toISOString())).toBe("today at 10:45 AM");
  });

  it("formats yesterday as 'yesterday at h:mm a'", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(15, 20, 0, 0);
    expect(formatWhatsAppHeaderStatus(yesterday.toISOString())).toBe("yesterday at 3:20 PM");
  });

  it("formats 2-6 days as 'X days ago'", () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    expect(formatWhatsAppHeaderStatus(threeDaysAgo.toISOString())).toBe("3 days ago");
  });
});
