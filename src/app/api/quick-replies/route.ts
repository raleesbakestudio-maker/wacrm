import { NextResponse } from "next/server";
import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import type { QuickReply } from "@/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase
      .from("quick_replies")
      .select("*")
      .eq("account_id", ctx.accountId)
      .order("shortcut", { ascending: true });

    if (error) {
      console.error("[api/quick-replies] Failed to list quick replies:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      { quick_replies: (data ?? []) as QuickReply[] },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    let { shortcut, title, message, media_url, media_type, media_filename, auto_keywords } = body;

    if (!shortcut || typeof shortcut !== "string" || !shortcut.trim()) {
      return NextResponse.json({ error: "shortcut is required" }, { status: 400 });
    }

    shortcut = shortcut.trim();
    if (!shortcut.startsWith("/")) {
      shortcut = `/${shortcut}`;
    }

    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const validMediaTypes = ["none", "image", "document", "audio", "video"];
    const resolvedMediaType = validMediaTypes.includes(media_type) ? media_type : "none";

    const { data, error } = await ctx.supabase
      .from("quick_replies")
      .insert({
        account_id: ctx.accountId,
        shortcut: shortcut.toLowerCase(),
        title: title.trim(),
        message: message.trim(),
        media_url: media_url || null,
        media_type: resolvedMediaType,
        media_filename: media_filename || null,
        auto_keywords: Array.isArray(auto_keywords)
          ? auto_keywords.map((k: string) => String(k).trim().toLowerCase()).filter(Boolean)
          : [],
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error("[api/quick-replies] Failed to create quick reply:", error);
      if (error.code === "23505") {
        return NextResponse.json(
          { error: `Shortcut "${shortcut}" already exists.` },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ quick_reply: data as QuickReply }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
