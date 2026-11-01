import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectMethodTreeItems } from './methodTree';
import type { TestItemKind } from './types';

type Node = { name: string; kind: TestItemKind; children: Node[] };

describe('collectMethodTreeItems', () => {
  it('collects nested methods and data sets in source tree order', () => {
    const firstDataSet: Node = { name: 'first data set', kind: 'dataset', children: [] };
    const method: Node = { name: 'testInvoice', kind: 'method', children: [firstDataSet] };
    const pestTest: Node = { name: 'it creates an invoice', kind: 'method', children: [] };
    const file: Node = { name: 'InvoiceTest.php', kind: 'file', children: [method, pestTest] };

    assert.deepEqual(
      collectMethodTreeItems(file, (item) => item.kind, (item) => item.children).map((item) => item.name),
      ['testInvoice', 'first data set', 'it creates an invoice'],
    );
  });

  it('keeps a data set as the selected target without adding its descendants', () => {
    const nestedMethod: Node = { name: 'unexpected method', kind: 'method', children: [] };
    const dataSet: Node = { name: 'selected data set', kind: 'dataset', children: [nestedMethod] };

    assert.deepEqual(
      collectMethodTreeItems(dataSet, (item) => item.kind, (item) => item.children),
      [dataSet],
    );
  });
});
