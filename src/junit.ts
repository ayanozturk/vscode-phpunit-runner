import type { JUnitStatus, JUnitTestCase } from './types';
import { methodNameFromTestCase, normalizeClassName } from './parser';

export function parseJUnitXml(xml: string): JUnitTestCase[] {
  if (!xml.trim()) {
    return [];
  }

  const cases: JUnitTestCase[] = [];
  const testCasePattern = /<testcase\b([^>]*)\/>|<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/gi;

  for (const match of xml.matchAll(testCasePattern)) {
    if (match[1] !== undefined) {
      cases.push(parseTestCase(match[1], ''));
      continue;
    }

    cases.push(parseTestCase(match[2], match[3] ?? ''));
  }

  return cases;
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

function parseTestCase(attributeText: string, body: string): JUnitTestCase {
  const name = decodeXml(readAttribute(attributeText, 'name'));
  const className = decodeXml(readAttribute(attributeText, 'classname') || readAttribute(attributeText, 'class'));
  const timeSeconds = Number(readAttribute(attributeText, 'time') || '0');
  const file = decodeXml(readAttribute(attributeText, 'file')) || undefined;
  const lineValue = readAttribute(attributeText, 'line');
  const line = lineValue ? Number(lineValue) : undefined;

  let status: JUnitStatus = 'passed';
  let message = '';

  if (/<skipped\b/i.test(body)) {
    status = 'skipped';
    message = innerXmlText(body, 'skipped');
  } else if (/<failure\b/i.test(body)) {
    status = 'failed';
    message = innerXmlText(body, 'failure');
  } else if (/<error\b/i.test(body)) {
    status = 'errored';
    message = innerXmlText(body, 'error');
  }

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

function readAttribute(source: string, name: string): string {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'))
    ?? source.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i'));
  return match?.[1] ?? '';
}

function innerXmlText(body: string, tag: string): string {
  const cdata = body.match(new RegExp(`<${tag}\\b[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i'));
  if (cdata) {
    return cdata[1].trim();
  }

  const inner = body.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (inner) {
    return decodeXml(inner[1]).trim();
  }

  const messageAttr = body.match(new RegExp(`<${tag}\\b[^>]*\\bmessage="([^"]*)"`, 'i'));
  return decodeXml(messageAttr?.[1] ?? '').trim();
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
