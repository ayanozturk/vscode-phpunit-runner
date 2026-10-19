export type GroupedItems<K, T> = {
  groups: Map<K, T[]>;
  ungrouped: T[];
};

export function groupItemsBy<T, K>(items: T[], getKey: (item: T) => K | undefined): GroupedItems<K, T> {
  const groups = new Map<K, T[]>();
  const ungrouped: T[] = [];

  for (const item of items) {
    const key = getKey(item);
    if (key === undefined) {
      ungrouped.push(item);
      continue;
    }

    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  return { groups, ungrouped };
}
