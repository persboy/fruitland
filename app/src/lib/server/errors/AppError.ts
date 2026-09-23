/**
 * A domain/service function throws AppError for any expected failure
 * (validation, auth, not-found, conflict...). Route handlers catch it and
 * translate it directly into the apiError() envelope — see
 * app/src/lib/server/apiResponse.ts. An error that is NOT an AppError
 * reaching a route handler is a bug (unexpected), and must be logged +
 * returned as a generic 500 without leaking internals (MASTER-PROMPT.md §32).
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }

  static badRequest(message: string, code = "BAD_REQUEST"): AppError {
    return new AppError(400, code, message);
  }

  static unauthorized(message: string, code = "UNAUTHORIZED"): AppError {
    return new AppError(401, code, message);
  }

  static forbidden(message: string, code = "FORBIDDEN"): AppError {
    return new AppError(403, code, message);
  }

  static notFound(message: string, code = "NOT_FOUND"): AppError {
    return new AppError(404, code, message);
  }

  static conflict(message: string, code = "CONFLICT"): AppError {
    return new AppError(409, code, message);
  }

  static tooManyRequests(message: string, code = "TOO_MANY_REQUESTS"): AppError {
    return new AppError(429, code, message);
  }
}
