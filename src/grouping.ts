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

export async function runGroupsSequentially<K, T>(
  groups: Map<K, T[]>,
  shouldStop: () => boolean,
  runGroup: (key: K, items: T[]) => Promise<void>,
): Promise<void> {
  for (const [key, items] of groups) {
    if (shouldStop()) {
      return;
    }
    await runGroup(key, items);
  }
}
