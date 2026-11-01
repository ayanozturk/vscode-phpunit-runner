import { datasetSuffixFromTestCase } from './parser';
import type { JUnitTestCase } from './types';

export type DatasetCase = {
  testCase: JUnitTestCase;
  suffix: string;
};

/** Selects reported PHPUnit data-set cases for one method, preserving report order. */
export function datasetCasesForMethod(
  methodName: string | undefined,
  cases: readonly JUnitTestCase[],
): DatasetCase[] {
  if (!methodName) {
    return [];
  }

  return cases.flatMap((testCase) => {
    const suffix = datasetSuffixFromTestCase(testCase.name, methodName);
    return suffix ? [{ testCase, suffix }] : [];
  });
}
