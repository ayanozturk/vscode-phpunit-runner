import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  expandPathMappings,
  joinQuoted,
  joinTemplateShellArgs,
  mapWithMappings,
  quoteShellArg,
  quoteTemplateShellArg,
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

  it('quotes template substitutions against shell expansion and embedded apostrophes', () => {
    assert.equal(quoteTemplateShellArg('$(touch /tmp/phpunit-runner) $HOME'), "'$(touch /tmp/phpunit-runner) $HOME'");
    assert.equal(quoteTemplateShellArg("can't"), "'can'\\''t'");
    assert.equal(joinTemplateShellArgs(['php', '/tmp/a path/$cash.php']), "php '/tmp/a path/$cash.php'");
  });
});
