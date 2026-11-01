import { aggregateMethodStatus } from './junit';
import {
  findIndexedDatasetCases,
  findIndexedMethodCases,
  findIndexedPestCases,
  type TestCaseIndex,
} from './resultIndex';
import type { JUnitStatus, JUnitTestCase, TestTarget } from './types';

export type MethodResultTarget = Pick<
  TestTarget,
  'kind' | 'className' | 'methodName' | 'datasetName' | 'pestTestName'
> & { filePath?: string };

export type MethodResultPlan = {
  cases: JUnitTestCase[];
  status: JUnitStatus;
  duration: number;
};

/** Resolves a discovered method-like item to its report cases and aggregate result. */
export function planMethodResult(index: TestCaseIndex, target: MethodResultTarget): MethodResultPlan {
  const { className, methodName, datasetName, pestTestName, filePath } = target;
  const cases = target.kind === 'dataset' && className && datasetName
    ? findIndexedDatasetCases(index, className, datasetName)
    : pestTestName && filePath
      ? findIndexedPestCases(index, pestTestName, filePath)
      : className && methodName
        ? findIndexedMethodCases(index, className, methodName)
        : [];

  return {
    cases,
    status: aggregateMethodStatus(cases),
    duration: Math.round(cases.reduce((sum, testCase) => sum + testCase.timeSeconds, 0) * 1000),
  };
}
