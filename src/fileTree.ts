import type { TestItemKind } from './types';

/** Collects file nodes from a generic test item tree in child order. */
export function collectFileTreeItems<T>(
  item: T,
  getKind: (item: T) => TestItemKind | undefined,
  getChildren: (item: T) => readonly T[],
): T[] {
  if (getKind(item) === 'file') {
    return [item];
  }

  const files: T[] = [];
  for (const child of getChildren(item)) {
    files.push(...collectFileTreeItems(child, getKind, getChildren));
  }
  return files;
}
