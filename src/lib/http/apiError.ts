import { NextResponse } from "next/server";

/**
 * Uniform error responses. Deliberately generic: a 404 for "exists but not
 * yours" and for "never existed" — existence is information, and leaking it
 * (403 vs 404) tells an attacker which document IDs are real.
 */

export function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: "Authentication required." },
    { status: 401 }
  );
}

export function notFound(): NextResponse {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}

export function forbidden(): NextResponse {
  return NextResponse.json({ error: "Not permitted." }, { status: 403 });
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function tooManyRequests(message = "Too many requests. Try again shortly."): NextResponse {
  return NextResponse.json({ error: message }, { status: 429 });
}

export function serverError(): NextResponse {
  // Internal details never reach the client; they go to the server log.
  return NextResponse.json(
    { error: "Something went wrong." },
    { status: 500 }
  );
}

export function handleRouteError(err: unknown, context: string): NextResponse {
  console.error(`[api] ${context}:`, err);
  return serverError();
}
