import { datasetCasesForMethod } from './datasetCases';
import type { JUnitTestCase, TestTarget } from './types';

export type DatasetMethodContext<Uri> = Pick<TestTarget, 'filePath' | 'className' | 'methodName'> & {
  uri: Uri;
  groups?: string[];
};

export type PlannedDatasetItem<Uri> = {
  id: string;
  label: string;
  testCase: JUnitTestCase;
  data: DatasetMethodContext<Uri> & { kind: 'dataset'; datasetName: string };
};

export type DatasetItemPlan<Uri> = {
  items: PlannedDatasetItem<Uri>[];
  staleIds: string[];
};

/** Plans dataset child identities and metadata without mutating the VS Code test tree. */
export function planDatasetItems<Uri>(
  methodItemId: string,
  methodData: DatasetMethodContext<Uri>,
  cases: readonly JUnitTestCase[],
  existingDatasetIds: readonly string[],
): DatasetItemPlan<Uri> {
  const items = datasetCasesForMethod(methodData.methodName, cases).map(({ testCase, suffix }) => ({
    id: `${methodItemId}::dataset:${suffix}`,
    label: suffix.replace(/^with data set\s*/, ''),
    testCase,
    data: {
      kind: 'dataset' as const,
      uri: methodData.uri,
      filePath: methodData.filePath,
      className: methodData.className,
      methodName: methodData.methodName,
      datasetName: testCase.name,
      groups: methodData.groups,
    },
  }));
  const currentIds = new Set(items.map(({ id }) => id));

  return {
    items,
    staleIds: existingDatasetIds.filter((id) => !currentIds.has(id)),
  };
}
