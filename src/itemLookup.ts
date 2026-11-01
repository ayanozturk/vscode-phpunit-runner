/** Finds an item in a tree using the extension's existing last-child-first traversal order. */
export function findTreeItemById<Item>(
  roots: readonly Item[],
  targetId: string,
  getId: (item: Item) => string,
  getChildren: (item: Item) => readonly Item[],
): Item | undefined {
  const pending = [...roots];
  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) {
      continue;
    }
    if (getId(item) === targetId) {
      return item;
    }
    pending.push(...getChildren(item));
  }
  return undefined;
}
