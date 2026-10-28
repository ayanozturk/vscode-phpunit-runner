import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { testCodeLensTargets } from './codeLens';
import { parseTestSource } from './parser';

describe('testCodeLensTargets', () => {
  it('creates stable targets for PHPUnit methods and Pest cases in source order', () => {
    const uri = 'file:///workspace/tests/ExampleTest.php';
    const parsed = parseTestSource('/workspace/tests/ExampleTest.php', `<?php
class ExampleTest {
    public function testClassCase(): void {}
}
test('a Pest case', function () {});
`);

    assert.deepEqual(testCodeLensTargets(uri, parsed), [
      { line: 2, itemId: `${uri}::ExampleTest::testClassCase` },
      { line: 4, itemId: `${uri}::Pest tests\\root::a Pest case` },
    ]);
  });
});
