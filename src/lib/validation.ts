const EMAIL_SHAPED = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const USERNAME_ALLOWED = /^[A-Za-z0-9._-]+$/;
const E164 = /^\+[1-9]\d{6,14}$/;

export type FieldError = string | null;

export function validateEmail(value: string): FieldError {
  const trimmed = value.trim();
  if (!trimmed) return 'validation.emailRequired';
  if (!EMAIL_SHAPED.test(trimmed)) return 'validation.emailInvalid';
  return null;
}

/**
 * With `aliasAttributes: ['email']` on the pool, Cognito refuses to create a
 * user whose username looks like an email address. Catching it here turns an
 * opaque server-side InvalidParameterException into an inline field error.
 */
export function validateUsername(value: string): FieldError {
  const trimmed = value.trim();
  if (!trimmed) return 'validation.usernameRequired';
  if (EMAIL_SHAPED.test(trimmed)) return 'validation.usernameLooksLikeEmail';
  if (!USERNAME_ALLOWED.test(trimmed)) return 'validation.usernameInvalidChars';
  return null;
}

/** Mirrors the Cognito password policy set in amplify/backend.ts. */
export function validatePassword(value: string): FieldError {
  if (!value) return 'validation.passwordRequired';
  if (value.length < 8) return 'validation.passwordTooShort';
  if (!/[A-Z]/.test(value)) return 'validation.passwordNeedsUpper';
  if (!/[a-z]/.test(value)) return 'validation.passwordNeedsLower';
  if (!/\d/.test(value)) return 'validation.passwordNeedsNumber';
  return null;
}

export function validatePasswordConfirmation(password: string, confirmation: string): FieldError {
  if (!confirmation) return 'validation.passwordRequired';
  if (password !== confirmation) return 'validation.passwordsDoNotMatch';
  return null;
}

export function validatePhone(value: string): FieldError {
  const trimmed = value.trim();
  if (!trimmed) return null; // optional
  if (!E164.test(trimmed)) return 'validation.phoneInvalid';
  return null;
}

export function validateRequired(value: string, key = 'validation.nameRequired'): FieldError {
  return value.trim() ? null : key;
}

/**
 * Generates a temporary password that always satisfies the pool policy, so the
 * admin never has to guess the rules.
 */
export function generateTemporaryPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;

  const pick = (source: string) => source[Math.floor(Math.random() * source.length)];

  const characters = [pick(upper), pick(lower), pick(digits), pick(digits)];
  for (let index = 0; index < 8; index += 1) characters.push(pick(all));

  // Fisher-Yates, so the guaranteed characters are not always in front.
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [characters[index], characters[swap]] = [characters[swap], characters[index]];
  }
  return characters.join('');
}
