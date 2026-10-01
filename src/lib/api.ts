import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { ServiceError } from "@/lib/alarms/service";
import { formatZodError } from "@/lib/validation/match";

export function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ServiceError("Request body must be valid JSON.", 400, "invalid_json");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ServiceError(formatZodError(parsed.error), 422, "validation_error", parsed.error.issues);
  return parsed.data;
}

/** Wrap a route handler with consistent error responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ServiceError) return jsonError(err.status, err.code, err.message, err.details);
      if (err instanceof ZodError) return jsonError(422, "validation_error", formatZodError(err));
      console.error(err);
      return jsonError(500, "internal_error", "Unexpected server error.");
    }
  };
}
