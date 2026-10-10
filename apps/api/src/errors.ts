/** Error carrying an HTTP status and a stable machine-readable code. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const notFound = (what: string, id?: string): ApiError =>
  new ApiError(404, "not_found", id ? `${what} ${id} not found` : `${what} not found`);

export type ErrorBody = { error: { code: string; message: string } };

export const errorBody = (code: string, message: string): ErrorBody => ({
  error: { code, message },
});
