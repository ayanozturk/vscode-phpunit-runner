import type { ParsedTestFile, SourcePosition, SourceRange, TestClass, TestMethod } from './types';

export function parseTestSource(filePath: string, source: string): ParsedTestFile {
  const code = maskNonCode(source);
  const lineStarts = getLineStarts(source);
  const classes: TestClass[] = [];

  const namespaces = findNamespaces(code);
  const namespaceAliases = new Map<string, Set<string>>();
  const classPattern = /\b(?:(?:final|abstract|readonly)\s+)*class\s+([A-Za-z_][A-Za-z0-9_]*)[^\{]*\{/gi;
  for (const match of code.matchAll(classPattern)) {
    const matchText = match[0];
    const className = match[1];
    const matchIndex = match.index ?? 0;
    const classKeywordOffset = matchText.indexOf('class');
    const classKeywordIndex = matchIndex + Math.max(classKeywordOffset, 0);
    if (/\babstract\s+class\b/i.test(matchText)) {
      continue;
    }
    const openBraceIndex = matchIndex + matchText.lastIndexOf('{');
    const closeBraceIndex = findMatchingBrace(code, openBraceIndex);
    if (closeBraceIndex === -1) {
      continue;
    }

    const body = source.slice(openBraceIndex + 1, closeBraceIndex);
    const namespace = namespaces.find((candidate) => matchIndex >= candidate.start && matchIndex < candidate.end);
    const namespaceKey = `${namespace?.start ?? 0}:${namespace?.end ?? code.length}`;
    let testAttributeAliases = namespaceAliases.get(namespaceKey);
    if (!testAttributeAliases) {
      testAttributeAliases = findTestAttributeAliases(code, namespace?.start ?? 0, namespace?.end ?? code.length);
      namespaceAliases.set(namespaceKey, testAttributeAliases);
    }
    const methods = parseTestMethods(body, openBraceIndex + 1, lineStarts, testAttributeAliases);
    if (methods.length === 0) {
      continue;
    }

    const namespaceName = namespace?.name ?? '';
    const fqcn = namespaceName ? `${namespaceName}\\${className}` : className;
    classes.push({
      name: className,
      fullyQualifiedName: fqcn,
      range: rangeFromOffsets(lineStarts, classKeywordIndex, openBraceIndex),
      methods,
    });
  }

  const namedPestDatasets = parsePestNamedDatasets(source, code);
  const pestMethods = parsePestTests(source, code, lineStarts, namedPestDatasets);
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

function parsePestTests(
  source: string,
  code: string,
  lineStarts: number[],
  namedDatasets: ReadonlyMap<string, Array<string | undefined> | undefined>,
): TestMethod[] {
  const methods: TestMethod[] = [];
  const occurrences = new Map<string, number>();
  const describeBlocks = parsePestDescribeBlocks(source, code);
  const activeDescribeBlocks: typeof describeBlocks = [];
  let nextDescribeBlock = 0;
  const callPattern = /\b(?:test|it)\s*\(/gi;
  for (const match of code.matchAll(callPattern)) {
    const start = match.index ?? 0;
    while (activeDescribeBlocks.length > 0 && activeDescribeBlocks[activeDescribeBlocks.length - 1].bodyEnd <= start) {
      activeDescribeBlocks.pop();
    }
    while (nextDescribeBlock < describeBlocks.length && describeBlocks[nextDescribeBlock].bodyStart < start) {
      const block = describeBlocks[nextDescribeBlock];
      if (block.bodyEnd > start) {
        activeDescribeBlocks.push(block);
      }
      nextDescribeBlock += 1;
    }

    if (/\bfunction\s*$/i.test(code.slice(Math.max(0, start - 32), start))) {
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
    const describePath = activeDescribeBlocks.map((block) => block.name);
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

    const datasetNames = parsePestDatasetNames(source, code, closeParen + 1, namedDatasets);
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
  const callPattern = /\bdescribe\s*\(/gi;
  for (const match of code.matchAll(callPattern)) {
    const start = match.index ?? 0;
    if (/\bfunction\s*$/i.test(code.slice(Math.max(0, start - 32), start))) {
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
 * Reads dataset identities when each chained `with()` call uses a literal PHP array or
 * a literal-only generator closure. Dynamic dataset references stay represented by the
 * parent Pest test because their cases cannot be known without executing project code.
 */
function parsePestNamedDatasets(
  source: string,
  code: string,
): Map<string, Array<string | undefined> | undefined> {
  const datasets = new Map<string, Array<string | undefined> | undefined>();
  const callPattern = /\bdataset\s*\(/gi;
  for (const match of code.matchAll(callPattern)) {
    const start = match.index ?? 0;
    const prefix = code.slice(Math.max(0, start - 40), start);
    if (/\bfunction\s*$/i.test(prefix) || /(?:->|::)\s*$/i.test(prefix)) {
      continue;
    }

    const openParen = start + match[0].lastIndexOf('(');
    const closeParen = findMatchingParenthesis(code, openParen);
    if (closeParen < 0) {
      continue;
    }

    const args = splitTopLevelArguments(source, code, openParen + 1, closeParen);
    const name = args[0] ? readPestStringLiteral(args[0].source.trim()) : undefined;
    if (name === undefined) {
      continue;
    }

    let labels: Array<string | undefined> | undefined;
    const values = args[1];
    if (args.length === 2 && values) {
      const leadingWhitespace = values.source.length - values.source.trimStart().length;
      const valueSource = values.source.trim();
      const arrayOpen = values.start + leadingWhitespace;
      if (valueSource.startsWith('[') && isStaticPhpLiteral(valueSource)) {
        const arrayClose = findMatchingArrayBracket(code, arrayOpen);
        if (arrayClose >= 0 && code.slice(arrayClose + 1, values.end).trim() === '') {
          labels = parseArrayDatasetLabels(source, code, arrayOpen, arrayClose);
        }
      }
    }

    // Duplicate or dynamic declarations are ambiguous; do not guess their cases.
    datasets.set(name, datasets.has(name) ? undefined : labels);
  }

  return datasets;
}

function parsePestDatasetNames(
  source: string,
  code: string,
  chainStart: number,
  namedDatasets: ReadonlyMap<string, Array<string | undefined> | undefined>,
): string[] | undefined {
  const dimensions: Array<Array<string | undefined>> = [];
  let cursor = chainStart;

  while (true) {
    const remaining = code.slice(cursor);
    const withCall = remaining.match(/^\s*->\s*with\s*\(/i);
    if (!withCall) {
      break;
    }

    const openParen = cursor + withCall[0].lastIndexOf('(');
    const closeParen = findMatchingParenthesis(code, openParen);
    if (closeParen < 0) {
      return undefined;
    }

    let argumentStart = openParen + 1;
    while (argumentStart < closeParen && /\s/.test(source[argumentStart])) {
      argumentStart += 1;
    }
    let labels: Array<string | undefined> | undefined;
    if (code[argumentStart] === '[') {
      const arrayClose = findMatchingArrayBracket(code, argumentStart);
      if (arrayClose < 0 || arrayClose > closeParen) {
        return undefined;
      }
      labels = parseArrayDatasetLabels(source, code, argumentStart, arrayClose);
    } else if (/^(?:static\s+)?function\b/i.test(code.slice(argumentStart, closeParen))) {
      labels = parseGeneratorDatasetLabels(source, code, argumentStart, closeParen);
    } else {
      const datasetName = readPestStringLiteral(source.slice(argumentStart, closeParen).trim());
      if (datasetName !== undefined) {
        labels = namedDatasets.get(datasetName);
      }
    }
    if (!labels || labels.length === 0) {
      return undefined;
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

function parseArrayDatasetLabels(
  source: string,
  code: string,
  arrayOpen: number,
  arrayClose: number,
): Array<string | undefined> | undefined {
  const entries = splitArrayEntries(source, code, arrayOpen, arrayClose);
  if (entries.length === 0) {
    return undefined;
  }

  const labels: Array<string | undefined> = [];
  for (const entry of entries) {
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
  return labels;
}

function splitTopLevelArguments(
  source: string,
  code: string,
  argumentsStart: number,
  argumentsEnd: number,
): Array<{ source: string; code: string; start: number; end: number }> {
  const args: Array<{ source: string; code: string; start: number; end: number }> = [];
  let argumentStart = argumentsStart;
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  let braceDepth = 0;

  for (let index = argumentsStart; index < argumentsEnd; index += 1) {
    switch (code[index]) {
      case '[': bracketDepth += 1; break;
      case ']': bracketDepth -= 1; break;
      case '(': parenthesisDepth += 1; break;
      case ')': parenthesisDepth -= 1; break;
      case '{': braceDepth += 1; break;
      case '}': braceDepth -= 1; break;
      case ',':
        if (bracketDepth === 0 && parenthesisDepth === 0 && braceDepth === 0) {
          args.push({
            source: source.slice(argumentStart, index),
            code: code.slice(argumentStart, index),
            start: argumentStart,
            end: index,
          });
          argumentStart = index + 1;
        }
        break;
    }
  }

  if (source.slice(argumentStart, argumentsEnd).trim()) {
    args.push({
      source: source.slice(argumentStart, argumentsEnd),
      code: code.slice(argumentStart, argumentsEnd),
      start: argumentStart,
      end: argumentsEnd,
    });
  }

  return args;
}

function parseGeneratorDatasetLabels(
  source: string,
  code: string,
  closureStart: number,
  callEnd: number,
): Array<string | undefined> | undefined {
  const parametersOpen = code.indexOf('(', closureStart);
  const parametersClose = parametersOpen >= 0 ? findMatchingParenthesis(code, parametersOpen) : -1;
  if (parametersClose < 0 || parametersClose >= callEnd) {
    return undefined;
  }

  // A closure may have a `use (...)` clause or return type between its parameters and body.
  const bodyOpen = code.indexOf('{', parametersClose + 1);
  if (bodyOpen < 0 || bodyOpen >= callEnd) {
    return undefined;
  }
  const bodyClose = findMatchingBrace(code, bodyOpen);
  if (bodyClose < 0 || bodyClose >= callEnd) {
    return undefined;
  }
  if (code.slice(bodyClose + 1, callEnd).trim()) {
    return undefined;
  }

  const labels: Array<string | undefined> = [];
  let segmentStart = bodyOpen + 1;
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  let braceDepth = 0;
  for (let index = segmentStart; index <= bodyClose; index += 1) {
    const character = code[index];
    if (character === '[') bracketDepth += 1;
    else if (character === ']') bracketDepth -= 1;
    else if (character === '(') parenthesisDepth += 1;
    else if (character === ')') parenthesisDepth -= 1;
    else if (character === '{') braceDepth += 1;
    else if (character === '}') braceDepth -= 1;

    if (character === ';' && bracketDepth === 0 && parenthesisDepth === 0 && braceDepth === 0) {
      const statementStart = segmentStart;
      const statementCodeSource = code.slice(statementStart, index);
      const statementCode = statementCodeSource.trim();
      segmentStart = index + 1;
      if (!statementCode) {
        continue;
      }

      const yieldMatch = statementCode.match(/^yield\b/i);
      if (!yieldMatch || /^yield\s+from\b/i.test(statementCode)) {
        return undefined;
      }
      const codeLeadingWhitespace = statementCodeSource.length - statementCodeSource.trimStart().length;
      const yieldOffset = (yieldMatch.index ?? 0) + yieldMatch[0].length;
      const expressionSource = source.slice(statementStart + codeLeadingWhitespace + yieldOffset, index).trim();
      const expressionCode = maskNonCode(expressionSource);
      if (!expressionCode || !expressionSource) {
        return undefined;
      }

      const arrowIndex = findTopLevelArrow(expressionCode);
      let label: string | undefined;
      let valueSource: string;
      if (arrowIndex >= 0) {
        label = readPestStringLiteral(expressionSource.slice(0, arrowIndex).trim());
        if (label === undefined) {
          return undefined;
        }
        valueSource = expressionSource.slice(arrowIndex + 2).trim();
      } else {
        valueSource = expressionSource;
      }

      if (!isStaticPhpLiteral(valueSource)) {
        return undefined;
      }
      labels.push(label);
    }
  }

  const trailingCode = code.slice(segmentStart, bodyClose).trim();
  if (trailingCode || labels.length === 0) {
    return undefined;
  }
  return labels;
}

function isStaticPhpLiteral(value: string): boolean {
  const literal = value.trim();
  if (
    readPestStringLiteral(literal) !== undefined
    || /^(?:true|false|null)$/i.test(literal)
    || /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(literal)
  ) {
    return true;
  }

  if (!literal.startsWith('[')) {
    return false;
  }
  const masked = maskNonCode(literal);
  const close = findMatchingArrayBracket(masked, 0);
  if (close !== masked.length - 1) {
    return false;
  }
  const entries = splitArrayEntries(literal, masked, 0, close);
  return entries.every((entry) => {
    if (/^\s*\.\.\./.test(entry.code)) {
      return false;
    }
    const arrowIndex = findTopLevelArrow(entry.code);
    if (arrowIndex < 0) {
      return isStaticPhpLiteral(entry.source);
    }
    const key = entry.source.slice(0, arrowIndex).trim();
    const keyIsLiteral = readPestStringLiteral(key) !== undefined
      || /^[-+]?\d+$/.test(key)
      || /^(?:true|false|null)$/i.test(key);
    return keyIsLiteral && isStaticPhpLiteral(entry.source.slice(arrowIndex + 2));
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
  if (literal?.[1] === '"') {
    for (let index = 0; index < literal[2].length; index += 1) {
      if (literal[2][index] !== '$') {
        continue;
      }
      let escapes = 0;
      for (let previous = index - 1; previous >= 0 && literal[2][previous] === '\\'; previous -= 1) {
        escapes += 1;
      }
      if (escapes % 2 === 0) {
        return undefined;
      }
    }
  }
  return literal?.[2].replace(/\\(['"\\])/g, '$1');
}

export function parseTestMethods(
  body: string,
  bodyOffset: number,
  lineStarts: number[],
  testAttributeAliases: ReadonlySet<string> = new Set(),
): TestMethod[] {
  const methods: TestMethod[] = [];
  const code = maskNonCode(body);
  const methodPattern = /(?:(?:abstract|final|static)\s+)*(?:public|protected)\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi;

  for (const match of code.matchAll(methodPattern)) {
    const methodName = match[1];
    const startOffset = match.index ?? 0;
    const header = methodAnnotationHeader(body, startOffset);

    if (/\babstract\b/i.test(match[0])) {
      continue;
    }

    const isTest = methodName.startsWith('test')
      || /@test\b/.test(header)
      || hasTestAttribute(header, testAttributeAliases);
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

function findTestAttributeAliases(code: string, namespaceStart: number, namespaceEnd: number): Set<string> {
  const aliases = new Set<string>();
  const namespaceCode = code.slice(namespaceStart, namespaceEnd);
  const usePattern = /^\s*use\s+(?!function\b|const\b)([^;]+);/gim;
  const testClass = 'phpunit\\framework\\attributes\\test';
  const testNamespace = 'phpunit\\framework\\attributes';

  for (const match of namespaceCode.matchAll(usePattern)) {
    const clause = match[1].trim();
    const groupStart = clause.indexOf('{');
    const imports = groupStart >= 0 && clause.endsWith('}')
      ? clause.slice(groupStart + 1, -1).split(',').map((entry) => `${clause.slice(0, groupStart)}${entry.trim()}`)
      : clause.split(',');

    for (const importSource of imports) {
      const importMatch = importSource.trim().match(/^\\?([A-Za-z_][A-Za-z0-9_\\]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?$/i);
      if (!importMatch || importMatch[1].toLowerCase() !== testClass) {
        if (!importMatch || importMatch[1].toLowerCase() !== testNamespace) {
          continue;
        }
      }
      const alias = importMatch[2] ?? importMatch[1].split('\\').pop()!;
      aliases.add(importMatch[1].toLowerCase() === testClass ? alias.toLowerCase() : `${alias.toLowerCase()}\\test`);
    }
  }

  return aliases;
}

function hasTestAttribute(header: string, aliases: ReadonlySet<string>): boolean {
  const attributePattern = /#\[\s*(\\?[A-Za-z_][A-Za-z0-9_\\]*)/g;
  for (const match of header.matchAll(attributePattern)) {
    const name = match[1].replace(/^\\/, '').toLowerCase();
    if (
      name === 'test'
      || name === 'phpunit\\framework\\attributes\\test'
      || aliases.has(name)
    ) {
      return true;
    }
  }
  return false;
}

type NamespaceRange = { name: string; start: number; end: number };

function findNamespaces(code: string): NamespaceRange[] {
  const declarations: { name: string; start: number; delimiter: ';' | '{'; end?: number }[] = [];
  const pattern = /\bnamespace\s*(?:([A-Za-z_\\][A-Za-z0-9_\\]*))?\s*(;|\{)/gi;
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
  return value.replace(/^\\+/, '').replace(/\\\\/g, '\\').replace(/\./g, '\\');
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
