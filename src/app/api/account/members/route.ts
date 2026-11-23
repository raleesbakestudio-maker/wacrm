// ============================================================
// /api/account/members
//
// GET:
//   Lists every member of the caller's account. Any member can call
//   it (the Members tab is shown to admins+, but agents/viewers see
//   a read-only roster too).
//
// POST:
//   Admin+. Directly creates a new staff member account without
//   requiring an invitation link. Sets email, password, role, and
//   allowed feature permissions immediately.
// ============================================================

import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { canManageMembers, isAccountRole } from "@/lib/auth/roles";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import type { AccountMember, AccountRole } from "@/types";

interface ProfileRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_role: string;
  allowed_features?: string[] | null;
  created_at: string;
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from("profiles")
      .select("user_id, full_name, email, avatar_url, account_role, allowed_features, created_at")
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[GET /api/account/members] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load members" },
        { status: 500 },
      );
    }

    const canSeeEmails = canManageMembers(ctx.role);

    const members: AccountMember[] = (data as ProfileRow[]).flatMap((row) => {
      if (!isAccountRole(row.account_role)) return [];
      return [
        {
          user_id: row.user_id,
          full_name: row.full_name ?? "",
          email: canSeeEmails ? row.email : null,
          avatar_url: row.avatar_url,
          role: row.account_role,
          allowed_features: row.allowed_features ?? null,
          joined_at: row.created_at,
        },
      ];
    });

    return NextResponse.json({ members });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();

    if (!canManageMembers(ctx.role)) {
      return NextResponse.json(
        { error: "Only admins and owners can add staff members" },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      fullName?: string;
      email?: string;
      password?: string;
      role?: AccountRole;
      allowedFeatures?: string[] | null;
    } | null;

    if (!body) {
      return NextResponse.json(
        { error: "Invalid request payload" },
        { status: 400 },
      );
    }

    const fullName = body.fullName?.trim() ?? "";
    const email = body.email?.trim().toLowerCase() ?? "";
    const password = body.password ?? "";
    const role = body.role ?? "agent";
    const allowedFeatures = Array.isArray(body.allowedFeatures)
      ? body.allowedFeatures
      : null;

    if (!fullName) {
      return NextResponse.json(
        { error: "Full name is required" },
        { status: 400 },
      );
    }

    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "A valid email address is required" },
        { status: 400 },
      );
    }

    if (!password || password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 },
      );
    }

    if (!isAccountRole(role) || role === "owner") {
      return NextResponse.json(
        { error: "Role must be admin, agent, or viewer" },
        { status: 400 },
      );
    }

    const admin = supabaseAdmin();

    // 1. Create the user in Supabase Auth directly with confirmed email
    const { data: userData, error: createError } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
        },
      });

    if (createError) {
      console.error("[POST /api/account/members] createUser error:", createError);
      return NextResponse.json(
        { error: createError.message || "Failed to create user account" },
        { status: 400 },
      );
    }

    const newUserId = userData.user.id;

    // 2. Attach profile to caller's account with the specified role & allowed_features
    const { error: profileError } = await admin
      .from("profiles")
      .update({
        account_id: ctx.accountId,
        account_role: role,
        allowed_features: allowedFeatures,
        full_name: fullName,
        email: email,
      })
      .eq("user_id", newUserId);

    if (profileError) {
      console.error("[POST /api/account/members] profile update error:", profileError);
    }

    // 3. Delete the temporary personal account created by the signup trigger for this user
    await admin.from("accounts").delete().eq("owner_user_id", newUserId);

    const createdMember: AccountMember = {
      user_id: newUserId,
      full_name: fullName,
      email: email,
      avatar_url: null,
      role,
      allowed_features: allowedFeatures,
      joined_at: new Date().toISOString(),
    };

    return NextResponse.json({
      success: true,
      member: createdMember,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
