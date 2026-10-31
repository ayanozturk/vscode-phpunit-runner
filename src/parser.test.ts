import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classNamesMatch, datasetSuffixFromTestCase, methodNameFromTestCase, parseTestSource } from './parser';

const fixture = `<?php
namespace App\\Tests;

final class ExampleTest
{
    public function testItWorks(): void
    {
        $this->assertTrue(true);
    }

    /**
     * @test
     */
    public function namedWithDocblock(): void
    {
    }

    #[Test]
    public function namedWithAttribute(): void
    {
    }

    #[PHPUnit\\Framework\\Attributes\\Test]
    public function namedWithNamespacedAttribute(): void
    {
    }

    #[Group('unit')]
    public function notATest(): void
    {
    }

    public function helper(): void
    {
        $braces = "{ still not a class {";
    }
}
`;

describe('parseTestSource', () => {
  it('discovers prefix, docblock, and Test attribute methods', () => {
    const parsed = parseTestSource('/tmp/ExampleTest.php', fixture);
    assert.equal(parsed.classes.length, 1);
    assert.equal(parsed.classes[0].fullyQualifiedName, 'App\\Tests\\ExampleTest');
    assert.deepEqual(
      parsed.classes[0].methods.map((method) => method.name),
      ['testItWorks', 'namedWithDocblock', 'namedWithAttribute', 'namedWithNamespacedAttribute'],
    );
  });

  it('ignores classes without tests and unmatched braces', () => {
    const parsed = parseTestSource('/tmp/None.php', '<?php class NotATest { public function helper() {} }');
    assert.equal(parsed.classes.length, 0);
  });

  it('skips abstract-looking bodies when the opening brace is unmatched', () => {
    const parsed = parseTestSource('/tmp/Broken.php', '<?php class BrokenTest { public function testA() {');
    assert.equal(parsed.classes.length, 0);
  });

  it('does not treat braces inside quotes as class scope', () => {
    const source = `<?php
class QuoteTest {
    public function testQuotes(): void {
        $value = '{';
    }
}
`;
    const parsed = parseTestSource('/tmp/QuoteTest.php', source);
    assert.equal(parsed.classes[0].methods.length, 1);
  });

  it('reads stacked attributes and groups, and skips abstract classes', () => {
    const source = `<?php
abstract class BaseTest {
    public function testInherited(): void {}
}

final class GroupedTest {
    #[Test]
    #[Group('unit')]
    public function fromAttributes(): void {}

    /**
     * @test
     * @group integration
     */
    public function fromDocblock(): void {}
}
`;
    const parsed = parseTestSource('/tmp/GroupedTest.php', source);
    assert.equal(parsed.classes.length, 1);
    assert.deepEqual(
      parsed.classes[0].methods.map((method) => ({ name: method.name, groups: method.groups })),
      [
        { name: 'fromAttributes', groups: ['unit'] },
        { name: 'fromDocblock', groups: ['integration'] },
      ],
    );
  });

  it('ignores declarations inside comments, strings, and heredoc bodies', () => {
    const source = `<?php
// class CommentPhantomTest { public function testGhost() {} }
$single = 'class SingleStringPhantomTest { public function testGhost() {} }';
$double = "class DoubleStringPhantomTest { public function testGhost() {} }";
$document = <<<'PHP'
class HeredocPhantomTest { public function testGhost() {} }
PHP;

class RealTest {
    public function testReal(): void {
        /* @test public function testPhantom() {} */
        $value = 'public function testAlsoPhantom() {}';
    }

    public function helperAfterComment(): void {}
}
`;

    const parsed = parseTestSource('/tmp/RealTest.php', source);
    assert.deepEqual(parsed.classes.map((testClass) => testClass.name), ['RealTest']);
    assert.deepEqual(parsed.classes[0].methods.map((method) => method.name), ['testReal']);
  });

  it('assigns fully qualified names in multiple bracketed namespaces', () => {
    const source = `<?php
namespace First\\Tests {
    class FirstTest { public function testFirst(): void {} }
}

namespace Second\\Tests {
    class SecondTest { public function testSecond(): void {} }
}
`;

    const parsed = parseTestSource('/tmp/NamespacedTests.php', source);
    assert.deepEqual(
      parsed.classes.map((testClass) => testClass.fullyQualifiedName),
      ['First\\Tests\\FirstTest', 'Second\\Tests\\SecondTest'],
    );
  });

  it('discovers literal Pest datasets as individually selectable cases', () => {
    const source = `<?php
it('adds values', function (int $value) {
    expect($value)->toBeGreaterThan(0);
})->with([1, 2]);
`;

    const parsed = parseTestSource('/tmp/ValuesTest.php', source);
    const methods = parsed.classes[0].methods;
    assert.deepEqual(methods.map((method) => method.name), [
      'adds values',
      'adds values (with data set #0)',
      'adds values (with data set #1)',
    ]);
    assert.deepEqual(methods.slice(1).map((method) => method.pestTestName), [
      'adds values with data set #0',
      'adds values with data set #1',
    ]);
    assert.deepEqual(methods.slice(1).map((method) => method.pestDatasetName), [
      'with data set #0',
      'with data set #1',
    ]);
  });

  it('uses Pest dataset keys and computes chained literal dataset combinations', () => {
    const source = `<?php
test('named values', fn ($value) => expect($value)->not->toBeNull())
    ->with(['first' => 'one', 'second' => 'two']);

test('combined values', fn ($left, $right) => expect($left)->not->toBe($right))
    ->with(['a' => 1, 'b' => 2])
    ->with(['x' => 'x', 'y' => 'y']);
`;

    const parsed = parseTestSource('/tmp/DatasetsTest.php', source);
    const methods = parsed.classes[0].methods;
    assert.deepEqual(methods.slice(1, 3).map((method) => method.pestTestName), [
      'named values with data set "first"',
      'named values with data set "second"',
    ]);
    assert.deepEqual(methods.slice(4).map((method) => method.pestTestName), [
      'combined values with data set #0',
      'combined values with data set #1',
      'combined values with data set #2',
      'combined values with data set #3',
    ]);
  });

  it('keeps dynamic datasets and malformed or spread entries as a single Pest case', () => {
    const source = `<?php
test('external set', fn ($value) => expect($value)->toBeTruthy())->with('external_values');
test('spread set', fn ($value) => expect($value)->toBeTruthy())->with([...$values]);
test('computed key', fn ($value) => expect($value)->toBeTruthy())->with([$key => 'value']);
`;

    const parsed = parseTestSource('/tmp/DynamicDatasetsTest.php', source);
    assert.deepEqual(parsed.classes[0].methods.map((method) => method.name), [
      'external set',
      'spread set',
      'computed key',
    ]);
  });
});

describe('classNamesMatch', () => {
  it('matches FQCN against a short PHPUnit classname', () => {
    assert.equal(classNamesMatch('App\\Tests\\ExampleTest', 'ExampleTest'), true);
    assert.equal(classNamesMatch('App\\Tests\\ExampleTest', 'App\\Tests\\ExampleTest'), true);
    assert.equal(classNamesMatch('App\\Tests\\ExampleTest', 'OtherTest'), false);
  });
});

describe('methodNameFromTestCase', () => {
  it('strips PHPUnit data-set suffixes', () => {
    assert.equal(methodNameFromTestCase('testAdd with data set #0'), 'testAdd');
    assert.equal(methodNameFromTestCase('testAdd with data set "zeros"'), 'testAdd');
    assert.equal(methodNameFromTestCase('testAdd#0'), 'testAdd');
    assert.equal(methodNameFromTestCase('testAdd'), 'testAdd');
  });
});

describe('datasetSuffixFromTestCase', () => {
  it('returns positional and named data-set suffixes', () => {
    assert.equal(datasetSuffixFromTestCase('testAdd with data set #0', 'testAdd'), 'with data set #0');
    assert.equal(datasetSuffixFromTestCase('testAdd with data set "zeros"', 'testAdd'), 'with data set "zeros"');
  });

  it('ignores case names that are not data sets of the requested method', () => {
    assert.equal(datasetSuffixFromTestCase('testAdd', 'testAdd'), undefined);
    assert.equal(datasetSuffixFromTestCase('testOther with data set #0', 'testAdd'), undefined);
  });
});
