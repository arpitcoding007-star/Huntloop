import "server-only";
import { resolveDataSource } from "./source";
import { isRenderableAvatar } from "../avatar";

/** The signed-in person's own name, kind of work, address and picture. */
export async function getMyProfile(): Promise<{ fullName: string; role: string | null; email: string; avatarUrl: string | null }> {
  const { db } = await resolveDataSource();
  const { data: auth } = db ? await db.auth.getUser() : { data: { user: null } };
  if (!db || !auth.user) return { fullName: "", role: null, email: "", avatarUrl: null };
  const { data, error } = await db.from("profiles").select("full_name, role, avatar_url").eq("id", auth.user.id).maybeSingle();
  if (error) throw new Error(`getMyProfile: ${error.message}`);
  const avatar = data?.avatar_url ? String(data.avatar_url) : null;
  return {
    fullName: String(data?.full_name ?? ""),
    role: data?.role ? String(data.role) : null,
    email: auth.user.email ?? "",
    avatarUrl: isRenderableAvatar(avatar) ? avatar : null,
  };
}
