import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  expandPathMappings,
  joinQuoted,
  mapWithMappings,
  quoteShellArg,
  substituteVariables,
  unmapWithMappings,
} from './commandTemplate';

describe('command templates', () => {
  it('substitutes longest variable names first', () => {
    const rendered = substituteVariables('${workspaceFolder}/tests ${workspaceFolderBasename}', {
      workspaceFolder: '/proj',
      workspaceFolderBasename: 'proj',
    });
    assert.equal(rendered, '/proj/tests proj');
  });

  it('maps and unmaps workspace paths', () => {
    const mappings = expandPathMappings(
      { '${workspaceFolder}': '/var/www/html' },
      { workspaceFolder: '/proj' },
    );
    assert.equal(mapWithMappings('/proj/tests/A.php', mappings), '/var/www/html/tests/A.php');
    assert.equal(unmapWithMappings('/var/www/html/tests/A.php', mappings), '/proj/tests/A.php');
    assert.equal(mapWithMappings('--filter', mappings), '--filter');
  });

  it('quotes arguments that contain filter metacharacters', () => {
    assert.equal(quoteShellArg('php'), 'php');
    assert.equal(quoteShellArg('^App\\Tests::testA$'), '"^App\\\\Tests::testA$"');
    assert.equal(joinQuoted(['--filter', '^A::b$']), '--filter "^A::b$"');
  });
});
