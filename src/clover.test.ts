import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCloverXml } from './clover';

const xml = `<?xml version="1.0"?>
<coverage>
  <project>
    <file name="/proj/src/Foo.php">
      <line num="10" type="stmt" count="2"/>
      <line num="11" type="stmt" count="0"/>
      <line num="12" type="method" name="bar" count="1"/>
      <metrics statements="2" coveredstatements="1"/>
    </file>
  </project>
</coverage>
`;

describe('parseCloverXml', () => {
  it('reads per-line statement counts', () => {
    const files = parseCloverXml(xml);
    assert.equal(files.length, 1);
    assert.equal(files[0].path, '/proj/src/Foo.php');
    assert.equal(files[0].statements, 2);
    assert.equal(files[0].coveredStatements, 1);
    assert.equal(files[0].lines[0].count, 2);
    assert.equal(files[0].lines[1].count, 0);
  });

  it('reads named method declarations, execution counts, and method metrics', () => {
    const [file] = parseCloverXml(`<coverage><file name="/proj/src/Methods.php">
      <class name="Example"><metrics methods="3" coveredmethods="2"/></class>
      <line num="10" type="method" count="4" signature="find(string $value): bool"/>
      <line num="22" type="method" name="reset" count="0"/>
      <line num="31" type="method" count="1" signature="invalid signature"/>
      <line num="11" type="stmt" count="1"/>
    </file></coverage>`);

    assert.deepEqual(file.declarations, [
      { name: 'find', line: 10, count: 4 },
      { name: 'reset', line: 22, count: 0 },
    ]);
    assert.equal(file.methods, 3);
    assert.equal(file.coveredMethods, 2);
    assert.deepEqual(file.lines[0], { line: 10, count: 4, type: 'method', declarationName: 'find' });
  });

  it('omits declarations without a supported name instead of guessing', () => {
    const [file] = parseCloverXml(`<coverage><file name="/proj/src/Anonymous.php">
      <line num="8" type="method" count="2" signature="not a callable"/>
    </file></coverage>`);

    assert.deepEqual(file.declarations, []);
    assert.equal(file.lines[0].declarationName, undefined);
  });

  it('returns nothing for empty input', () => {
    assert.deepEqual(parseCloverXml(''), []);
  });

  it('ignores Clover-shaped tags inside XML comments', () => {
    const files = parseCloverXml(`<coverage>
  <!-- <file name="/stale/Fake.php"><line num="99" type="stmt" count="1"/></file> -->
  <file name="/real/Current.php"><line num="4" type="stmt" count="0"/></file>
</coverage>`);

    assert.deepEqual(files.map((file) => file.path), ['/real/Current.php']);
    assert.deepEqual(files[0].lines, [{ line: 4, count: 0, type: 'stmt' }]);
  });

  it('decodes decimal and hexadecimal XML references in source paths', () => {
    const files = parseCloverXml(`<coverage>
      <file name="/proj/white&#x20;space/Quote&#39;Test.php"><line num="1" type="stmt" count="1"/></file>
    </coverage>`);

    assert.equal(files[0].path, "/proj/white space/Quote'Test.php");
  });

  it('keeps literal greater-than characters inside quoted file paths', () => {
    const files = parseCloverXml(`<coverage>
      <file name='/proj/first>second.php'>
        <line label='branch > operator' num='2' type='stmt' count='1'/>
        <metrics note='covered > total' statements='0' coveredstatements='0'/>
      </file>
    </coverage>`);

    assert.equal(files[0].path, '/proj/first>second.php');
    assert.deepEqual(files[0].lines, [{ line: 2, count: 1, type: 'stmt' }]);
    assert.equal(files[0].statements, 0);
    assert.equal(files[0].coveredStatements, 0);
  });

  it('uses only positive integer line numbers and nonnegative integer execution counts', () => {
    const files = parseCloverXml(`<coverage><file name="/proj/Numbers.php">
      <line num="1" type="stmt" count="1.5"/>
      <line num="2.5" type="stmt" count="2"/>
      <line num="0" type="stmt" count="1"/>
      <line num="3" type="stmt" count="-1"/>
      <line num="4" type="stmt"/>
    </file></coverage>`);

    assert.deepEqual(files[0].lines, [
      { line: 1, count: 0, type: 'stmt' },
      { line: 3, count: 0, type: 'stmt' },
      { line: 4, count: 0, type: 'stmt' },
    ]);
    assert.equal(files[0].statements, 3);
    assert.equal(files[0].coveredStatements, 0);
  });

  it('falls back to statement-line totals when metrics are absent or invalid', () => {
    const files = parseCloverXml(`<coverage>
      <file name="/proj/NoMetrics.php">
        <line num="1" type="stmt" count="1"/>
        <line num="2" type="stmt" count="0"/>
      </file>
      <file name="/proj/InvalidMetrics.php">
        <line num="1" type="stmt" count="2"/>
        <line num="2" type="stmt" count="0"/>
        <metrics statements="-1" coveredstatements="-2"/>
      </file>
    </coverage>`);

    assert.deepEqual(files.map(({ statements, coveredStatements }) => [statements, coveredStatements]), [
      [2, 1],
      [2, 1],
    ]);
  });

  it('preserves explicit zero metrics instead of deriving totals from line entries', () => {
    const [file] = parseCloverXml(`<coverage><file name="/proj/Empty.php">
      <line num="1" type="stmt" count="1"/>
      <metrics statements="0" coveredstatements="0"/>
    </file></coverage>`);

    assert.equal(file.statements, 0);
    assert.equal(file.coveredStatements, 0);
  });
});
