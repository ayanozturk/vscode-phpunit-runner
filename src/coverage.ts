import * as fs from 'fs/promises';
import { unmapWithMappings, type PathMapping } from './commandTemplate';
import { parseCloverXml } from './clover';

export type MappedCoverage = {
  path: string;
  statements: number;
  coveredStatements: number;
  details: Array<{ line: number; count: number }>;
};

export async function readCloverReport(reportPath: string, mappings: PathMapping[] = []): Promise<{
  files: MappedCoverage[];
  available: boolean;
  warning?: string;
}> {
  try {
    const xml = await fs.readFile(reportPath, 'utf8');
    return { files: mapCloverCoverage(xml, mappings), available: true };
  } catch (error) {
    return { files: [], available: false, warning: String(error) };
  }
}

export function mapCloverCoverage(xml: string, mappings: PathMapping[]): MappedCoverage[] {
  return parseCloverXml(xml).map((file) => ({
    path: unmapWithMappings(file.path, mappings),
    statements: file.statements,
    coveredStatements: file.coveredStatements,
    details: file.lines
      .filter((line) => line.type === 'stmt')
      .map((line) => ({ line: line.line, count: line.count })),
  }));
}
