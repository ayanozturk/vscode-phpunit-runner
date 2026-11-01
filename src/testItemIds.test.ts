import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeFolderItemId, makeSuiteItemId, makeWorkspaceItemId } from './testItemIds';

describe('test item hierarchy ids', () => {
  const workspace = 'file:///project';

  it('keeps workspace roots stable and scoped to their URI', () => {
    assert.equal(makeWorkspaceItemId(workspace), 'workspace:file:///project');
    assert.notEqual(makeWorkspaceItemId(workspace), makeWorkspaceItemId('file:///other'));
  });

  it('scopes suite ids to both workspace and suite name', () => {
    assert.equal(makeSuiteItemId(workspace, 'unit'), 'suite:file:///project:unit');
    assert.notEqual(makeSuiteItemId(workspace, 'unit'), makeSuiteItemId('file:///other', 'unit'));
    assert.notEqual(makeSuiteItemId(workspace, 'unit'), makeSuiteItemId(workspace, 'feature'));
  });

  it('preserves folder path order and namespaces folders by suite when present', () => {
    assert.equal(makeFolderItemId(workspace, ['tests', 'Unit']), 'folder:file:///project:tests/Unit');
    assert.equal(makeFolderItemId(workspace, ['tests', 'Unit'], 'unit'), 'suite:file:///project:unit:tests/Unit');
    assert.notEqual(
      makeFolderItemId(workspace, ['tests', 'Unit'], 'unit'),
      makeFolderItemId(workspace, ['tests', 'Unit'], 'feature'),
    );
    assert.notEqual(makeFolderItemId(workspace, ['tests', 'Unit']), makeFolderItemId(workspace, ['Unit', 'tests']));
  });
});
