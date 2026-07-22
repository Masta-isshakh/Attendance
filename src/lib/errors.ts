/**
 * Cognito and AppSync errors are precise but unreadable. Map the ones a real
 * user can actually hit onto translation keys; anything unmapped falls back to
 * a generic message rather than leaking an internal string to the UI.
 */
const COGNITO_MESSAGES: Record<string, string> = {
  NotAuthorizedException: 'errors.invalidCredentials',
  UserNotFoundException: 'errors.invalidCredentials',
  UserNotConfirmedException: 'errors.userNotConfirmed',
  PasswordResetRequiredException: 'errors.passwordResetRequired',
  CodeMismatchException: 'errors.codeMismatch',
  ExpiredCodeException: 'errors.codeExpired',
  LimitExceededException: 'errors.tooManyAttempts',
  TooManyRequestsException: 'errors.tooManyAttempts',
  TooManyFailedAttemptsException: 'errors.tooManyAttempts',
  InvalidPasswordException: 'errors.weakPassword',
  InvalidParameterException: 'errors.invalidInput',
  UsernameExistsException: 'errors.usernameTaken',
  UserLambdaValidationException: 'errors.invalidInput',
  NetworkError: 'errors.network',
};

export function toMessageKey(error: unknown): string {
  if (!error) return 'errors.generic';

  const name = (error as { name?: string }).name;
  if (name && COGNITO_MESSAGES[name]) return COGNITO_MESSAGES[name];

  const message = (error as { message?: string }).message ?? '';
  if (/network|fetch failed|Failed to fetch/i.test(message)) return 'errors.network';

  return 'errors.generic';
}

/**
 * Errors thrown deliberately by our own Lambdas already carry a user-facing
 * sentence, so surface those verbatim instead of flattening them to "generic".
 */
export function extractServerMessage(error: unknown): string | null {
  const errors = (error as { errors?: Array<{ message?: string }> }).errors;
  const first = errors?.[0]?.message ?? (error as { message?: string }).message;
  if (!first) return null;
  if (/GraphQL error|Network error|Unexpected/i.test(first)) return null;
  return first;
}
