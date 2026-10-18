import 'server-only';

export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_TRANSITION'
  | 'ACTION_IN_PROGRESS'
  | 'CONFIRMATION_MISMATCH'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  | 'ADAPTER_ERROR';

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function toHttpStatus(code: AppErrorCode): number {
  switch (code) {
    case 'UNAUTHENTICATED': return 401;
    case 'FORBIDDEN': return 403;
    case 'NOT_FOUND': return 404;
    case 'CONFLICT': return 409;
    case 'INVALID_TRANSITION': return 409;
    case 'ACTION_IN_PROGRESS': return 409;
    case 'CONFIRMATION_MISMATCH': return 422;
    case 'VALIDATION_ERROR': return 400;
    case 'RATE_LIMITED': return 429;
    case 'INTERNAL': return 500;
    case 'ADAPTER_ERROR': return 502;
    default: return 500;
  }
}

/** Convert any thrown value into a structured AppError */
export function normalizeError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof Error) {
    const code = 'code' in err && typeof err.code === 'string' ? err.code : undefined;
    switch (code) {
      case 'NOT_FOUND': return new AppError('NOT_FOUND', err.message);
      case 'CONFLICT': return new AppError('CONFLICT', err.message);
      case 'INVALID_TRANSITION': return new AppError('INVALID_TRANSITION', err.message);
      case 'ACTION_IN_PROGRESS': return new AppError('ACTION_IN_PROGRESS', err.message);
      case 'VALIDATION_ERROR': return new AppError('VALIDATION_ERROR', err.message);
      case 'FORBIDDEN': return new AppError('FORBIDDEN', err.message);
    }
    return new AppError('INTERNAL', 'An unexpected error occurred.');
  }
  return new AppError('INTERNAL', 'An unexpected error occurred.');
}

export function errorResponse(err: unknown, requestId: string): Response {
  const appErr = normalizeError(err);
  const status = appErr.httpStatus ?? toHttpStatus(appErr.code);
  const body: Record<string, unknown> = {
    error: {
      code: appErr.code,
      message: appErr.message,
      requestId,
      ...(appErr.details ? { details: appErr.details } : {}),
    },
  };
  return Response.json(body, { status });
}

export function newRequestId(): string {
  return `r_${Math.random().toString(36).slice(2, 12)}`;
}
