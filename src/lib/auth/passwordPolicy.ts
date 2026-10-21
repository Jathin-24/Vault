/**
 * Server-side password policy. Enforced in /api/auth/signup BEFORE the user
 * exists, and in the seed script. Client-side checks are UX only — this is
 * the gate.
 *
 * Rules (documented in README):
 *   - 12..128 characters (long passwords required; 128 caps bcrypt input)
 *   - at least 3 of: lowercase, uppercase, digit, symbol
 *   - not the email local part, not a very common password, not a single
 *     repeated character
 */

const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "123456789012", "qwertyuiop12",
  "letmein12345", "welcome12345", "admin1234567", "trustvault123",
  "iloveyou1234", "changeme1234", "abcdefghij12", "abcd12345678",
]);

export interface PasswordCheck {
  ok: boolean;
  problems: string[];
}

export function checkPasswordStrength(
  password: string,
  email?: string
): PasswordCheck {
  const problems: string[] = [];

  if (password.length < 12) {
    problems.push("Password must be at least 12 characters.");
  }
  if (password.length > 128) {
    problems.push("Password must be at most 128 characters.");
  }

  const classes =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/[0-9]/.test(password)) +
    Number(/[^A-Za-z0-9]/.test(password));
  if (classes < 3) {
    problems.push(
      "Password must mix at least three of: lowercase, uppercase, digits, symbols."
    );
  }

  if (/^(.)\1+$/.test(password)) {
    problems.push("Password cannot be a single repeated character.");
  }

  const lowered = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lowered)) {
    problems.push("Password is too common.");
  }

  if (email) {
    const local = email.split("@")[0]?.toLowerCase() ?? "";
    if (local.length >= 3 && lowered.includes(local)) {
      problems.push("Password must not contain your email address.");
    }
  }

  return { ok: problems.length === 0, problems };
}

/** Conservative email shape check (Supabase validates properly server-side too). */
export function isPlausibleEmail(email: string): boolean {
  return (
    email.length <= 254 &&
    /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(email) &&
    !email.includes("..")
  );
}
