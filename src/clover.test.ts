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

  it('returns nothing for empty input', () => {
    assert.deepEqual(parseCloverXml(''), []);
  });
});
