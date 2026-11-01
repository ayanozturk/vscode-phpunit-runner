/** Selects unique test-tree roots or file nodes affected by a saved source URI. */
export function continuousTargetsForUri<Item>(
  roots: readonly Item[],
  uri: string,
  getId: (item: Item) => string,
  getRootUri: (item: Item) => string | undefined,
  getFileItems: (root: Item) => readonly Item[],
  getFileUri: (item: Item) => string | undefined,
): Item[] {
  const targets = new Map<string, Item>();

  for (const root of roots) {
    if (getRootUri(root) === uri) {
      targets.set(getId(root), root);
      continue;
    }

    const matchingFile = getFileItems(root).find((file) => getFileUri(file) === uri);
    if (matchingFile) {
      targets.set(getId(matchingFile), matchingFile);
    }
  }

  return [...targets.values()];
}
