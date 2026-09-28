/**
 * The auth form's state, outside `actions.ts` on purpose: a "use server" file
 * may only export async functions, and exporting this object from there made
 * Next refuse to load the module in production (E352) — /signup and /login
 * rendered the error boundary.
 */
export interface AuthFormState {
  status: "idle" | "sent" | "error";
  /** Shown to the user. Never carries a provider message — see actions.ts. */
  message: string;
  /** Echoed back so the "check your email" screen can name the address. */
  email: string;
}

export const initialAuthState: AuthFormState = {
  status: "idle",
  message: "",
  email: "",
};
