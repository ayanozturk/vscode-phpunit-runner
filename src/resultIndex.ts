import * as path from 'path';
import { classNamesMatch, methodNameFromTestCase, normalizeClassName } from './parser';
import type { JUnitTestCase } from './types';

export type TestCaseIndex = {
  byClass: Map<string, Map<string, JUnitTestCase[]>>;
  byClassWithoutFile: Map<string, Map<string, JUnitTestCase[]>>;
  byFile: Map<string, JUnitTestCase[]>;
  withoutFile: JUnitTestCase[];
  classNames: string[];
};

export function indexTestCases(cases: JUnitTestCase[], workspaceRoot?: string): TestCaseIndex {
  const byClass = new Map<string, Map<string, JUnitTestCase[]>>();
  const byClassWithoutFile = new Map<string, Map<string, JUnitTestCase[]>>();
  const byFile = new Map<string, JUnitTestCase[]>();
  const withoutFile: JUnitTestCase[] = [];

  for (const testCase of cases) {
    const className = normalizeClassName(testCase.className);
    const methodName = methodNameFromTestCase(testCase.name);
    addToNestedIndex(byClass, className, methodName, testCase);
    if (testCase.file) {
      const filePath = resolveReportPath(testCase.file, workspaceRoot);
      const fileCases = byFile.get(filePath) ?? [];
      fileCases.push(testCase);
      byFile.set(filePath, fileCases);
    } else {
      withoutFile.push(testCase);
      addToNestedIndex(byClassWithoutFile, className, methodName, testCase);
    }
  }

  return { byClass, byClassWithoutFile, byFile, withoutFile, classNames: [...byClass.keys()] };
}

export function findIndexedMethodCases(index: TestCaseIndex, className: string, methodName: string): JUnitTestCase[] {
  return findByClass(index.byClass, index, className, methodName).flat();
}

export function findIndexedDatasetCases(
  index: TestCaseIndex,
  className: string,
  datasetName: string,
): JUnitTestCase[] {
  return findByClass(index.byClass, index, className)
    .flatMap((cases) => cases.filter((testCase) => testCase.name === datasetName));
}

export function findIndexedPestCases(
  index: TestCaseIndex,
  testName: string,
  filePath: string,
): JUnitTestCase[] {
  const expectedPath = path.resolve(filePath);
  const candidates = [
    ...(index.byFile.get(expectedPath) ?? []),
    ...index.withoutFile,
  ];
  return candidates.filter((testCase) => testCase.name.includes(testName));
}

export function findIndexedFileCases(
  index: TestCaseIndex,
  filePath: string,
  classNames: Iterable<string>,
): JUnitTestCase[] {
  const result = [...(index.byFile.get(path.resolve(filePath)) ?? [])];
  const included = new Set(result);
  for (const className of classNames) {
    for (const cases of findByClass(index.byClassWithoutFile, index, className)) {
      for (const testCase of cases) {
        if (!included.has(testCase)) {
          included.add(testCase);
          result.push(testCase);
        }
      }
    }
  }
  return result;
}

function findByClass(
  source: Map<string, Map<string, JUnitTestCase[]>>,
  index: TestCaseIndex,
  requestedClassName: string,
  methodName?: string,
): JUnitTestCase[][] {
  const normalized = normalizeClassName(requestedClassName);
  const exact = source.get(normalized);
  if (exact) {
    const cases = methodName === undefined ? [...exact.values()] : [exact.get(methodName) ?? []];
    return cases.filter((items) => items.length > 0);
  }

  const result: JUnitTestCase[][] = [];
  for (const className of index.classNames) {
    if (!classNamesMatch(className, normalized)) {
      continue;
    }
    const methods = source.get(className);
    if (!methods) {
      continue;
    }
    const cases = methodName === undefined ? [...methods.values()] : [methods.get(methodName) ?? []];
    result.push(...cases.filter((items) => items.length > 0));
  }
  return result;
}

function addToNestedIndex(
  index: Map<string, Map<string, JUnitTestCase[]>>,
  className: string,
  methodName: string,
  testCase: JUnitTestCase,
): void {
  const byMethod = index.get(className) ?? new Map<string, JUnitTestCase[]>();
  const methodCases = byMethod.get(methodName) ?? [];
  methodCases.push(testCase);
  byMethod.set(methodName, methodCases);
  index.set(className, byMethod);
}

function resolveReportPath(filePath: string, workspaceRoot?: string): string {
  return path.resolve(path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot ?? process.cwd(), filePath));
}
