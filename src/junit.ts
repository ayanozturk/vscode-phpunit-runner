import * as fs from 'fs/promises';
import * as sax from 'sax';
import type { JUnitStatus, JUnitTestCase } from './types';
import { methodNameFromTestCase, normalizeClassName } from './parser';

export function parseJUnitXml(xml: string): JUnitTestCase[] {
  if (!xml.trim()) {
    return [];
  }

  const cases: JUnitTestCase[] = [];
  let current: {
    attributes: Record<string, string>;
    status: JUnitStatus;
    message: string;
    activeResult?: 'skipped' | 'failure' | 'error';
    resultMessage: string;
    resultAttributeMessage: string;
  } | undefined;
  const parser = sax.parser(true, { trim: false, normalize: false });

  parser.onopentag = (tag) => {
    const name = tag.name.toLowerCase();
    if (name === 'testcase') {
      if (current) {
        throw new Error('JUnit testcase elements cannot be nested.');
      }
      current = {
        attributes: normalizeSaxAttributes(tag.attributes),
        status: 'passed',
        message: '',
        resultMessage: '',
        resultAttributeMessage: '',
      };
      return;
    }

    if (!current || (name !== 'skipped' && name !== 'failure' && name !== 'error')) {
      return;
    }

    const priority = { skipped: 1, failure: 2, error: 3 };
    if (!current.activeResult || priority[name] >= priority[current.activeResult]) {
      current.activeResult = name;
      current.status = name === 'failure' ? 'failed' : name === 'error' ? 'errored' : 'skipped';
      current.resultMessage = '';
      current.resultAttributeMessage = readSaxAttribute(normalizeSaxAttributes(tag.attributes), 'message');
    }
  };

  const appendText = (value: string) => {
    if (current?.activeResult) {
      current.resultMessage += value;
    }
  };
  parser.ontext = appendText;
  parser.oncdata = appendText;
  parser.onclosetag = (rawName) => {
    const name = rawName.toLowerCase();
    if (!current) {
      return;
    }
    if (name === current.activeResult) {
      current.message = current.resultMessage.trim() || current.resultAttributeMessage.trim();
      current.activeResult = undefined;
      return;
    }
    if (name !== 'testcase') {
      return;
    }
    cases.push(parseTestCase(current.attributes, current.status, current.message));
    current = undefined;
  };
  parser.onerror = (error) => {
    throw error;
  };
  parser.write(xml).close();
  if (current) {
    throw new Error('JUnit testcase element was not closed.');
  }

  return cases;
}

export async function readJUnitReport(reportPath: string): Promise<{
  cases: JUnitTestCase[];
  available: boolean;
  warning?: string;
}> {
  let xml: string;
  try {
    xml = await fs.readFile(reportPath, 'utf8');
  } catch {
    return { cases: [], available: false };
  }

  try {
    return { cases: parseJUnitXml(xml), available: true };
  } catch (error) {
    return {
      cases: [],
      available: false,
      warning: `JUnit report is malformed: ${String(error)}`,
    };
  }
}

export function aggregateMethodStatus(cases: JUnitTestCase[]): JUnitStatus {
  if (cases.some((item) => item.status === 'failed' || item.status === 'errored')) {
    return cases.some((item) => item.status === 'errored') ? 'errored' : 'failed';
  }

  if (cases.length > 0 && cases.every((item) => item.status === 'skipped')) {
    return 'skipped';
  }

  if (cases.some((item) => item.status === 'passed')) {
    return 'passed';
  }

  return 'skipped';
}

export function groupCasesByMethod(cases: JUnitTestCase[]): Map<string, JUnitTestCase[]> {
  const grouped = new Map<string, JUnitTestCase[]>();
  for (const item of cases) {
    const key = `${normalizeClassName(item.className)}::${methodNameFromTestCase(item.name)}`;
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  }
  return grouped;
}

export function firstFailureMessage(cases: JUnitTestCase[]): string {
  const failed = cases.find((item) => item.status === 'failed' || item.status === 'errored');
  return failed?.message || cases[0]?.message || '';
}

export function firstFailureLocation(cases: JUnitTestCase[]): { file?: string; line?: number } {
  const failed = cases.find((item) => item.status === 'failed' || item.status === 'errored');
  if (!failed) {
    return {};
  }

  const fromMessage = parseLocationFromMessage(failed.message);
  return {
    file: fromMessage.file ?? failed.file,
    line: fromMessage.line ?? failed.line,
  };
}

export function parseLocationFromMessage(message: string): { file?: string; line?: number } {
  const match = message.match(/([A-Za-z]:\\[^\s:]+?\.php|\/[^\s:]+?\.php):(\d+)/);
  if (!match) {
    return {};
  }

  return { file: match[1], line: Number(match[2]) };
}

function parseTestCase(
  attributes: Record<string, string>,
  status: JUnitStatus,
  message: string,
): JUnitTestCase {
  const name = attributes.name ?? '';
  const className = attributes.classname || attributes.class || '';
  const timeSeconds = Number(attributes.time || '0');
  const file = attributes.file || undefined;
  const lineValue = attributes.line;
  const line = lineValue ? Number(lineValue) : undefined;

  return {
    name,
    className,
    timeSeconds: Number.isFinite(timeSeconds) ? timeSeconds : 0,
    status,
    message,
    file,
    line: Number.isFinite(line) ? line : undefined,
  };
}

function normalizeSaxAttributes(attributes: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(attributes).map(([name, value]) => [
    name,
    typeof value === 'string'
      ? value
      : value && typeof value === 'object' && 'value' in value && typeof value.value === 'string'
        ? value.value
        : '',
  ]));
}

function readSaxAttribute(attributes: Record<string, string>, name: string): string {
  const attribute = attributes[name];
  return attribute ?? '';
}
