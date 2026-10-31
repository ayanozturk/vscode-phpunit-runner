import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildGroupPickerOptions } from './groupPicker';

describe('buildGroupPickerOptions', () => {
  it('shows distinct method and workspace counts in stable group order', () => {
    const options = buildGroupPickerOptions([
      { group: 'integration', methodId: 'method-a', workspaceId: '/repo-a' },
      { group: 'unit', methodId: 'method-b', workspaceId: '/repo-a' },
      { group: 'integration', methodId: 'method-a', workspaceId: '/repo-a' },
      { group: 'integration', methodId: 'method-c', workspaceId: '/repo-b' },
      { group: 'unit', methodId: 'method-d', workspaceId: '/repo-b' },
    ]);

    assert.deepEqual(options, [
      { label: 'integration', description: '2 methods · 2 workspaces', groupName: 'integration' },
      { label: 'unit', description: '2 methods · 2 workspaces', groupName: 'unit' },
    ]);
  });

  it('deduplicates methods and counts distinct known workspaces', () => {
    const options = buildGroupPickerOptions([
      { group: 'fast', methodId: 'one' },
      { group: 'fast', methodId: 'one', workspaceId: '/workspace-a' },
      { group: 'fast', methodId: 'two', workspaceId: '/workspace-b' },
      { group: 'fast', methodId: 'orphan' },
    ]);

    assert.deepEqual(options, [
      { label: 'fast', description: '3 methods · 2 workspaces', groupName: 'fast' },
    ]);
  });

  it('preserves single-item singular labels', () => {
    assert.deepEqual(buildGroupPickerOptions([
      { group: 'smoke', methodId: 'test', workspaceId: '/workspace' },
    ]), [
      { label: 'smoke', description: '1 method · 1 workspace', groupName: 'smoke' },
    ]);
  });
});
