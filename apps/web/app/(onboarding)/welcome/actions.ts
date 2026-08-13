"use server";

import { redirect } from "next/navigation";
import { resolveDataSource } from "../../../lib/data/source";
import { RESERVED_SLUGS, slugify } from "../../../lib/slug";
import { orgNameSchema } from "../../../lib/validation";

/**
 * Creates an organisation and makes the caller its owner.
 *
 * This replaces the hand-written SQL that SETUP.md used to ask for. It runs as
 * the *user's* session, not the service role, so the same RLS policies that
 * protect everything else apply here too — including the `has_org_role` write
 * check on `memberships`.
 */

export interface OrgFormState {
  error?: string;
  slug?: string;
}

export async function createOrganisation(
  _prev: OrgFormState,
  formData: FormData,
): Promise<OrgFormState> {
  // Parsed rather than coerced: a FormData entry is `string | File`, and
  // String(file) is "[object File]" — non-empty, slugifiable, and an org
  // nobody meant to create.
  const parsed = orgNameSchema.safeParse(formData.get("name"));
  if (!parsed.success) return { error: "Give your organisation a name." };
  const name = parsed.data;

  const slug = slugify(name);
  if (!slug) {
    return {
      error: "That name has no letters or numbers in it — try another.",
    };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { error: `“${slug}” is reserved. Try a different name.` };
  }

  const { db } = await resolveDataSource();

  // No database yet — let onboarding continue against demo data rather than
  // dead-ending. The banner inside the app already says the data isn't real,
  // and blocking here would make the whole flow unreviewable before the
  // migrations are applied. Returning the slug lets the form navigate on.
  if (!db) return { slug };

  const { data: user } = await db.auth.getUser();
  if (!user?.user) return { error: "Your session expired. Sign in again." };

  const { data: org, error: orgError } = await db
    .from("organizations")
    .insert({ name, slug })
    .select("id")
    .single();

  if (orgError) {
    // 23505 is unique_violation — the slug is taken. Said plainly, because the
    // user can act on it, unlike the raw constraint name.
    if (orgError.code === "23505") {
      return { error: `“${slug}” is already taken. Try a different name.` };
    }
    return { error: orgError.message };
  }

  const { error: memberError } = await db.from("memberships").insert({
    org_id: org.id,
    user_id: user.user.id,
    role: "owner",
  });

  if (memberError) {
    // The org exists but nobody can reach it — an orphan row that will also
    // hold its slug hostage. Clean it up rather than leaving the user stuck on
    // a name that now silently fails.
    await db.from("organizations").delete().eq("id", org.id);
    return { error: `Could not add you to the organisation: ${memberError.message}` };
  }

  redirect(`/welcome/product?org=${slug}`);
}
