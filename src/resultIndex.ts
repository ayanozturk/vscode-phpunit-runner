import * as path from 'path';
import { classNamesMatch, methodNameFromTestCase, normalizeClassName } from './parser';
import type { JUnitTestCase } from './types';

export type TestCaseIndex = {
  byClass: Map<string, Map<string, JUnitTestCase[]>>;
  byClassWithoutFile: Map<string, Map<string, JUnitTestCase[]>>;
  byFile: Map<string, JUnitTestCase[]>;
  withoutFile: JUnitTestCase[];
  classNameSuffixes: Map<string, string[]>;
  classNameOrder: Map<string, number>;
  withoutFileByTrigram: Map<string, JUnitTestCase[]>;
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

  const classNames = [...byClass.keys()];
  const classNameOrder = new Map(classNames.map((className, order) => [className, order]));
  const classNameSuffixes = new Map<string, string[]>();
  for (const className of classNames) {
    for (const suffix of classNameSuffixesFor(className)) {
      const aliases = classNameSuffixes.get(suffix) ?? [];
      aliases.push(className);
      classNameSuffixes.set(suffix, aliases);
    }
  }

  return {
    byClass,
    byClassWithoutFile,
    byFile,
    withoutFile,
    classNameSuffixes,
    classNameOrder,
    withoutFileByTrigram: buildPestTrigramIndex(withoutFile),
  };
}

export function findIndexedMethodCases(index: TestCaseIndex, className: string, methodName: string): JUnitTestCase[] {
  const result: JUnitTestCase[] = [];
  forEachByClass(index.byClass, index, className, (cases) => {
    result.push(...(cases.get(methodName) ?? []));
  });
  return result;
}

export function findIndexedDatasetCases(
  index: TestCaseIndex,
  className: string,
  datasetName: string,
): JUnitTestCase[] {
  const methodName = methodNameFromTestCase(datasetName);
  const result: JUnitTestCase[] = [];
  forEachByClass(index.byClass, index, className, (cases) => {
    for (const testCase of cases.get(methodName) ?? []) {
      if (testCase.name === datasetName) {
        result.push(testCase);
      }
    }
  });
  return result;
}

export function findIndexedPestCases(
  index: TestCaseIndex,
  testName: string,
  filePath: string,
): JUnitTestCase[] {
  const expectedPath = path.resolve(filePath);
  const fileCases = index.byFile.get(expectedPath) ?? [];
  const indexedCases = findPestTrigramCandidates(index.withoutFileByTrigram, testName);
  const casesWithoutFile = indexedCases ?? index.withoutFile;
  const result: JUnitTestCase[] = [];
  for (const testCase of fileCases) {
    if (testCase.name.includes(testName)) {
      result.push(testCase);
    }
  }
  for (const testCase of casesWithoutFile) {
    if (testCase.name.includes(testName)) {
      result.push(testCase);
    }
  }
  return result;
}

export function findIndexedFileCases(
  index: TestCaseIndex,
  filePath: string,
  classNames: Iterable<string>,
): JUnitTestCase[] {
  const result = [...(index.byFile.get(path.resolve(filePath)) ?? [])];
  const included = new Set(result);
  for (const className of classNames) {
    forEachByClass(index.byClassWithoutFile, index, className, (methods) => {
      for (const cases of methods.values()) {
        for (const testCase of cases) {
          if (!included.has(testCase)) {
            included.add(testCase);
            result.push(testCase);
          }
        }
      }
    });
  }
  return result;
}

function forEachByClass(
  source: Map<string, Map<string, JUnitTestCase[]>>,
  index: TestCaseIndex,
  requestedClassName: string,
  visit: (methods: Map<string, JUnitTestCase[]>) => void,
): void {
  const normalized = normalizeClassName(requestedClassName);
  const exact = source.get(normalized);
  if (exact) {
    visit(exact);
    return;
  }

  const candidates = new Set(index.classNameSuffixes.get(normalized) ?? []);
  for (const suffix of classNameSuffixesFor(normalized)) {
    if (source.has(suffix)) {
      candidates.add(suffix);
    }
  }
  const matchingClasses = [...candidates]
    .filter((className) => source.has(className) && classNamesMatch(className, normalized))
    .sort((left, right) => (index.classNameOrder.get(left) ?? 0) - (index.classNameOrder.get(right) ?? 0));

  for (const className of matchingClasses) {
    const methods = source.get(className);
    if (methods) {
      visit(methods);
    }
  }
}

function classNameSuffixesFor(className: string): string[] {
  const suffixes: string[] = [];
  for (let index = 0; index < className.length; index += 1) {
    if (className[index] === '\\') {
      suffixes.push(className.slice(index + 1));
    }
  }
  return suffixes;
}

const MIN_PEST_TRIGRAM_CASES = 128;
const MAX_PEST_TRIGRAM_KEYS = 512;
const MAX_PEST_TRIGRAM_POSTINGS = 256;

type RankedTrigram = { value: string; hash: number };

function buildPestTrigramIndex(cases: JUnitTestCase[]): Map<string, JUnitTestCase[]> {
  if (cases.length < MIN_PEST_TRIGRAM_CASES) {
    return new Map();
  }

  const selected = new Map<string, number>();
  const sampleHeap: RankedTrigram[] = [];
  for (const testCase of cases) {
    forEachTrigram(testCase.name, (trigram) => {
      if (selected.has(trigram)) {
        return;
      }

      const candidate = { value: trigram, hash: hashTrigram(trigram) };
      if (sampleHeap.length < MAX_PEST_TRIGRAM_KEYS) {
        selected.set(trigram, candidate.hash);
        pushMaxHeap(sampleHeap, candidate);
        return;
      }

      if (compareTrigrams(candidate, sampleHeap[0]) < 0) {
        const removed = popMaxHeap(sampleHeap);
        selected.delete(removed.value);
        selected.set(trigram, candidate.hash);
        pushMaxHeap(sampleHeap, candidate);
      }
    });
  }

  const index = new Map<string, JUnitTestCase[]>();
  const overfull = new Set<string>();
  for (const testCase of cases) {
    const seen = new Set<string>();
    forEachTrigram(testCase.name, (trigram) => {
      if (!selected.has(trigram) || seen.has(trigram) || overfull.has(trigram)) {
        return;
      }
      seen.add(trigram);

      const posting = index.get(trigram) ?? [];
      if (posting.length >= MAX_PEST_TRIGRAM_POSTINGS) {
        index.delete(trigram);
        overfull.add(trigram);
        return;
      }
      posting.push(testCase);
      index.set(trigram, posting);
    });
  }

  return index;
}

function findPestTrigramCandidates(
  index: Map<string, JUnitTestCase[]>,
  testName: string,
): JUnitTestCase[] | undefined {
  if (testName.length < 3) {
    return undefined;
  }

  let rarest: JUnitTestCase[] | undefined;
  forEachTrigram(testName, (trigram) => {
    const candidates = index.get(trigram);
    if (candidates && (!rarest || candidates.length < rarest.length)) {
      rarest = candidates;
    }
  });
  return rarest;
}

function forEachTrigram(value: string, visit: (trigram: string) => void): void {
  for (let index = 0; index <= value.length - 3; index += 1) {
    visit(value.slice(index, index + 3));
  }
}

function hashTrigram(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function compareTrigrams(left: RankedTrigram, right: RankedTrigram): number {
  return left.hash - right.hash || (left.value < right.value ? -1 : left.value > right.value ? 1 : 0);
}

function pushMaxHeap(heap: RankedTrigram[], value: RankedTrigram): void {
  let child = heap.push(value) - 1;
  while (child > 0) {
    const parent = Math.floor((child - 1) / 2);
    if (compareTrigrams(heap[parent], heap[child]) >= 0) {
      break;
    }
    [heap[parent], heap[child]] = [heap[child], heap[parent]];
    child = parent;
  }
}

function popMaxHeap(heap: RankedTrigram[]): RankedTrigram {
  const maximum = heap[0];
  const last = heap.pop();
  if (heap.length > 0 && last) {
    heap[0] = last;
    let parent = 0;
    while (true) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let largest = parent;
      if (left < heap.length && compareTrigrams(heap[left], heap[largest]) > 0) {
        largest = left;
      }
      if (right < heap.length && compareTrigrams(heap[right], heap[largest]) > 0) {
        largest = right;
      }
      if (largest === parent) {
        break;
      }
      [heap[parent], heap[largest]] = [heap[largest], heap[parent]];
      parent = largest;
    }
  }
  return maximum;
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
