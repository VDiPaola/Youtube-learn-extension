export type QuizErrorCode =
  | 'not-configured'
  | 'permission'
  | 'auth'
  | 'rate-limit'
  | 'overloaded'
  | 'network'
  | 'bad-request'
  | 'invalid-output'
  | 'refusal'
  | 'truncated'
  | 'transcript-too-short'
  | 'no-transcript'
  | 'no-activities'
  | 'unknown';

export class QuizError extends Error {
  constructor(
    readonly code: QuizErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'QuizError';
  }
}

export function toQuizError(error: unknown): QuizError {
  if (error instanceof QuizError) return error;
  if (error instanceof TypeError) {
    return new QuizError('network', `Could not reach the provider: ${error.message}`);
  }
  return new QuizError('unknown', error instanceof Error ? error.message : String(error));
}

/** Maps an HTTP status from any provider to a user-facing error. */
export function errorFromStatus(status: number, detail: string): QuizError {
  const suffix = detail ? ` (${detail})` : '';
  if (status === 401 || status === 403) {
    return new QuizError('auth', `The provider rejected the API key${suffix}.`);
  }
  if (status === 429) {
    return new QuizError('rate-limit', `Rate limit reached. Try again later${suffix}.`);
  }
  if (status === 529 || status === 503) {
    return new QuizError('overloaded', `The provider is overloaded. Try again shortly${suffix}.`);
  }
  if (status >= 400 && status < 500) {
    return new QuizError('bad-request', `The provider rejected the request${suffix}.`);
  }
  return new QuizError('unknown', `The provider returned HTTP ${status}${suffix}.`);
}
