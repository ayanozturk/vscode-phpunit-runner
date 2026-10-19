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

  it('uses failure message attributes and preserves CDATA content', () => {
    const cases = parseJUnitXml(`<testsuite>
      <testcase name="attribute" classname="C"><failure message="assertion &gt; expectation"/></testcase>
      <testcase name="cdata" classname="C"><error><![CDATA[<broken> & raw]]></error></testcase>
    </testsuite>`);
    assert.equal(cases[0].message, 'assertion > expectation');
    assert.equal(cases[1].message, '<broken> & raw');
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
