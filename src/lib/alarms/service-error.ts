/** Error with an HTTP status, thrown by service functions and mapped by API routes. */
export class ServiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly details?: unknown) {
    super(message);
    this.name = "ServiceError";
  }
}
