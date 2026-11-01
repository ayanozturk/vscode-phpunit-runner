import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import {
  aggregateMethodStatus,
  firstFailureLocation,
  groupCasesByMethod,
  parseJUnitXml,
  parseLocationFromMessage,
  readJUnitReport,
} from './junit';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="ExampleTest" tests="4">
    <testcase name="testItWorks" classname="App\\Tests\\ExampleTest" time="0.012" file="/tmp/ExampleTest.php" line="8"/>
    <testcase name="testItWorks with data set #0" classname="App\\Tests\\ExampleTest" time="0.001">
      <skipped/>
    </testcase>
    <testcase name="testFails" classname="App\\Tests\\ExampleTest" time="0.02" file="/tmp/ExampleTest.php" line="20">
      <failure type="PHPUnit\\Framework\\ExpectationFailedException">Failed asserting that false is true.
/tmp/ExampleTest.php:21
</failure>
    </testcase>
    <testcase name="testErrors" classname="App\\Tests\\ExampleTest" time="0.001">
      <error type="RuntimeException"><![CDATA[boom]]></error>
    </testcase>
  </testsuite>
</testsuites>
`;

describe('parseJUnitXml', () => {
  it('parses passed, skipped, failed, and errored cases', () => {
    const cases = parseJUnitXml(xml);
    assert.equal(cases.length, 4);
    assert.equal(cases[0].status, 'passed');
    assert.equal(cases[1].status, 'skipped');
    assert.equal(cases[2].status, 'failed');
    assert.match(cases[2].message, /Failed asserting/);
    assert.equal(cases[3].status, 'errored');
    assert.equal(cases[3].message, 'boom');
  });

  it('parses cases from nested suites without losing sibling results', () => {
    const cases = parseJUnitXml(`<testsuites>
      <testsuite name="Feature Suite">
        <testsuite name="Nested Feature Suite">
          <testcase name="testNestedPass" classname="App\\FeatureTest" time="0.01"/>
          <testcase name="testNestedSkip" class="App\\FeatureTest" time="0">
            <skipped message="requires optional service"/>
          </testcase>
        </testsuite>
        <testcase name="testSibling" classname="App\\FeatureTest" time="0.02"/>
      </testsuite>
    </testsuites>`);

    assert.deepEqual(cases.map(({ name, className, status, message }) => ({ name, className, status, message })), [
      { name: 'testNestedPass', className: 'App\\FeatureTest', status: 'passed', message: '' },
      { name: 'testNestedSkip', className: 'App\\FeatureTest', status: 'skipped', message: 'requires optional service' },
      { name: 'testSibling', className: 'App\\FeatureTest', status: 'passed', message: '' },
    ]);
  });

  it('returns an empty list for blank input', () => {
    assert.deepEqual(parseJUnitXml('   '), []);
  });

  it('groups data-set cases under the base method name', () => {
    const grouped = groupCasesByMethod(parseJUnitXml(xml));
    assert.equal(grouped.get('App\\Tests\\ExampleTest::testItWorks')?.length, 2);
  });

  it('aggregates mixed dataset outcomes as failed', () => {
    assert.equal(aggregateMethodStatus(parseJUnitXml(xml).slice(0, 3)), 'failed');
    assert.equal(aggregateMethodStatus(parseJUnitXml(xml).slice(0, 1)), 'passed');
  });

  it('extracts file locations from failure text', () => {
    const location = firstFailureLocation(parseJUnitXml(xml));
    assert.equal(location.file, '/tmp/ExampleTest.php');
    assert.equal(location.line, 21);
    assert.deepEqual(parseLocationFromMessage('no location here'), {});
  });

  it('extracts Unix and Windows file locations when paths contain spaces', () => {
    assert.deepEqual(
      parseLocationFromMessage('Failed in /workspace with spaces/tests/Example Test.php:42'),
      { file: '/workspace with spaces/tests/Example Test.php', line: 42 },
    );
    assert.deepEqual(
      parseLocationFromMessage('  C:\\Work Folder\\tests\\Example Test.php:17  '),
      { file: 'C:\\Work Folder\\tests\\Example Test.php', line: 17 },
    );
  });

  it('extracts source locations when the PHP file extension uses uppercase letters', () => {
    assert.deepEqual(parseLocationFromMessage('Assertion failed in /workspace/tests/LoginTest.PHP:42:8'), {
      file: '/workspace/tests/LoginTest.PHP',
      line: 42,
    });
  });

  it('extracts relative PHP paths from stack traces without matching path-like prose', () => {
    assert.deepEqual(parseLocationFromMessage('at tests/Feature/Login Test.php:42:17'), {
      file: 'tests/Feature/Login Test.php',
      line: 42,
    });
    assert.deepEqual(parseLocationFromMessage('tests\\Feature\\LoginTest.php(17): assertion failed'), {
      file: 'tests\\Feature\\LoginTest.php',
      line: 17,
    });
    assert.deepEqual(parseLocationFromMessage('Expected tests/Foo.php to exist, but it does not.'), {});
  });

  it('decodes xml entities in failure bodies', () => {
    const cases = parseJUnitXml(`<testcase name="t" classname="C"><failure>a &lt; b &amp; c</failure></testcase>`);
    assert.equal(cases[0].message, 'a < b & c');
  });

  it('parses quoted greater-than signs, single quotes, and numeric XML entities in attributes', () => {
    const cases = parseJUnitXml(`<testsuites><testcase time='0.25' name='test &#x3E; value' classname='C&amp;D' file='/tmp/a&gt;b.php'/></testsuites>`);
    assert.deepEqual(cases[0], {
      name: 'test > value',
      className: 'C&D',
      timeSeconds: 0.25,
      status: 'passed',
      message: '',
      file: '/tmp/a>b.php',
      line: undefined,
    });
  });

  it('normalizes negative or non-finite test durations to zero', () => {
    const cases = parseJUnitXml(`<testsuites>
      <testcase name="negative" classname="C" time="-1.25"/>
      <testcase name="not-a-number" classname="C" time="unknown"/>
      <testcase name="infinite" classname="C" time="Infinity"/>
      <testcase name="valid" classname="C" time="0.125"/>
    </testsuites>`);

    assert.deepEqual(cases.map((testCase) => testCase.timeSeconds), [0, 0, 0, 0.125]);
  });

  it('uses failure message attributes and preserves CDATA content', () => {
    const cases = parseJUnitXml(`<testsuite>
      <testcase name="attribute" classname="C"><failure message="assertion &gt; expectation"/></testcase>
      <testcase name="cdata" classname="C"><error><![CDATA[<broken> & raw]]></error></testcase>
    </testsuite>`);
    assert.equal(cases[0].message, 'assertion > expectation');
    assert.equal(cases[1].message, '<broken> & raw');
  });

  it('ignores XML comments while preserving entities and multiline traces', () => {
    const cases = parseJUnitXml(`<testsuites><!-- suite note -->
      <testcase name="trace" classname="C"><failure message="assertion &gt; expected">Assertion failed: a &lt; b.
<!-- framework comment should not appear -->
Stack trace:
#0 /workspace/tests/ExampleTest.php(14): Service-&gt;run()
#1 {main}</failure></testcase>
    </testsuites>`);

    assert.equal(cases[0].status, 'failed');
    assert.equal(cases[0].message, 'Assertion failed: a < b.\n\nStack trace:\n#0 /workspace/tests/ExampleTest.php(14): Service->run()\n#1 {main}');
    assert.deepEqual(firstFailureLocation(cases), {
      file: '/workspace/tests/ExampleTest.php',
      line: 14,
    });
  });

  it('ignores zero, negative, fractional, and missing source lines', () => {
    const cases = parseJUnitXml(`<testsuites>
      <testcase name="zero" classname="C" file="/tmp/zero.php" line="0"><failure>failure</failure></testcase>
      <testcase name="negative" classname="C" file="/tmp/negative.php" line="-1"><failure>failure</failure></testcase>
      <testcase name="fraction" classname="C" file="/tmp/fraction.php" line="1.5"><failure>failure</failure></testcase>
      <testcase name="missing" classname="C" file="/tmp/missing.php"><failure>failure</failure></testcase>
    </testsuites>`);

    assert.deepEqual(cases.map((testCase) => testCase.line), [undefined, undefined, undefined, undefined]);
    assert.deepEqual(cases.map((testCase) => firstFailureLocation([testCase])), [
      { file: '/tmp/zero.php', line: undefined },
      { file: '/tmp/negative.php', line: undefined },
      { file: '/tmp/fraction.php', line: undefined },
      { file: '/tmp/missing.php', line: undefined },
    ]);
    assert.deepEqual(parseLocationFromMessage('/tmp/zero.php:0'), {});
  });

  it('prefers runtime errors over assertion failures regardless of XML order', () => {
    const cases = parseJUnitXml(`<testsuites>
      <testcase name="assertion-first" classname="C"><failure>Assertion did not hold</failure><error>Runtime exception</error></testcase>
      <testcase name="runtime-first" classname="C"><error>Runtime exception</error><failure>Assertion did not hold</failure></testcase>
      <testcase name="skipped-then-failed" classname="C"><skipped/><failure>Assertion did not hold</failure></testcase>
    </testsuites>`);

    assert.deepEqual(cases.map(({ status, message }) => ({ status, message })), [
      { status: 'errored', message: 'Runtime exception' },
      { status: 'errored', message: 'Runtime exception' },
      { status: 'failed', message: 'Assertion did not hold' },
    ]);
  });

  it('keeps the first message when multiple results have the same priority', () => {
    const cases = parseJUnitXml(`<testsuite>
      <testcase name="duplicate-errors" classname="C">
        <error>First runtime error</error>
        <error>Second runtime error</error>
      </testcase>
    </testsuite>`);

    assert.deepEqual(
      { status: cases[0].status, message: cases[0].message },
      { status: 'errored', message: 'First runtime error' },
    );
  });

  it('rejects malformed comments and unknown XML entities', () => {
    assert.throws(() => parseJUnitXml('<testsuites><!-- unfinished</testsuites>'));
    assert.throws(() => parseJUnitXml('<testcase name="t" classname="C"><failure>bad &unknown; entity</failure></testcase>'));
  });

  it('rejects malformed XML instead of silently treating it as an empty report', () => {
    assert.throws(() => parseJUnitXml('<testsuite><testcase name="unfinished"></testsuite>'));
  });
});

describe('readJUnitReport', () => {
  it('distinguishes an unavailable report from a readable report with no cases', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit-runner-junit-'));
    try {
      const missing = await readJUnitReport(path.join(directory, 'missing.xml'));
      assert.deepEqual(missing, { cases: [], available: false });

      const emptyReportPath = path.join(directory, 'empty.xml');
      await fs.writeFile(emptyReportPath, '<testsuites/>', 'utf8');
      const empty = await readJUnitReport(emptyReportPath);
      assert.deepEqual(empty, { cases: [], available: true });

      const malformedPath = path.join(directory, 'malformed.xml');
      await fs.writeFile(malformedPath, '<testsuites><testcase></testsuites>', 'utf8');
      const malformed = await readJUnitReport(malformedPath);
      assert.equal(malformed.available, false);
      assert.deepEqual(malformed.cases, []);
      assert.match(malformed.warning ?? '', /malformed/);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
