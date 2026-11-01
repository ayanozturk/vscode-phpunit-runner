import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseComposerFrameworkInfo } from './composerMetadata';

describe('parseComposerFrameworkInfo', () => {
  it('reads a Pest declaration and locked PHPUnit and Pest versions', () => {
    const info = parseComposerFrameworkInfo(JSON.stringify({
      require: { 'pestphp/pest': '^3.0' },
      'require-dev': { 'phpunit/phpunit': '^11.0' },
    }), JSON.stringify({
      packages: [{ name: 'phpunit/phpunit', version: '11.5.0' }],
      'packages-dev': [{ name: 'pestphp/pest', version: '3.8.0' }],
    }));

    assert.equal(info.pestDeclared, true);
    assert.deepEqual([...info.versions], [
      ['phpunit/phpunit', '11.5.0'],
      ['pestphp/pest', '3.8.0'],
    ]);
  });

  it('parses either optional file independently when the other is invalid or missing', () => {
    const fromManifest = parseComposerFrameworkInfo('{"require-dev":{"pestphp/pest":"^5"}}', '{invalid');
    assert.equal(fromManifest.pestDeclared, true);
    assert.deepEqual([...fromManifest.versions], []);

    const fromLock = parseComposerFrameworkInfo('{invalid', '{"packages":[{"name":"phpunit/phpunit","version":"13.4.0"}]}');
    assert.equal(fromLock.pestDeclared, false);
    assert.deepEqual([...fromLock.versions], [['phpunit/phpunit', '13.4.0']]);

    assert.deepEqual(parseComposerFrameworkInfo(), { pestDeclared: false, versions: new Map() });
  });

  it('ignores unrelated packages and incomplete lock entries', () => {
    const info = parseComposerFrameworkInfo(undefined, JSON.stringify({
      packages: [
        { name: 'vendor/package', version: '1.2.3' },
        { name: 'pestphp/pest' },
      ],
      'packages-dev': [{ name: 'phpunit/phpunit', version: '13.4.0' }],
    }));

    assert.deepEqual([...info.versions], [['phpunit/phpunit', '13.4.0']]);
  });
});
