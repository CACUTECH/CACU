/** Validate untrusted Auth return destinations before client or server navigation. */
export function safeAuthReturn(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  const path = value.split(/[?#]/, 1)[0];
  if (/%(?:25|2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(path)) return fallback;
  try {
    const url = new URL(value, 'https://cacu.invalid');
    if (url.origin !== 'https://cacu.invalid' || url.pathname.startsWith('//')) return fallback;
    return url.pathname + url.search + url.hash;
  } catch { return fallback; }
}

export function invitationLoginPath(id: string | null): string {
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return '/login';
  return '/login?' + new URLSearchParams({ next: '/join?' + new URLSearchParams({ invitation: id }) });
}
