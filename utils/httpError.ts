/**
 * Error subclass carrying an HTTP status code, thrown from usecases and
 * mapped straight through by middleware/errorHandler.ts (`err.statusCode || 500`).
 * Replaces the old ad-hoc `const error = new Error(...); error.statusCode = X;`
 * pattern with something TypeScript can type-check.
 */
export class HttpError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}
