import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findSuiteForFile } from './suiteMatcher';
import type { PhpUnitSuite } from './phpunitXml';

describe('findSuiteForFile', () => {
  const suites: PhpUnitSuite[] = [
    {
      name: 'Unit',
      directories: [{ path: 'tests/Unit', prefix: 'Unit', suffix: 'Test.php' }],
      files: ['tests/Smoke.php'],
      excludes: ['tests/Unit/Legacy'],
    },
    {
      name: 'Feature',
      directories: [{ path: 'tests/Feature' }],
      files: [],
      excludes: [],
    },
  ];

  it('matches an explicit suite file and a directory test with prefix and suffix', () => {
    assert.equal(findSuiteForFile('/repo/tests/Smoke.php', '/repo', suites), 'Unit');
    assert.equal(findSuiteForFile('/repo/tests/Unit/UnitAccountTest.php', '/repo', suites), 'Unit');
  });

  it('does not match directory candidates that violate prefix or suffix', () => {
    assert.equal(findSuiteForFile('/repo/tests/Unit/AccountTest.php', '/repo', suites), undefined);
    assert.equal(findSuiteForFile('/repo/tests/Unit/UnitAccount.php', '/repo', suites), undefined);
  });

  it('honors exclusions and directory boundaries before selecting a suite', () => {
    assert.equal(findSuiteForFile('/repo/tests/Unit/Legacy/UnitOldTest.php', '/repo', suites), undefined);
    assert.equal(findSuiteForFile('/repo/tests/UnitSibling/UnitOldTest.php', '/repo', suites), undefined);
  });

  it('uses the first matching suite and defaults a missing suffix to PHP files', () => {
    assert.equal(findSuiteForFile('/repo/tests/Feature/CheckoutTest.php', '/repo', suites), 'Feature');
    assert.equal(findSuiteForFile('/repo/tests/Feature/README.md', '/repo', suites), undefined);
  });
});
