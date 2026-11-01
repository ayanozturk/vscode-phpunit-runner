import { performance } from 'node:perf_hooks';
import { parseTestSource } from '../src/parser';

type Scenario = {
  requestedItems: number;
  files: Array<{ path: string; source: string }>;
};

const methodsPerFile = 50;
const iterations = readIterations(process.argv.slice(2));

function readIterations(args: string[]): number {
  const argument = args.find((value) => value.startsWith('--iterations='));
  if (!argument) {
    return 3;
  }

  const value = Number(argument.slice('--iterations='.length));
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error('--iterations must be an integer from 1 to 100');
  }
  return value;
}

function makeScenario(itemCount: number): Scenario {
  const fileCount = Math.ceil(itemCount / methodsPerFile);
  const files = Array.from({ length: fileCount }, (_, fileIndex) => {
    const remaining = itemCount - fileIndex * methodsPerFile;
    const methodCount = Math.min(methodsPerFile, remaining);
    const suffix = String(fileIndex + 1).padStart(4, '0');
    const methods = Array.from({ length: methodCount }, (_, methodIndex) => {
      const methodSuffix = String(methodIndex + 1).padStart(3, '0');
      return [
        `    /** @group generated */`,
        `    public function testGeneratedCase${methodSuffix}(): void`,
        '    {',
        `        $value = ${fileIndex + methodIndex};`,
        '        self::assertSame($value, $value);',
        '    }',
      ].join('\n');
    });

    return {
      path: `/benchmark/tests/Generated${suffix}Test.php`,
      source: [
        '<?php',
        `namespace Benchmark\\Suite${suffix};`,
        '',
        `final class Generated${suffix}Test`,
        '{',
        methods.join('\n\n'),
        '}',
        '',
      ].join('\n'),
    };
  });

  return { requestedItems: itemCount, files };
}

function benchmark(scenario: Scenario): void {
  // Warm the parser before timing both sizes so startup costs do not skew the comparison.
  parseTestSource('/benchmark/WarmupTest.php', '<?php class WarmupTest { public function testWarmup(): void {} }');

  const durations: number[] = [];
  let parsedFiles = 0;
  let parsedItems = 0;
  let parsedBytes = 0;
  const collectGarbage = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  collectGarbage?.();
  const heapBefore = process.memoryUsage().heapUsed;
  let retainedResults: ReturnType<typeof parseTestSource>[] = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const start = performance.now();
    const results = scenario.files.map(({ path, source }) => parseTestSource(path, source));
    durations.push(performance.now() - start);

    parsedFiles = results.length;
    parsedItems = results.reduce(
      (count, parsed) => count + parsed.classes.reduce((classCount, testClass) => classCount + testClass.methods.length, 0),
      0,
    );
    parsedBytes = scenario.files.reduce((bytes, file) => bytes + Buffer.byteLength(file.source), 0);
    retainedResults = results;
  }

  collectGarbage?.();
  const heapAfter = process.memoryUsage().heapUsed;
  const averageMs = durations.reduce((total, value) => total + value, 0) / durations.length;
  const sorted = [...durations].sort((a, b) => a - b);
  const medianMs = sorted[Math.floor(sorted.length / 2)];
  const result = {
    requestedItems: scenario.requestedItems,
    parsedItems,
    files: parsedFiles,
    sourceKiB: round(parsedBytes / 1024, 1),
    iterations,
    averageMs: round(averageMs, 1),
    medianMs: round(medianMs, 1),
    heapDeltaMiB: round((heapAfter - heapBefore) / 1024 / 1024, 1),
    forcedGarbageCollection: Boolean(collectGarbage),
  };

  if (parsedItems !== scenario.requestedItems) {
    throw new Error(`Expected ${scenario.requestedItems} parsed tests, found ${parsedItems}`);
  }

  console.log(JSON.stringify(result));
  // Keep the final tree live until after memory is sampled.
  void retainedResults;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

console.log(`Discovery parser benchmark | Node ${process.version} | ${process.platform}/${process.arch}`);
console.log(`Each synthetic PHP file contains up to ${methodsPerFile} test methods; times are observational, not pass/fail thresholds.`);

for (const itemCount of [1_000, 10_000]) {
  benchmark(makeScenario(itemCount));
}
