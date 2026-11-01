import { performance } from 'node:perf_hooks';
import {
  findFlakyCandidates,
  getSlowestTests,
  type RunHistoryRun,
} from '../src/runHistory';

const iterations = readIterations(process.argv.slice(2));

function readIterations(args: string[]): number {
  const argument = args.find((value) => value.startsWith('--iterations='));
  if (!argument) {
    return 3;
  }

  const value = Number(argument.slice('--iterations='.length));
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw new Error('--iterations must be an integer from 1 to 50');
  }
  return value;
}

function makeHistory(testCount: number, runCount: number): RunHistoryRun[] {
  const testIds = Array.from({ length: testCount }, (_, index) => `workspace::ExampleTest::test${index}`);
  return Array.from({ length: runCount }, (_, runIndex) => {
    const completedAt = new Date(Date.UTC(2026, 0, 1, 0, runIndex)).toISOString();
    return {
      id: `run-${runIndex}`,
      completedAt,
      cases: testIds.map((testId, testIndex) => ({
        testId,
        label: `ExampleTest::test${testIndex}`,
        outcome: runIndex % 2 === 0 ? 'passed' as const : 'failed' as const,
        durationMs: (testIndex % 100) * 10 + runIndex,
        filePath: `/workspace/tests/ExampleTest${testIndex % 50}.php`,
        line: (testIndex % 200) + 1,
      })),
    };
  });
}

function benchmark(
  name: string,
  testCount: number,
  runCount: number,
  run: (history: readonly RunHistoryRun[]) => number,
  expectedCount: number,
): void {
  const history = makeHistory(testCount, runCount);
  const timings: number[] = [];
  const collectGarbage = (globalThis as typeof globalThis & { gc?: () => void }).gc;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    collectGarbage?.();
    const start = performance.now();
    const resultCount = run(history);
    timings.push(performance.now() - start);
    if (resultCount !== expectedCount) {
      throw new Error(`${name}: expected ${expectedCount} results, found ${resultCount}`);
    }
  }

  const sorted = [...timings].sort((left, right) => left - right);
  console.log(JSON.stringify({
    operation: name,
    testsPerRun: testCount,
    runs: runCount,
    cases: testCount * runCount,
    iterations,
    medianMs: round(sorted[Math.floor(sorted.length / 2)], 1),
  }));
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

console.log(`Run-history benchmark | Node ${process.version} | ${process.platform}/${process.arch}`);
console.log('Each timed operation asserts its expected result count; timings are observational, not pass/fail thresholds.');

for (const [testCount, runCount] of [[1_000, 20], [10_000, 100]] as const) {
  benchmark('slowest-tests', testCount, runCount, (history) => getSlowestTests(history).length, 10);
  benchmark('flaky-candidates', testCount, runCount, (history) => findFlakyCandidates(history).length, testCount);
}
