import type { ParsedTestFile, SourcePosition, SourceRange, TestClass, TestMethod } from './types';

export function parseTestSource(filePath: string, source: string): ParsedTestFile {
  const namespaceMatch = /^\s*namespace\s+([^;]+);/m.exec(source);
  const namespace = namespaceMatch?.[1]?.trim() ?? '';
  const lineStarts = getLineStarts(source);
  const classes: TestClass[] = [];

  const classPattern = /(?:final\s+|abstract\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)[^\{]*\{/g;
  for (const match of source.matchAll(classPattern)) {
    const matchText = match[0];
    const className = match[1];
    const matchIndex = match.index ?? 0;
    const classKeywordOffset = matchText.indexOf('class');
    const classKeywordIndex = matchIndex + Math.max(classKeywordOffset, 0);
    if (/\babstract\s+class\b/.test(matchText)) {
      continue;
    }
    const openBraceIndex = matchIndex + matchText.lastIndexOf('{');
    const closeBraceIndex = findMatchingBrace(source, openBraceIndex);
    if (closeBraceIndex === -1) {
      continue;
    }

    const body = source.slice(openBraceIndex + 1, closeBraceIndex);
    const methods = parseTestMethods(body, openBraceIndex + 1, lineStarts);
    if (methods.length === 0) {
      continue;
    }

    const fqcn = namespace ? `${namespace}\\${className}` : className;
    classes.push({
      name: className,
      fullyQualifiedName: fqcn,
      range: rangeFromOffsets(lineStarts, classKeywordIndex, openBraceIndex),
      methods,
    });
  }

  return { filePath, classes };
}

export function parseTestMethods(body: string, bodyOffset: number, lineStarts: number[]): TestMethod[] {
  const methods: TestMethod[] = [];
  const methodPattern = /(?:abstract\s+)?(?:final\s+)?(?:public|protected)\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let previousEnd = 0;

  for (const match of body.matchAll(methodPattern)) {
    const methodName = match[1];
    const header = body.slice(previousEnd, match.index ?? 0);
    previousEnd = (match.index ?? 0) + match[0].length;

    if (/abstract\s+(?:final\s+)?(?:public|protected)\s+function/.test(match[0])) {
      continue;
    }

    const isTest = methodName.startsWith('test')
      || /@test\b/.test(header)
      || /#\[\s*(?:\\?PHPUnit\\Framework\\Attributes\\)?Test\b/.test(header);
    if (!isTest) {
      continue;
    }

    const start = bodyOffset + (match.index ?? 0);
    methods.push({
      name: methodName,
      range: rangeFromOffsets(lineStarts, start, start + match[0].length),
      groups: extractGroups(header),
    });
  }

  return methods;
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
