// ============================================================
// /api/account/members/[userId]
//
//   PATCH  — change a member's role and/or feature permissions. Admin+.
//   DELETE — remove a member.          Admin+.
//
// Role changes delegate to set_member_role RPC (migration 018).
// Permission changes update `allowed_features` on `profiles`.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isAccountRole } from "@/lib/auth/roles";
import { supabaseAdmin } from "@/lib/automations/admin-client";

function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[members route] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to update member" },
    { status: 500 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as {
      role?: unknown;
      allowed_features?: string[] | null;
      allowedFeatures?: string[] | null;
    } | null;

    if (!body) {
      return NextResponse.json({ error: "Missing body" }, { status: 400 });
    }

    if (body.role !== undefined) {
      const role = body.role;
      if (!isAccountRole(role)) {
        return NextResponse.json(
          { error: "'role' must be one of owner, admin, agent, viewer" },
          { status: 400 },
        );
      }

      if (role === "owner") {
        return NextResponse.json(
          {
            error:
              "Use POST /api/account/transfer-ownership to promote a member to owner",
          },
          { status: 400 },
        );
      }

      const { error } = await ctx.supabase.rpc("set_member_role", {
        p_user_id: userId,
        p_new_role: role,
      });

      if (error) return rpcErrorToResponse(error);
    }

    if (body.allowed_features !== undefined || body.allowedFeatures !== undefined) {
      const features = body.allowed_features ?? body.allowedFeatures ?? null;
      const admin = supabaseAdmin();
      const { error: permError } = await admin
        .from("profiles")
        .update({ allowed_features: features })
        .eq("user_id", userId)
        .eq("account_id", ctx.accountId);

      if (permError) {
        console.error("[PATCH /api/account/members/[userId]] permissions error:", permError);
        return NextResponse.json(
          { error: "Failed to update member permissions" },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { userId } = await params;

    const { data, error } = await ctx.supabase.rpc("remove_account_member", {
      p_user_id: userId,
    });

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true, newPersonalAccountId: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
