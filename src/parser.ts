import type { ParsedTestFile, SourcePosition, SourceRange, TestClass, TestMethod } from './types';

export function parseTestSource(filePath: string, source: string): ParsedTestFile {
  const code = maskNonCode(source);
  const lineStarts = getLineStarts(source);
  const classes: TestClass[] = [];

  const namespaces = findNamespaces(code);
  const classPattern = /\b(?:(?:final|abstract|readonly)\s+)*class\s+([A-Za-z_][A-Za-z0-9_]*)[^\{]*\{/g;
  for (const match of code.matchAll(classPattern)) {
    const matchText = match[0];
    const className = match[1];
    const matchIndex = match.index ?? 0;
    const classKeywordOffset = matchText.indexOf('class');
    const classKeywordIndex = matchIndex + Math.max(classKeywordOffset, 0);
    if (/\babstract\s+class\b/.test(matchText)) {
      continue;
    }
    const openBraceIndex = matchIndex + matchText.lastIndexOf('{');
    const closeBraceIndex = findMatchingBrace(code, openBraceIndex);
    if (closeBraceIndex === -1) {
      continue;
    }

    const body = source.slice(openBraceIndex + 1, closeBraceIndex);
    const methods = parseTestMethods(body, openBraceIndex + 1, lineStarts);
    if (methods.length === 0) {
      continue;
    }

    const namespace = namespaces.find((candidate) => matchIndex >= candidate.start && matchIndex < candidate.end)?.name ?? '';
    const fqcn = namespace ? `${namespace}\\${className}` : className;
    classes.push({
      name: className,
      fullyQualifiedName: fqcn,
      range: rangeFromOffsets(lineStarts, classKeywordIndex, openBraceIndex),
      methods,
    });
  }

  const pestMethods = parsePestTests(source, code, lineStarts);
  if (pestMethods.length > 0) {
    const grouped = new Map<string, TestMethod[]>();
    for (const method of pestMethods) {
      const groupPath = method.pestDescribePath ?? [];
      const groupKey = JSON.stringify(groupPath);
      const group = grouped.get(groupKey) ?? [];
      group.push(method);
      grouped.set(groupKey, group);
    }

    for (const [groupKey, methods] of grouped) {
      const groupPath = JSON.parse(groupKey) as string[];
      const groupName = groupPath.length > 0 ? groupPath.join(' › ') : 'Pest tests';
      const first = methods[0].range.start;
      const last = methods[methods.length - 1].range.end;
      classes.push({
        name: groupName,
        fullyQualifiedName: `Pest tests\\${groupPath.join('\\') || 'root'}`,
        range: { start: first, end: last },
        methods,
        container: true,
      });
    }
  }

  return { filePath, classes };
}

function parsePestTests(source: string, code: string, lineStarts: number[]): TestMethod[] {
  const methods: TestMethod[] = [];
  const occurrences = new Map<string, number>();
  const describeBlocks = parsePestDescribeBlocks(source, code);
  const callPattern = /\b(?:test|it)\s*\(/g;
  for (const match of code.matchAll(callPattern)) {
    const start = match.index ?? 0;
    if (/\bfunction\s*$/.test(code.slice(Math.max(0, start - 32), start))) {
      continue;
    }

    const openParen = start + match[0].lastIndexOf('(');
    const closeParen = findMatchingParenthesis(code, openParen);
    if (closeParen < 0) {
      continue;
    }
    const name = readPestTestName(source.slice(openParen + 1, closeParen));
    if (!name) {
      continue;
    }
    const describePath = describeBlocks
      .filter((block) => start > block.bodyStart && start < block.bodyEnd)
      .sort((left, right) => left.bodyStart - right.bodyStart)
      .map((block) => block.name);
    const occurrenceKey = `${JSON.stringify(describePath)}:${name}`;
    const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
    occurrences.set(occurrenceKey, occurrence);
    const displayName = occurrence === 1 ? name : `${name} (${occurrence})`;
    methods.push({
      name: displayName,
      pestTestName: name,
      pestDescribePath: describePath,
      range: rangeFromOffsets(lineStarts, start, closeParen + 1),
      groups: [],
    });

    const datasetNames = parsePestDatasetNames(source, code, closeParen + 1);
    for (const datasetName of datasetNames ?? []) {
      methods.push({
        name: `${displayName} (${datasetName})`,
        pestTestName: `${name} ${datasetName}`,
        pestDatasetName: datasetName,
        pestDescribePath: describePath,
        range: rangeFromOffsets(lineStarts, start, closeParen + 1),
        groups: [],
      });
    }
  }
  return methods;
}

function parsePestDescribeBlocks(source: string, code: string): { name: string; bodyStart: number; bodyEnd: number }[] {
  const blocks: { name: string; bodyStart: number; bodyEnd: number }[] = [];
  const callPattern = /\bdescribe\s*\(/g;
  for (const match of code.matchAll(callPattern)) {
    const start = match.index ?? 0;
    if (/\bfunction\s*$/.test(code.slice(Math.max(0, start - 32), start))) {
      continue;
    }

    const openParen = start + match[0].lastIndexOf('(');
    const closeParen = findMatchingParenthesis(code, openParen);
    if (closeParen < 0) {
      continue;
    }
    const name = readPestTestName(source.slice(openParen + 1, closeParen));
    if (!name) {
      continue;
    }

    const callbackBody = code.slice(openParen + 1, closeParen);
    const relativeBrace = callbackBody.indexOf('{');
    if (relativeBrace < 0) {
      continue;
    }
    const openBrace = openParen + 1 + relativeBrace;
    const closeBrace = findMatchingBrace(code, openBrace);
    if (closeBrace >= 0) {
      blocks.push({ name, bodyStart: openBrace, bodyEnd: closeBrace });
    }
  }
  return blocks;
}

function findMatchingParenthesis(code: string, open: number): number {
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === '(') {
      depth += 1;
    } else if (code[index] === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function readPestTestName(argumentsSource: string): string | undefined {
  const literal = argumentsSource.match(/^\s*(['"])((?:\\.|[^\\])*?)\1/);
  if (!literal) {
    return undefined;
  }
  return literal[2].replace(/\\(['"\\])/g, '$1').trim() || undefined;
}

/**
 * Reads dataset identities when every chained `with()` call uses a literal PHP array.
 * Dynamic dataset references remain represented by the parent Pest test because their
 * cases cannot be known without executing project code.
 */
function parsePestDatasetNames(source: string, code: string, chainStart: number): string[] | undefined {
  const dimensions: Array<Array<string | undefined>> = [];
  let cursor = chainStart;

  while (true) {
    const remaining = code.slice(cursor);
    const withCall = remaining.match(/^\s*->\s*with\s*\(/);
    if (!withCall) {
      break;
    }

    const openParen = cursor + withCall[0].lastIndexOf('(');
    const closeParen = findMatchingParenthesis(code, openParen);
    if (closeParen < 0) {
      return undefined;
    }

    let arrayOpen = openParen + 1;
    while (arrayOpen < closeParen && /\s/.test(code[arrayOpen])) {
      arrayOpen += 1;
    }
    if (code[arrayOpen] !== '[') {
      return undefined;
    }

    const arrayClose = findMatchingArrayBracket(code, arrayOpen);
    if (arrayClose < 0 || arrayClose > closeParen) {
      return undefined;
    }

    const entries = splitArrayEntries(source, code, arrayOpen, arrayClose);
    if (entries.length === 0) {
      return undefined;
    }
    const labels: Array<string | undefined> = [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (/^\s*\.\.\./.test(entry.code)) {
        return undefined;
      }

      const arrowIndex = findTopLevelArrow(entry.code);
      if (arrowIndex < 0) {
        labels.push(undefined);
        continue;
      }

      const key = entry.source.slice(0, arrowIndex).trim();
      const stringKey = readPestStringLiteral(key);
      if (stringKey === undefined) {
        return undefined;
      }
      labels.push(stringKey);
    }

    dimensions.push(labels);
    cursor = closeParen + 1;
  }

  if (dimensions.length === 0) {
    return undefined;
  }

  const combinations: Array<Array<string | undefined>> = [[]];
  for (const dimension of dimensions) {
    const next: Array<Array<string | undefined>> = [];
    for (const prefix of combinations) {
      for (const label of dimension) {
        next.push([...prefix, label]);
      }
    }
    combinations.splice(0, combinations.length, ...next);
  }

  return combinations.map((labels, index) => {
    if (dimensions.length === 1 && labels[0] !== undefined) {
      return `with data set "${labels[0].replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return `with data set #${index}`;
  });
}

function findMatchingArrayBracket(code: string, open: number): number {
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === '[') {
      depth += 1;
    } else if (code[index] === ']') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function splitArrayEntries(
  source: string,
  code: string,
  arrayOpen: number,
  arrayClose: number,
): Array<{ source: string; code: string }> {
  const entries: Array<{ source: string; code: string }> = [];
  let entryStart = arrayOpen + 1;
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  let braceDepth = 0;

  for (let index = entryStart; index < arrayClose; index += 1) {
    switch (code[index]) {
      case '[': bracketDepth += 1; break;
      case ']': bracketDepth -= 1; break;
      case '(': parenthesisDepth += 1; break;
      case ')': parenthesisDepth -= 1; break;
      case '{': braceDepth += 1; break;
      case '}': braceDepth -= 1; break;
      case ',':
        if (bracketDepth === 0 && parenthesisDepth === 0 && braceDepth === 0) {
          entries.push({ source: source.slice(entryStart, index), code: code.slice(entryStart, index) });
          entryStart = index + 1;
        }
        break;
    }
  }

  const finalEntry = source.slice(entryStart, arrayClose);
  if (finalEntry.trim()) {
    entries.push({ source: finalEntry, code: code.slice(entryStart, arrayClose) });
  }
  return entries;
}

function findTopLevelArrow(code: string): number {
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  let braceDepth = 0;
  for (let index = 0; index < code.length - 1; index += 1) {
    switch (code[index]) {
      case '[': bracketDepth += 1; break;
      case ']': bracketDepth -= 1; break;
      case '(': parenthesisDepth += 1; break;
      case ')': parenthesisDepth -= 1; break;
      case '{': braceDepth += 1; break;
      case '}': braceDepth -= 1; break;
      case '=':
        if (code[index + 1] === '>' && bracketDepth === 0 && parenthesisDepth === 0 && braceDepth === 0) {
          return index;
        }
        break;
    }
  }
  return -1;
}

function readPestStringLiteral(value: string): string | undefined {
  const literal = value.match(/^(['"])((?:\\.|[^\\])*?)\1$/);
  return literal?.[2].replace(/\\(['"\\])/g, '$1');
}

export function parseTestMethods(body: string, bodyOffset: number, lineStarts: number[]): TestMethod[] {
  const methods: TestMethod[] = [];
  const code = maskNonCode(body);
  const methodPattern = /(?:(?:abstract|final|static)\s+)*(?:public|protected)\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

  for (const match of code.matchAll(methodPattern)) {
    const methodName = match[1];
    const startOffset = match.index ?? 0;
    const header = methodAnnotationHeader(body, startOffset);

    if (/\babstract\b/.test(match[0])) {
      continue;
    }

    const isTest = methodName.startsWith('test')
      || /@test\b/.test(header)
      || /#\[\s*(?:\\?PHPUnit\\Framework\\Attributes\\)?Test\b/.test(header);
    if (!isTest) {
      continue;
    }

    const start = bodyOffset + startOffset;
    methods.push({
      name: methodName,
      range: rangeFromOffsets(lineStarts, start, start + match[0].length),
      groups: extractGroups(header),
    });
  }

  return methods;
}

type NamespaceRange = { name: string; start: number; end: number };

function findNamespaces(code: string): NamespaceRange[] {
  const declarations: { name: string; start: number; delimiter: ';' | '{'; end?: number }[] = [];
  const pattern = /\bnamespace\s*(?:([A-Za-z_\\][A-Za-z0-9_\\]*))?\s*(;|\{)/g;
  for (const match of code.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[0].length;
    const delimiter = match[2] as ';' | '{';
    if (delimiter === '{') {
      const openBrace = (match.index ?? 0) + match[0].lastIndexOf('{');
      const closeBrace = findMatchingBrace(code, openBrace);
      declarations.push({
        name: (match[1] ?? '').replace(/^\\/, '').replace(/\\$/, ''),
        start,
        delimiter,
        end: closeBrace,
      });
    } else {
      declarations.push({
        name: (match[1] ?? '').replace(/^\\/, '').replace(/\\$/, ''),
        start,
        delimiter,
      });
    }
  }

  return declarations.map((declaration, index) => ({
    name: declaration.name,
    start: declaration.start,
    end: declaration.end ?? declarations[index + 1]?.start ?? code.length,
  }));
}

function methodAnnotationHeader(source: string, declarationStart: number): string {
  let cursor = declarationStart;
  let headerStart = cursor;

  while (cursor > 0) {
    while (cursor > 0 && /\s/.test(source[cursor - 1])) {
      cursor -= 1;
    }

    if (cursor > 0 && source[cursor - 1] === ']') {
      const open = matchingOpenBracket(source, cursor - 1);
      if (open >= 1 && source[open - 1] === '#') {
        cursor = open - 1;
        headerStart = cursor;
        continue;
      }
    }

    if (cursor >= 2 && source.slice(cursor - 2, cursor) === '*/') {
      const commentStart = source.lastIndexOf('/*', cursor - 2);
      if (commentStart >= 0) {
        cursor = commentStart;
        headerStart = cursor;
        continue;
      }
    }

    break;
  }

  return source.slice(headerStart, declarationStart);
}

function matchingOpenBracket(source: string, close: number): number {
  let depth = 0;
  for (let index = close; index >= 0; index -= 1) {
    if (source[index] === ']') {
      depth += 1;
    } else if (source[index] === '[') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function maskNonCode(source: string): string {
  const chars = source.split('');
  let quote = '';
  let lineComment = false;
  let blockComment = false;
  let heredocLabel: string | undefined;

  const mask = (index: number) => {
    if (chars[index] !== '\n' && chars[index] !== '\r') {
      chars[index] = ' ';
    }
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] ?? '';
    const prev = source[index - 1] ?? '';

    if (heredocLabel) {
      mask(index);
      if (index === 0 || prev === '\n') {
        const endMarker = source.slice(index).match(new RegExp(`^[\\t ]*${escapeRegex(heredocLabel)}(?![A-Za-z0-9_])`));
        if (endMarker) {
          for (let offset = 0; offset < endMarker[0].length; offset += 1) {
            mask(index + offset);
          }
          index += endMarker[0].length - 1;
          heredocLabel = undefined;
        }
      }
      continue;
    }

    if (lineComment) {
      mask(index);
      if (char === '\n') {
        lineComment = false;
      }
      continue;
    }

    if (blockComment) {
      mask(index);
      if (prev === '*' && char === '/') {
        blockComment = false;
      }
      continue;
    }

    if (quote) {
      mask(index);
      if (char === '\\') {
        if (index + 1 < source.length) {
          mask(index + 1);
          index += 1;
        }
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }

    if ((char === '/' && next === '/') || (char === '#' && next !== '[')) {
      lineComment = true;
      mask(index);
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      mask(index);
      continue;
    }

    if (source.startsWith('<<<', index)) {
      const heredocStart = source.slice(index).match(/^<<<[\t ]*(?:(['"])([A-Za-z_][A-Za-z0-9_]*)\1|([A-Za-z_][A-Za-z0-9_]*))[\t ]*\r?\n/);
      if (heredocStart) {
        heredocLabel = heredocStart[2] ?? heredocStart[3];
        for (let offset = 0; offset < heredocStart[0].length; offset += 1) {
          mask(index + offset);
        }
        index += heredocStart[0].length - 1;
        continue;
      }
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      mask(index);
    }
  }

  return chars.join('');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractGroups(header: string): string[] {
  const groups = new Set<string>();
  const attributePattern = /#\[\s*(?:\\?PHPUnit\\Framework\\Attributes\\)?Group\s*\(\s*['"]([^'"]+)['"]/g;
  for (const match of header.matchAll(attributePattern)) {
    groups.add(match[1]);
  }
  const docPattern = /@group\s+(\S+)/g;
  for (const match of header.matchAll(docPattern)) {
    groups.add(match[1]);
  }
  return [...groups];
}

export function getLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') {
      starts.push(index + 1);
    }
  }
  return starts;
}

export function rangeFromOffsets(lineStarts: number[], start: number, end: number): SourceRange {
  return {
    start: positionFromOffset(lineStarts, start),
    end: positionFromOffset(lineStarts, end),
  };
}

export function positionFromOffset(lineStarts: number[], offset: number): SourcePosition {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const line = Math.max(high, 0);
  return { line, character: Math.max(offset - lineStarts[line], 0) };
}

export function findMatchingBrace(source: string, openBraceIndex: number): number {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] ?? '';
    const prev = source[index - 1] ?? '';

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (prev === '*' && char === '/') {
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === '/' && next === '/') {
        inLineComment = true;
        continue;
      }

      if (char === '/' && next === '*') {
        inBlockComment = true;
        continue;
      }
    }

    if (char === '\'' && !inDoubleQuote && prev !== '\\') {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote && prev !== '\\') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

export function normalizeClassName(value: string): string {
  return value.replace(/^\\+/, '').replace(/\\\\/g, '\\');
}

export function classNamesMatch(left: string, right: string): boolean {
  const a = normalizeClassName(left);
  const b = normalizeClassName(right);
  return a === b || a.endsWith(`\\${b}`) || b.endsWith(`\\${a}`);
}

export function methodNameFromTestCase(caseName: string): string {
  const dataSet = caseName.match(/^(.*?)(?:\s+with data set\b.*|#\d+$|#".*"$|@.+)$/);
  return (dataSet?.[1] ?? caseName).trim();
}

export function datasetSuffixFromTestCase(caseName: string, methodName: string): string | undefined {
  if (!caseName.startsWith(methodName)) {
    return undefined;
  }
  const suffix = caseName.slice(methodName.length).trim();
  return /^(?:with data set\b|#\d+\b|#".*"$|@.+)/.test(suffix) ? suffix : undefined;
}
