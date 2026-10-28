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
