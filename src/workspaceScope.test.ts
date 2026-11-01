import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { workspaceFoldersForItems } from './workspaceScope';

interface TestItem {
  uri?: string;
  children: TestItem[];
}

function item(uri?: string, ...children: TestItem[]): TestItem {
  return { uri, children };
}

describe('workspaceFoldersForItems', () => {
  const folderForUri = (uri: string): string | undefined => {
    if (uri === '/project-a' || uri.startsWith('/project-a/')) return 'project-a';
    if (uri === '/project-b' || uri.startsWith('/project-b/')) return 'project-b';
    return undefined;
  };

  it('uses an included item’s workspace without traversing its children', () => {
    assert.deepEqual(workspaceFoldersForItems(
      [item('/project-a', item('/project-b/test.php'))],
      (testItem) => testItem.uri,
      (testItem) => testItem.children,
      folderForUri,
    ), ['project-a']);
  });

  it('resolves folderless groups to descendant workspaces in tree order', () => {
    assert.deepEqual(workspaceFoldersForItems(
      [item(undefined, item('/project-b/SecondTest.php'), item('/outside/OtherTest.php')),
        item('/project-a/FirstTest.php')],
      (testItem) => testItem.uri,
      (testItem) => testItem.children,
      folderForUri,
    ), ['project-b', undefined, 'project-a']);
  });

  it('keeps an unscoped leaf as an undefined workspace result', () => {
    assert.deepEqual(workspaceFoldersForItems(
      [item()],
      (testItem) => testItem.uri,
      (testItem) => testItem.children,
      folderForUri,
    ), [undefined]);
  });
});
