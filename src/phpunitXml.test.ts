import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePhpUnitXml, resolveDiscoveryGlobs } from './phpunitXml';

const xml = `<?xml version="1.0"?>
<phpunit>
  <testsuites>
    <testsuite name="Unit">
      <directory suffix="Test.php">tests/Unit</directory>
      <exclude>tests/Unit/Legacy</exclude>
    </testsuite>
    <testsuite name="Integration">
      <directory>tests/Integration</directory>
      <file>tests/Smoke.php</file>
    </testsuite>
  </testsuites>
</phpunit>
`;

describe('parsePhpUnitXml', () => {
  it('reads suites, directories, files, and excludes', () => {
    const parsed = parsePhpUnitXml(xml);
    assert.equal(parsed.suites.length, 2);
    assert.equal(parsed.suites[0].name, 'Unit');
    assert.deepEqual(parsed.suites[0].directories, [{ path: 'tests/Unit', suffix: 'Test.php' }]);
    assert.deepEqual(parsed.suites[0].excludes, ['tests/Unit/Legacy']);
    assert.deepEqual(parsed.suites[1].files, ['tests/Smoke.php']);
  });

  it('prefers xml directories over configured globs', () => {
    const globs = resolveDiscoveryGlobs({
      configuredIncludes: ['**/*Test.php'],
      configuredExcludes: ['**/vendor/**'],
      xmlText: xml,
    });
    assert.deepEqual(globs.includeGlobs, [
      'tests/Unit/**/*Test.php',
      'tests/Integration/**/*.php',
      'tests/Smoke.php',
    ]);
    assert.ok(globs.excludeGlobs.includes('**/vendor/**'));
    assert.ok(globs.excludeGlobs.includes('tests/Unit/Legacy/**'));
  });

  it('falls back to configured globs when xml has no suites', () => {
    const globs = resolveDiscoveryGlobs({
      configuredIncludes: ['**/*Test.php'],
      configuredExcludes: ['**/vendor/**'],
      xmlText: '<phpunit></phpunit>',
    });
    assert.deepEqual(globs.includeGlobs, ['**/*Test.php']);
  });
});
