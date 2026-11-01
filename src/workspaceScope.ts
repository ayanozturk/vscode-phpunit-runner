/** Resolve the workspace folders represented by included test items, preserving tree order. */
export function workspaceFoldersForItems<Item, Uri, Folder>(
  items: readonly Item[],
  uriForItem: (item: Item) => Uri | undefined,
  childrenForItem: (item: Item) => readonly Item[],
  folderForUri: (uri: Uri) => Folder | undefined,
): Array<Folder | undefined> {
  const folders: Array<Folder | undefined> = [];
  const pending = [...items].reverse();

  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) {
      continue;
    }

    const uri = uriForItem(item);
    const folder = uri === undefined ? undefined : folderForUri(uri);
    if (folder !== undefined) {
      folders.push(folder);
      continue;
    }

    const children = childrenForItem(item);
    if (children.length === 0) {
      folders.push(undefined);
      continue;
    }

    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }

  return folders;
}
