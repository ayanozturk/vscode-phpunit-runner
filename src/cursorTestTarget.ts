/** Returns the deepest matching item, preserving child order when ranges overlap. */
export function findNarrowestContainingItem<T, Position>(
  item: T,
  position: Position,
  getChildren: (item: T) => readonly T[],
  contains: (item: T, position: Position) => boolean,
): T | undefined {
  for (const child of getChildren(item)) {
    if (contains(child, position)) {
      const nested = findNarrowestContainingItem(child, position, getChildren, contains);
      return nested ?? child;
    }
  }

  return contains(item, position) ? item : undefined;
}
