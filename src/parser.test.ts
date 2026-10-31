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

  it('ignores unmatched class bodies without swallowing later classes', () => {
    const parsed = parseTestSource(
      '/tmp/Broken.php',
      '<?php class BrokenTest { public function testA() {\nclass HealthyTest { public function testHealthy(): void {} }',
    );
    assert.deepEqual(parsed.classes.map((testClass) => testClass.methods.map((method) => method.name)), [['testHealthy']]);
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

  it('discovers test methods through imported and grouped attribute aliases', () => {
    const source = `<?php
namespace App\\Tests {
    use PHPUnit\\Framework\\Attributes\\Test as IsTest;
    use PHPUnit\\Framework\\Attributes\\{Test as GroupedTest};
    use PHPUnit\\Framework\\Attributes as FrameworkAttributes;

    class AliasedAttributeTest {
        #[IsTest]
        public function importedAlias(): void {}

        #[GroupedTest]
        public function groupedAlias(): void {}
    }

    class NamespaceAliasedAttributeTest {
        #[FrameworkAttributes\\Test]
        public function namespaceAlias(): void {}
    }
}
`;

    const parsed = parseTestSource('/tmp/AliasedAttributeTest.php', source);
    assert.deepEqual(parsed.classes.map((testClass) => testClass.methods.map((method) => method.name)), [
      ['importedAlias', 'groupedAlias'],
      ['namespaceAlias'],
    ]);
  });

  it('reads literal PHPUnit TestDox labels without changing method identity', () => {
    const source = `<?php
namespace App\\Tests;
use PHPUnit\\Framework\\Attributes\\TestDox as ReadableName;

class TestDoxTest {
    #[ReadableName('A signed-in user can view settings')]
    public function testSettingsAreVisible(): void {}

    #[\\PHPUnit\\Framework\\Attributes\\TestDox('A user can view {section}')]
    public function testDynamicPlaceholder(): void {}

    #[ReadableName($dynamicLabel)]
    public function testDynamicLabel(): void {}
}
`;

    const methods = parseTestSource('/tmp/TestDoxTest.php', source).classes[0].methods;
    assert.deepEqual(methods.map(({ name, testDoxName }) => ({ name, testDoxName })), [
      { name: 'testSettingsAreVisible', testDoxName: 'A signed-in user can view settings' },
      { name: 'testDynamicPlaceholder', testDoxName: undefined },
      { name: 'testDynamicLabel', testDoxName: undefined },
    ]);
  });

  it('discovers literal repeated PHPUnit TestWith attributes as selectable data sets', () => {
    const source = `<?php
namespace App\\Tests;
use PHPUnit\\Framework\\Attributes\\TestWith as WithData;

final class AttributeDataTest {
    #[WithData([1, 2])]
    #[WithData(['name' => 'Ada', 'active' => true])]
    public function testAcceptsData(int|string $value): void {}
}
`;

    const methods = parseTestSource('/tmp/AttributeDataTest.php', source).classes[0].methods;
    assert.deepEqual(methods.map((method) => ({
      name: method.name,
      datasetName: method.phpunitDatasetName,
    })), [
      { name: 'testAcceptsData', datasetName: undefined },
      { name: '#0', datasetName: 'with data set #0' },
      { name: '#1', datasetName: 'with data set #1' },
    ]);
  });

  it('uses literal TestWith custom names for labels and PHPUnit case suffixes', () => {
    const source = `<?php
use PHPUnit\\Framework\\Attributes\\TestWith;

class NamedAttributeDataTest {
    #[TestWith([1, 2], 'positive pair')]
    #[TestWith([3, 4], "negative pair")]
    #[TestWith([0, 0])]
    #[TestWith([5, 6], 'pair "with quotes"')]
    public function testPairs(int $left, int $right): void {}
}
`;

    const methods = parseTestSource('/tmp/NamedAttributeDataTest.php', source).classes[0].methods;
    assert.deepEqual(methods.map(({ name, phpunitDatasetName }) => ({ name, phpunitDatasetName })), [
      { name: 'testPairs', phpunitDatasetName: undefined },
      { name: 'positive pair', phpunitDatasetName: 'with data set "positive pair"' },
      { name: 'negative pair', phpunitDatasetName: 'with data set "negative pair"' },
      { name: '#0', phpunitDatasetName: 'with data set #0' },
      { name: 'pair "with quotes"', phpunitDatasetName: 'with data set "pair "with quotes""' },
    ]);
  });

  it('skips empty or dynamic TestWith names and suppresses duplicate custom names', () => {
    const source = `<?php
use PHPUnit\\Framework\\Attributes\\TestWith;

class AmbiguousNamedAttributeDataTest {
    #[TestWith([1], 'duplicate')]
    #[TestWith([2], 'duplicate')]
    #[TestWith([3], '')]
    #[TestWith([4], $dynamicName)]
    #[TestWith([5], 'unique')]
    public function testNamedCases(int $value): void {}
}
`;

    const methods = parseTestSource('/tmp/AmbiguousNamedAttributeDataTest.php', source).classes[0].methods;
    assert.deepEqual(methods.map(({ name, phpunitDatasetName }) => ({ name, phpunitDatasetName })), [
      { name: 'testNamedCases', phpunitDatasetName: undefined },
      { name: 'unique', phpunitDatasetName: 'with data set "unique"' },
    ]);
  });

  it('discovers literal PHPUnit TestWithJson data sets with optional names', () => {
    const source = `<?php
use PHPUnit\\Framework\\Attributes\\TestWith;
use PHPUnit\\Framework\\Attributes\\TestWithJson as JsonData;

class JsonAttributeDataTest {
    #[JsonData('[1, "one"]')]
    #[JsonData('{"name":"Ada"}', 'named json')]
    #[TestWith([true])]
    public function testJsonData(mixed $value): void {}
}
`;

    const methods = parseTestSource('/tmp/JsonAttributeDataTest.php', source).classes[0].methods;
    assert.deepEqual(methods.map(({ name, phpunitDatasetName }) => ({ name, phpunitDatasetName })), [
      { name: 'testJsonData', phpunitDatasetName: undefined },
      { name: '#0', phpunitDatasetName: 'with data set #0' },
      { name: 'named json', phpunitDatasetName: 'with data set "named json"' },
      { name: '#1', phpunitDatasetName: 'with data set #1' },
    ]);
  });

  it('does not guess PHPUnit TestWithJson cases for dynamic, invalid, or non-array JSON data', () => {
    const source = `<?php
use PHPUnit\\Framework\\Attributes\\TestWithJson;

class DynamicJsonAttributeDataTest {
    #[TestWithJson($json)]
    public function testDynamicJson(mixed $value): void {}

    #[TestWithJson('{invalid json}')]
    public function testInvalidJson(mixed $value): void {}

    #[TestWithJson('"not an array"')]
    public function testScalarJson(mixed $value): void {}
}
`;

    const methods = parseTestSource('/tmp/DynamicJsonAttributeDataTest.php', source).classes[0].methods;
    assert.deepEqual(methods.map(({ name, phpunitDatasetName }) => ({ name, phpunitDatasetName })), [
      { name: 'testDynamicJson', phpunitDatasetName: undefined },
      { name: 'testInvalidJson', phpunitDatasetName: undefined },
      { name: 'testScalarJson', phpunitDatasetName: undefined },
    ]);
  });

  it('discovers TestWith through grouped namespace aliases and fully qualified attributes', () => {
    const source = `<?php
namespace App\\Tests {
    use PHPUnit\\Framework\\Attributes as PHPUnitAttributes;

    class NamespaceAliasDataTest {
        #[PHPUnitAttributes\\TestWith([true])]
        public function testNamespaceAlias(): void {}

        #[\\PHPUnit\\Framework\\Attributes\\TestWith(['literal'])]
        public function testFullyQualified(): void {}
    }
}
`;

    const methods = parseTestSource('/tmp/NamespaceAliasDataTest.php', source).classes[0].methods;
    assert.deepEqual(methods.map((method) => method.phpunitDatasetName), [
      undefined,
      'with data set #0',
      undefined,
      'with data set #0',
    ]);
  });

  it('does not guess TestWith datasets when any row is dynamic or ambiguous', () => {
    const source = `<?php
use PHPUnit\\Framework\\Attributes\\TestWith;

class DynamicAttributeDataTest {
    #[TestWith([1, 2])]
    #[TestWith($sharedData)]
    public function testDynamic(): void {}

    #[TestWith([...$values])]
    public function testSpread(): void {}

    #[TestWith([makeValue()])]
    public function testExpression(): void {}
}
`;

    const methods = parseTestSource('/tmp/DynamicAttributeDataTest.php', source).classes[0].methods;
    assert.deepEqual(methods.map((method) => method.name), ['testDynamic', 'testSpread', 'testExpression']);
    assert.ok(methods.every((method) => method.phpunitDatasetName === undefined));
  });

  it('does not interpret unrelated attributes as PHPUnit data sets', () => {
    const source = `<?php
use App\\Attributes\\TestWith;

class UnrelatedAttributeDataTest {
    #[TestWith([1, 2])]
    public function testUnrelated(): void {}
}
`;

    const methods = parseTestSource('/tmp/UnrelatedAttributeDataTest.php', source).classes[0].methods;
    assert.deepEqual(methods.map((method) => method.name), ['testUnrelated']);
  });

  it('recognizes PHP keywords regardless of case when discovering class tests and attribute aliases', () => {
    const source = `<?php
NAMESPACE App\\Tests;
USE PHPUnit\\Framework\\Attributes\\Test AS IsTest;

FINAL CLASS MixedCaseKeywordsTest {
    #[IsTest]
    PUBLIC FUNCTION explicitAttribute(): void {}

    PROTECTED FUNCTION testPrefixMethod(): void {}
}
`;

    const parsed = parseTestSource('/tmp/MixedCaseKeywordsTest.php', source);
    assert.equal(parsed.classes.length, 1);
    assert.equal(parsed.classes[0].fullyQualifiedName, 'App\\Tests\\MixedCaseKeywordsTest');
    assert.deepEqual(parsed.classes[0].methods.map((method) => method.name), [
      'explicitAttribute',
      'testPrefixMethod',
    ]);
  });

  it('discovers Pest tests and generator datasets when PHP keywords and method calls use uppercase', () => {
    const source = `<?php
TEST('uppercase Pest generator', static FUNCTION (): iterable {
    YIELD 'first' => ['one'];
    YIELD ['two'];
})->WITH(function (): iterable {
    YIELD 'named' => ['one'];
    YIELD ['two'];
});
`;

    const methods = parseTestSource('/tmp/UppercasePestTest.php', source).classes[0].methods;
    assert.deepEqual(methods.map((method) => method.pestTestName), [
      'uppercase Pest generator',
      'uppercase Pest generator with data set "named"',
      'uppercase Pest generator with data set #1',
    ]);
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

  it('keeps nested and sibling Pest describe paths while indexing tests in source order', () => {
    const source = `<?php
describe('outer', function () {
    test('first', fn () => true);
    describe('inner', function () {
        test('nested', fn () => true);
    });
});

describe('sibling', function () {
    test('last', fn () => true);
});
`;

    const methods = parseTestSource('/tmp/DescribePathsTest.php', source).classes.flatMap((testClass) => testClass.methods);
    assert.deepEqual(methods.map(({ name, pestDescribePath }) => [name, pestDescribePath]), [
      ['first', ['outer']],
      ['nested', ['outer', 'inner']],
      ['last', ['sibling']],
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

  it('resolves statically declared named Pest datasets into selectable cases', () => {
    const source = `<?php
dataset('accounts', [
    'admin' => ['role' => 'admin'],
    'member' => ['role' => 'member'],
]);
dataset('regions', [
    ['north', ['cities' => ['Oslo', 'Bergen']]],
    ['south', ['cities' => ['Rome', 'Naples']]],
]);

test('account access', fn ($account) => expect($account)->toBeArray())->with('accounts');
test('regional access', fn ($region) => expect($region)->toBeArray())->with('regions');
`;

    const methods = parseTestSource('/tmp/NamedDatasetsTest.php', source).classes[0].methods;
    assert.deepEqual(methods.map((method) => method.name), [
      'account access',
      'account access (with data set "admin")',
      'account access (with data set "member")',
      'regional access',
      'regional access (with data set #0)',
      'regional access (with data set #1)',
    ]);
  });

  it('does not guess named Pest cases when declarations or references are dynamic or ambiguous', () => {
    const source = `<?php
dataset('dynamic', getAccounts());
dataset('ambiguous', ['first' => ['value']]);
dataset('ambiguous', ['second' => ['value']]);

test('dynamic declaration', fn ($account) => null)->with('dynamic');
test('unknown declaration', fn ($account) => null)->with('external');
test('ambiguous declaration', fn ($account) => null)->with('ambiguous');
`;

    const methods = parseTestSource('/tmp/DynamicNamedDatasetsTest.php', source).classes[0].methods;
    assert.deepEqual(methods.map((method) => method.name), [
      'dynamic declaration',
      'unknown declaration',
      'ambiguous declaration',
    ]);
  });

  it('discovers named and positional Pest datasets yielded by inline generator closures', () => {
    const source = `<?php
test('named generator values', fn ($value) => expect($value)->not->toBeNull())
    ->with(function (): iterable {
        // This comment must not be mistaken for a yielded case.
        yield 'first' => ['one'];
        yield 'second' => ['two'];
    });

test('positional generator values', fn ($value) => expect($value)->not->toBeNull())
    ->with(static function () {
        yield ['one'];
        yield ['two'];
    });
`;

    const methods = parseTestSource('/tmp/GeneratorDatasetsTest.php', source).classes[0].methods;
    assert.deepEqual(methods.slice(1, 3).map((method) => method.pestTestName), [
      'named generator values with data set "first"',
      'named generator values with data set "second"',
    ]);
    assert.deepEqual(methods.slice(4).map((method) => method.pestTestName), [
      'positional generator values with data set #0',
      'positional generator values with data set #1',
    ]);
  });

  it('computes combinations when generator and array dataset dimensions are chained', () => {
    const source = `<?php
test('combined generator values', fn ($left, $right) => expect($left)->not->toBe($right))
    ->with(['first' => 'one', 'second' => 'two'])
    ->with(function () {
        yield 'x' => ['x'];
        yield 'y' => ['y'];
    });
`;

    const methods = parseTestSource('/tmp/ChainedGeneratorDatasetsTest.php', source).classes[0].methods;
    assert.deepEqual(methods.slice(1).map((method) => method.pestTestName), [
      'combined generator values with data set #0',
      'combined generator values with data set #1',
      'combined generator values with data set #2',
      'combined generator values with data set #3',
    ]);
  });

  it('does not enumerate generator datasets with dynamic values, keys, control flow, or malformed yields', () => {
    const source = `<?php
test('dynamic value', fn () => null)->with(function () use ($value) {
    yield 'dynamic' => $value;
});
test('dynamic key', fn () => null)->with(function () use ($key) {
    yield $key => ['value'];
});
test('interpolated key', fn () => null)->with(function () use ($key) {
    yield "\${key}" => ['value'];
});
test('conditional yield', fn () => null)->with(function () use ($enabled) {
    if ($enabled) { yield 'maybe' => ['value']; }
});
test('missing semicolon', fn () => null)->with(function () {
    yield 'malformed' => ['value']
});
`;

    const methods = parseTestSource('/tmp/DynamicGeneratorDatasetsTest.php', source).classes[0].methods;
    assert.deepEqual(methods.map((method) => method.name), [
      'dynamic value',
      'dynamic key',
      'interpolated key',
      'conditional yield',
      'missing semicolon',
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

  it('matches PHPUnit JUnit classnames that use dots for namespace separators', () => {
    assert.equal(
      classNamesMatch('App.Tests.Unit.Api.Model.Auth.AuthSuccessResponseTest', 'App\\Tests\\Unit\\Api\\Model\\Auth\\AuthSuccessResponseTest'),
      true,
    );
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
