import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTestSource } from './parser';
import { parseRuntimeTestListing, reconcileRuntimeTestListing } from './runtimeDiscovery';

describe('parseRuntimeTestListing', () => {
  it('reads PHPUnit classes, methods, data sets, groups, and PHPT files', () => {
    const listing = parseRuntimeTestListing(`<?xml version="1.0"?>
<tests>
  <testCaseClass name="App\\Tests\\UserTest">
    <testCaseMethod name="testCanLogin" groups="auth fast" />
    <testCaseMethod name="testLogin" dataSet="#0" />
    <testCaseMethod name="testLogin" dataSet="valid &amp; active" />
    <testCaseMethod name="testLogin with data set &quot;runtime only&quot;" />
    <futureExtension><testCaseMethod name="testMustNotLeakFromUnknownShape" /></futureExtension>
    <testCaseFunction name="not-a-method" />
  </testCaseClass>
  <phptFile path="tests/legacy.phpt" />
</tests>`);

    assert.deepEqual(listing, {
      testCases: [
        {
          className: 'App\\Tests\\UserTest',
          caseName: 'testCanLogin',
          methodName: 'testCanLogin',
          groups: ['auth', 'fast'],
        },
        {
          className: 'App\\Tests\\UserTest',
          caseName: 'testLogin',
          methodName: 'testLogin',
          dataSetName: '#0',
          groups: [],
        },
        {
          className: 'App\\Tests\\UserTest',
          caseName: 'testLogin',
          methodName: 'testLogin',
          dataSetName: 'valid & active',
          groups: [],
        },
        {
          className: 'App\\Tests\\UserTest',
          caseName: 'testLogin with data set "runtime only"',
          methodName: 'testLogin',
          dataSetSuffix: 'with data set "runtime only"',
          groups: [],
        },
      ],
      phptFiles: [{ path: 'tests/legacy.phpt' }],
    });
  });

  it('accepts a valid empty listing and ignores unknown elements', () => {
    assert.deepEqual(parseRuntimeTestListing('<tests><futureExtension enabled="true" /></tests>'), {
      testCases: [],
      phptFiles: [],
    });
  });

  it('rejects unnamed methods and a listing with multiple root elements', () => {
    assert.throws(
      () => parseRuntimeTestListing('<tests><testCaseClass name="UserTest"><testCaseMethod /></testCaseClass></tests>'),
      /unnamed method.*UserTest/,
    );
    assert.throws(
      () => parseRuntimeTestListing('<tests /><tests />'),
      /XML|root|tag|closed|unexpected/i,
    );
  });

  it('rejects empty, malformed, and structurally invalid listings', () => {
    assert.throws(() => parseRuntimeTestListing(''));
    assert.throws(() => parseRuntimeTestListing('<wrong />'), /root element/);
    assert.deepEqual(
      parseRuntimeTestListing('<tests><testCaseMethod name="testMissingClass" /></tests>'),
      { testCases: [], phptFiles: [] },
      'unsupported nodes are ignored instead of being interpreted as PHPUnit class methods',
    );
    assert.throws(() => parseRuntimeTestListing('<tests><testCaseClass><testCaseMethod name="testMissingClassName" /></testCaseClass></tests>'), /class without a name/);
    assert.throws(() => parseRuntimeTestListing('<tests><testCaseClass name="Broken"><testCaseMethod name="testUnclosed"></testCaseClass>'), /XML|closed|unexpected/i);
  });
});

describe('reconcileRuntimeTestListing', () => {
  it('maps dynamic provider rows to their statically discovered source method', () => {
    const parsed = parseTestSource('/workspace/tests/UserTest.php', `<?php
namespace App\\Tests;
class UserTest {
    public function testCanLogin(): void {}
}
`);
    const listing = parseRuntimeTestListing(`<tests>
  <testCaseClass name="App\\Tests\\UserTest">
    <testCaseMethod name="testCanLogin" dataSet="runtime-only row" />
  </testCaseClass>
</tests>`);

    assert.deepEqual(reconcileRuntimeTestListing(listing, [parsed]), [{
      className: 'App\\Tests\\UserTest',
      caseName: 'testCanLogin',
      methodName: 'testCanLogin',
      dataSetName: 'runtime-only row',
      groups: [],
      filePath: '/workspace/tests/UserTest.php',
      identity: 'App\\Tests\\UserTest::testCanLogin with data set runtime-only row',
    }]);
  });

  it('normalizes PHPUnit class names and dataset suffixes when matching', () => {
    const parsed = parseTestSource('/workspace/tests/UserTest.php', `<?php
namespace App\\Tests;
class UserTest {
    public function testCanLogin(): void {}
}
`);
    const listing = parseRuntimeTestListing(`<tests>
  <testCaseClass name="App.Tests.UserTest">
    <testCaseMethod name="testCanLogin with data set &quot;blue&quot;" />
  </testCaseClass>
</tests>`);

    assert.deepEqual(listing.testCases[0], {
      className: 'App.Tests.UserTest',
      caseName: 'testCanLogin with data set "blue"',
      methodName: 'testCanLogin',
      dataSetSuffix: 'with data set "blue"',
      groups: [],
    });
    assert.deepEqual(reconcileRuntimeTestListing(listing, [parsed]), [{
      className: 'App.Tests.UserTest',
      caseName: 'testCanLogin with data set "blue"',
      methodName: 'testCanLogin',
      dataSetSuffix: 'with data set "blue"',
      groups: [],
      filePath: '/workspace/tests/UserTest.php',
      identity: 'App\\Tests\\UserTest::testCanLogin with data set "blue"',
    }]);
  });

  it('does not map a runtime class by short name when its namespace is unknown', () => {
    const parsed = parseTestSource('/workspace/tests/UserTest.php', `<?php
namespace App\Tests;
class UserTest { public function testCanLogin(): void {} }
`);
    const listing = parseRuntimeTestListing(`<tests>
  <testCaseClass name="Other\\Tests\\UserTest">
    <testCaseMethod name="testCanLogin" />
  </testCaseClass>
</tests>`);

    assert.deepEqual(reconcileRuntimeTestListing(listing, [parsed]), []);
  });

  it('does not guess a source file for unknown or ambiguous runtime entries', () => {
    const first = parseTestSource('/workspace/one/UserTest.php', `<?php
namespace App\\Tests;
class UserTest { public function testCanLogin(): void {} }
`);
    const second = parseTestSource('/workspace/two/UserTest.php', `<?php
namespace App\\Tests;
class UserTest { public function testCanLogin(): void {} }
`);
    const listing = parseRuntimeTestListing(`<tests>
  <testCaseClass name="App\\Tests\\UserTest">
    <testCaseMethod name="testCanLogin" />
    <testCaseMethod name="testDynamicOnly" />
  </testCaseClass>
</tests>`);

    assert.deepEqual(
      reconcileRuntimeTestListing(listing, [first]).map((testCase) => testCase.methodName),
      ['testCanLogin'],
      'known source methods are reconciled while dynamically unknown methods stay unmapped',
    );
    assert.deepEqual(reconcileRuntimeTestListing(listing, [first, second]), []);
  });
});
