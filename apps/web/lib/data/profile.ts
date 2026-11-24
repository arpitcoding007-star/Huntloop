import "server-only";
import { resolveDataSource } from "./source";

/** The signed-in person's own name, kind of work and address. */
export async function getMyProfile(): Promise<{ fullName: string; role: string | null; email: string }> {
  const { db } = await resolveDataSource();
  const { data: auth } = db ? await db.auth.getUser() : { data: { user: null } };
  if (!db || !auth.user) return { fullName: "", role: null, email: "" };
  const { data, error } = await db.from("profiles").select("full_name, role").eq("id", auth.user.id).maybeSingle();
  if (error) throw new Error(`getMyProfile: ${error.message}`);
  return { fullName: String(data?.full_name ?? ""), role: data?.role ? String(data.role) : null, email: auth.user.email ?? "" };
}
