import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import type { QuickReply } from "@/types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireRole("agent");
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};

    if ("shortcut" in body && typeof body.shortcut === "string") {
      let s = body.shortcut.trim();
      if (!s.startsWith("/")) s = `/${s}`;
      updates.shortcut = s.toLowerCase();
    }

    if ("title" in body && typeof body.title === "string") {
      updates.title = body.title.trim();
    }

    if ("message" in body && typeof body.message === "string") {
      updates.message = body.message.trim();
    }

    if ("media_url" in body) {
      updates.media_url = body.media_url || null;
    }

    if ("media_type" in body) {
      const validMediaTypes = ["none", "image", "document", "audio", "video"];
      updates.media_type = validMediaTypes.includes(body.media_type)
        ? body.media_type
        : "none";
    }

    if ("media_filename" in body) {
      updates.media_filename = body.media_filename || null;
    }

    if ("auto_keywords" in body && Array.isArray(body.auto_keywords)) {
      updates.auto_keywords = body.auto_keywords
        .map((k: string) => String(k).trim().toLowerCase())
        .filter(Boolean);
    }

    if ("is_active" in body && typeof body.is_active === "boolean") {
      updates.is_active = body.is_active;
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await ctx.supabase
      .from("quick_replies")
      .update(updates)
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select()
      .maybeSingle();

    if (error) {
      console.error("[api/quick-replies/[id]] Update failed:", error);
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Another quick reply with this shortcut already exists." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Quick reply not found" }, { status: 404 });
    }

    return NextResponse.json({ quick_reply: data as QuickReply });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireRole("agent");

    const { error } = await ctx.supabase
      .from("quick_replies")
      .delete()
      .eq("id", id)
      .eq("account_id", ctx.accountId);

    if (error) {
      console.error("[api/quick-replies/[id]] Delete failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
