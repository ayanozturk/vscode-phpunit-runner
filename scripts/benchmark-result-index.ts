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
  const methodDurations: number[] = [];
  const pestDurations: number[] = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let start = performance.now();
    for (let indexInCases = 0; indexInCases < itemCount; indexInCases += 1) {
      const file = Math.floor(indexInCases / 50);
      findIndexedMethodCases(
        index,
        `Benchmark\\Suite${String(file).padStart(4, '0')}\\GeneratedTest`,
        `testCase${String(indexInCases % 50).padStart(2, '0')}`,
      );
    }
    methodDurations.push(performance.now() - start);

    start = performance.now();
    for (let indexInCases = 0; indexInCases < itemCount; indexInCases += 1) {
      const file = Math.floor(indexInCases / 50);
      findIndexedPestCases(
        index,
        `testCase${String(indexInCases % 50).padStart(2, '0')}`,
        `/benchmark/tests/Suite${String(file).padStart(4, '0')}/GeneratedTest.php`,
      );
    }
    pestDurations.push(performance.now() - start);
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
  const lookupDurations: number[] = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const start = performance.now();
    for (let caseIndex = 0; caseIndex < itemCount; caseIndex += 1) {
      findIndexedPestCases(
        index,
        `Generated Pest behavior ${String(caseIndex).padStart(5, '0')}`,
        '/benchmark/tests/GeneratedPestTest.php',
      );
    }
    lookupDurations.push(performance.now() - start);
  }

  console.log(JSON.stringify({
    casesWithoutFileMetadata: itemCount,
    trigramIndexBuildMs: round(buildMs, 1),
    pestLookupMsMedian: round(median(lookupDurations), 1),
    iterations,
    usesTrigramIndex: index.withoutFileByTrigram.size > 0,
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
