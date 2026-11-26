// CACU's preview business (26 November 2026): its members see every module in the menu, including those still held
// back for everyone else. A module held back later is added here, and the preview business sees it straight away.
// Sub-menu entries are held back the same way (the income tax estimate, until a tax professional reviews it).
export const HELD_BACK = ['/credit', '/hr', '/community', '/apps', '/storefront', '/accounting/income-tax'] as const;

type Item = { href: string; children?: Item[] };

export function visibleNav<T extends Item>(items: T[], preview: boolean): T[] {
  if (preview) return items;
  const shown = (item: Item) => !(HELD_BACK as readonly string[]).includes(item.href);
  return items.filter(shown).map(item => item.children ? { ...item, children: item.children.filter(shown) } : item);
}
