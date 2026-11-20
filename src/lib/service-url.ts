import 'server-only';

// Outgoing requests to CACU's own services (the accounting API and the file service). Each request goes only to the
// configured service: the host comes from server configuration, never from the request, and every path segment that
// may carry user input (business, sale, booking and job ids, route names) must be a plain word or id. This rules out
// "..", "/", "%2F", "@" and absolute URLs, so a request can never be steered to another host or path (CodeQL
// js/request-forgery).
const SEGMENT = /^[A-Za-z0-9_-]{1,100}$/;

export class ServiceUrlError extends Error {
  constructor(message = 'Invalid service request') { super(message); this.name = 'ServiceUrlError'; }
}

/**
 * Builds the URL of a request to a configured service.
 * @param base the service's configured URL (from the environment)
 * @param segments path segments, each checked; joined with "/"
 * @param query optional query parameters, re-encoded
 * @param keepBasePath whether the path goes under the base URL's own path (otherwise it starts at the origin)
 */
export function serviceUrl(base: URL, segments: string[], query?: URLSearchParams | Record<string, string>, keepBasePath = false): URL {
  for (const segment of segments) if (!SEGMENT.test(segment)) throw new ServiceUrlError();
  const target = new URL(base.origin);
  const prefix = keepBasePath ? base.pathname.replace(/\/+$/, '') : '';
  target.pathname = `${prefix}/${segments.join('/')}`;
  if (query) target.search = new URLSearchParams(query).toString();
  if (target.origin !== base.origin) throw new ServiceUrlError();
  return target;
}

/**
 * Splits an API route such as "sales/<id>/refunds?day=2026-11-07" into checked segments and its query. Segments may
 * arrive percent-encoded by callers (encodeURIComponent on an id); they are decoded before the check, so an encoded
 * "/" or ".." is still refused.
 */
export function routeParts(route: string): { segments: string[]; query: URLSearchParams } {
  const mark = route.indexOf('?');
  const path = mark === -1 ? route : route.slice(0, mark);
  const query = new URLSearchParams(mark === -1 ? '' : route.slice(mark + 1));
  let segments: string[];
  try { segments = path.split('/').map(part => decodeURIComponent(part)); }
  catch { throw new ServiceUrlError(); }
  if (segments.some(segment => !SEGMENT.test(segment))) throw new ServiceUrlError();
  return { segments, query };
}
