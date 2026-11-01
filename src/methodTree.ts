import type { TestItemKind } from './types';

/** Collects method and data-set nodes from a generic test item tree. */
export function collectMethodTreeItems<T>(
  item: T,
  getKind: (item: T) => TestItemKind | undefined,
  getChildren: (item: T) => readonly T[],
): T[] {
  const kind = getKind(item);
  if (kind === 'dataset') {
    return [item];
  }

  const methods = kind === 'method' ? [item] : [];
  for (const child of getChildren(item)) {
    methods.push(...collectMethodTreeItems(child, getKind, getChildren));
  }
  return methods;
}
