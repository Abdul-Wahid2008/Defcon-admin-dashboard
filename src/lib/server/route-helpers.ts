import 'server-only';
import { newRequestId, errorResponse } from './errors';
import { requireUser, assertSameOrigin } from './auth';
import { sync } from './services/sync';

export { newRequestId, errorResponse, requireUser, assertSameOrigin, sync };

/** Standard JSON response with X-Request-Id header */
export function json(status: number, body: unknown, requestId: string): Response {
  return Response.json(body, {
    status,
    headers: { 'X-Request-Id': requestId },
  });
}
