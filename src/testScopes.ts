/**
 * Expands selected test scopes only where exclusions require it, preserving
 * broader scopes everywhere else to avoid unnecessary individual executions.
 */
export function expandIncludedScopes<T>(
  roots: readonly T[],
  excludedRoots: readonly T[],
  getId: (item: T) => string,
  getChildren: (item: T) => readonly T[],
): T[] {
  if (excludedRoots.length === 0) {
    return [...roots];
  }

  const excludedIds = new Set<string>();
  const addExcludedSubtree = (item: T) => {
    excludedIds.add(getId(item));
    for (const child of getChildren(item)) {
      addExcludedSubtree(child);
    }
  };
  for (const excluded of excludedRoots) {
    addExcludedSubtree(excluded);
  }

  const visit = (item: T): { items: T[]; complete: boolean } => {
    if (excludedIds.has(getId(item))) {
      return { items: [], complete: false };
    }

    const children = getChildren(item);
    if (children.length === 0) {
      return { items: [item], complete: true };
    }

    const childResults = children.map(visit);
    if (childResults.every((result) => result.complete)) {
      return { items: [item], complete: true };
    }
    return { items: childResults.flatMap((result) => result.items), complete: false };
  };

  return roots.flatMap((root) => visit(root).items);
}
