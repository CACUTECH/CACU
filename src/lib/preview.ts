// CACU's preview business (26 November 2026): its members see every module in the menu, including those still held
// back for everyone else. A module held back later is added here, and the preview business sees it straight away.
export const HELD_BACK = ['/credit', '/hr', '/community', '/apps', '/storefront'] as const;

export function visibleNav<T extends { href: string }>(items: T[], preview: boolean): T[] {
  return preview ? items : items.filter(item => !(HELD_BACK as readonly string[]).includes(item.href));
}
