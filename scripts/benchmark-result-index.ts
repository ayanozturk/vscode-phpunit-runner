import { performance } from 'node:perf_hooks';
import {
  findIndexedMethodCases,
  findIndexedPestCases,
  indexTestCases,
} from '../src/resultIndex';
import type { JUnitTestCase } from '../src/types';

function benchmark(itemCount: number, iterations: number): void {
  const cases = Array.from({ length: itemCount }, (_, index): JUnitTestCase => {
    const file = Math.floor(index / 50);
    const className = `Benchmark\\Suite${String(file).padStart(4, '0')}\\GeneratedTest`;
    const methodName = `testCase${String(index % 50).padStart(2, '0')}`;
    return {
      name: methodName,
      className,
      timeSeconds: 0.001,
      status: 'passed',
      message: '',
      file: `/benchmark/tests/Suite${String(file).padStart(4, '0')}/GeneratedTest.php`,
    };
  });
  const collectGarbage = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  collectGarbage?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const buildStart = performance.now();
  const index = indexTestCases(cases, '/benchmark');
  const buildMs = performance.now() - buildStart;
  const methodQueries = cases.map((_, indexInCases) => {
    const file = Math.floor(indexInCases / 50);
    return {
      className: `Benchmark\\Suite${String(file).padStart(4, '0')}\\GeneratedTest`,
      methodName: `testCase${String(indexInCases % 50).padStart(2, '0')}`,
    };
  });
  const pestQueries = cases.map((_, indexInCases) => {
    const file = Math.floor(indexInCases / 50);
    return {
      testName: `testCase${String(indexInCases % 50).padStart(2, '0')}`,
      filePath: `/benchmark/tests/Suite${String(file).padStart(4, '0')}/GeneratedTest.php`,
    };
  });
  const methodDurations: number[] = [];
  const pestDurations: number[] = [];
  let matchedMethodCases = 0;
  let matchedPestCases = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let start = performance.now();
    for (const query of methodQueries) {
      matchedMethodCases += findIndexedMethodCases(index, query.className, query.methodName).length;
    }
    methodDurations.push(performance.now() - start);

    start = performance.now();
    for (const query of pestQueries) {
      matchedPestCases += findIndexedPestCases(index, query.testName, query.filePath).length;
    }
    pestDurations.push(performance.now() - start);
  }

  if (matchedMethodCases !== itemCount * iterations || matchedPestCases !== itemCount * iterations) {
    throw new Error(`Lookup benchmark mismatch: methods=${matchedMethodCases}, Pest=${matchedPestCases}`);
  }

  collectGarbage?.();
  const heapAfter = process.memoryUsage().heapUsed;
  console.log(JSON.stringify({
    cases: itemCount,
    indexBuildMs: round(buildMs, 1),
    methodLookupMsMedian: round(median(methodDurations), 1),
    pestLookupMsMedian: round(median(pestDurations), 1),
    iterations,
    heapDeltaMiB: round((heapAfter - heapBefore) / 1024 / 1024, 1),
    forcedGarbageCollection: Boolean(collectGarbage),
  }));
  benchmarkPestWithoutFileMetadata(itemCount, iterations);
}

/** Exercises the bounded trigram candidate index used for JUnit cases without file attributes. */
function benchmarkPestWithoutFileMetadata(itemCount: number, iterations: number): void {
  const cases = Array.from({ length: itemCount }, (_, index): JUnitTestCase => ({
    name: `Generated Pest behavior ${String(index).padStart(5, '0')} should stay discoverable`,
    className: 'Pest tests',
    timeSeconds: 0.001,
    status: 'passed',
    message: '',
  }));
  const buildStart = performance.now();
  const index = indexTestCases(cases, '/benchmark');
  const buildMs = performance.now() - buildStart;
  const queries = cases.map((testCase) => ({
    testName: testCase.name.split(' should stay discoverable')[0],
    filePath: '/benchmark/tests/GeneratedPestTest.php',
  }));
  const lookupDurations: number[] = [];
  let matchedCases = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const start = performance.now();
    for (const query of queries) {
      matchedCases += findIndexedPestCases(index, query.testName, query.filePath).length;
    }
    lookupDurations.push(performance.now() - start);
  }

  if (matchedCases !== itemCount * iterations) {
    throw new Error(`Expected ${itemCount * iterations} no-file Pest matches, found ${matchedCases}`);
  }

  console.log(JSON.stringify({
    casesWithoutFileMetadata: itemCount,
    trigramIndexBuildMs: round(buildMs, 1),
    pestLookupMsMedian: round(median(lookupDurations), 1),
    iterations,
    usesTrigramIndex: index.withoutFileByTrigram.size > 0,
  }));
  benchmarkPestInSingleFile(itemCount, iterations);
}

/** Exercises Pest lookups when many reported tests share one source file. */
function benchmarkPestInSingleFile(itemCount: number, iterations: number): void {
  const filePath = '/benchmark/tests/GeneratedPestTest.php';
  const cases = Array.from({ length: itemCount }, (_, index): JUnitTestCase => ({
    name: `Generated Pest behavior ${String(index).padStart(5, '0')} should stay discoverable`,
    className: 'Pest tests',
    timeSeconds: 0.001,
    status: 'passed',
    message: '',
    file: filePath,
  }));
  const buildStart = performance.now();
  const index = indexTestCases(cases, '/benchmark');
  const buildMs = performance.now() - buildStart;
  const queries = cases.map((testCase) => testCase.name.split(' should stay discoverable')[0]);
  const lookupDurations: number[] = [];
  let matchedCases = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const start = performance.now();
    for (const query of queries) {
      matchedCases += findIndexedPestCases(index, query, filePath).length;
    }
    lookupDurations.push(performance.now() - start);
  }

  if (matchedCases !== itemCount * iterations) {
    throw new Error(`Expected ${itemCount * iterations} single-file Pest matches, found ${matchedCases}`);
  }

  console.log(JSON.stringify({
    casesInSingleFile: itemCount,
    trigramIndexBuildMs: round(buildMs, 1),
    pestLookupMsMedian: round(median(lookupDurations), 1),
    iterations,
    usesFileTrigramIndex: index.byFilePestTrigram.has(filePath),
  }));
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

const argument = process.argv.find((value) => value.startsWith('--iterations='));
const iterations = argument ? Number(argument.slice('--iterations='.length)) : 3;
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) {
  throw new Error('--iterations must be an integer from 1 to 100');
}

console.log(`JUnit result index benchmark | Node ${process.version} | ${process.platform}/${process.arch}`);
for (const itemCount of [1_000, 10_000]) {
  benchmark(itemCount, iterations);
}
