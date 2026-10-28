import type { ParsedTestFile } from './types';

export type TestCodeLensTarget = {
  line: number;
  itemId: string;
};

export function testCodeLensTargets(uri: string, parsed: ParsedTestFile): TestCodeLensTarget[] {
  return parsed.classes
    .flatMap((testClass) => {
      const classId = `${uri}::${testClass.fullyQualifiedName}`;
      return testClass.methods.map((method) => ({
        line: method.range.start.line,
        itemId: `${classId}::${method.name}`,
      }));
    })
    .sort((left, right) => left.line - right.line);
}
