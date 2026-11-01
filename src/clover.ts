export type CloverLine = {
  line: number;
  count: number;
  type: 'stmt' | 'method' | 'other';
  declarationName?: string;
};

export type CloverDeclaration = { name: string; line: number; count: number };

export type CloverFileCoverage = {
  path: string;
  lines: CloverLine[];
  declarations: CloverDeclaration[];
  statements: number;
  coveredStatements: number;
  methods?: number;
  coveredMethods?: number;
};

const XML_ATTRIBUTES = `(?:"[^"]*"|'[^']*'|[^'">])*`;
const FILE_PATTERN = new RegExp(`<file\\b(${XML_ATTRIBUTES})>([\\s\\S]*?)<\\/file>`, 'gi');
const CLASS_PATTERN = new RegExp(`<class\\b${XML_ATTRIBUTES}>([\\s\\S]*?)<\\/class>`, 'gi');
const LINE_PATTERN = new RegExp(`<line\\b(${XML_ATTRIBUTES})\\s*\\/?>`, 'gi');
const METRICS_PATTERN = new RegExp(`<metrics\\b(${XML_ATTRIBUTES})\\s*\\/?>`, 'i');
const ALL_METRICS_PATTERN = new RegExp(METRICS_PATTERN.source, 'gi');
const ATTRIBUTE_PATTERNS: Record<string, RegExp> = {
  name: /\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i,
  num: /\bnum\s*=\s*(?:"([^"]*)"|'([^']*)')/i,
  count: /\bcount\s*=\s*(?:"([^"]*)"|'([^']*)')/i,
  type: /\btype\s*=\s*(?:"([^"]*)"|'([^']*)')/i,
  signature: /\bsignature\s*=\s*(?:"([^"]*)"|'([^']*)')/i,
  statements: /\bstatements\s*=\s*(?:"([^"]*)"|'([^']*)')/i,
  coveredstatements: /\bcoveredstatements\s*=\s*(?:"([^"]*)"|'([^']*)')/i,
  methods: /\bmethods\s*=\s*(?:"([^"]*)"|'([^']*)')/i,
  coveredmethods: /\bcoveredmethods\s*=\s*(?:"([^"]*)"|'([^']*)')/i,
};

export function parseCloverXml(xml: string): CloverFileCoverage[] {
  if (!xml.trim()) {
    return [];
  }

  // Do not interpret report-looking tags embedded in XML comments as coverage.
  const report = xml.replace(/<!--[\s\S]*?-->/g, '');
  const files: CloverFileCoverage[] = [];

  for (const match of report.matchAll(FILE_PATTERN)) {
    const pathValue = decodeXml(readAttribute(match[1], 'name')).trim();
    if (!pathValue) {
      continue;
    }

    const body = match[2];
    const lines: CloverLine[] = [];
    const declarations: CloverDeclaration[] = [];
    for (const lineMatch of body.matchAll(LINE_PATTERN)) {
      const num = Number(readAttribute(lineMatch[1], 'num'));
      const rawCount = readAttribute(lineMatch[1], 'count');
      const count = rawCount ? Number(rawCount) : 0;
      const typeRaw = readAttribute(lineMatch[1], 'type').toLowerCase();
      const type = typeRaw === 'stmt' || typeRaw === 'method' ? typeRaw : 'other';
      if (!Number.isInteger(num) || num <= 0) {
        continue;
      }
      const safeCount = Number.isInteger(count) && count >= 0 ? count : 0;
      const declarationName = type === 'method' ? getDeclarationName(lineMatch[1]) : undefined;
      lines.push({ line: num, count: safeCount, type, ...(declarationName ? { declarationName } : {}) });
      if (type === 'method' && declarationName) {
        declarations.push({ name: declarationName, line: num, count: safeCount });
      }
    }

    const metricSources = getFileAndClassMetricSources(body);
    const statements = readMetricWithClassFallback(metricSources, 'statements');
    const coveredStatements = readMetricWithClassFallback(metricSources, 'coveredstatements');
    const methods = readMetricWithClassFallback(metricSources, 'methods');
    const coveredMethods = readMetricWithClassFallback(metricSources, 'coveredmethods');
    const stmtLines = lines.filter((item) => item.type === 'stmt');

    files.push({
      path: pathValue,
      lines,
      declarations,
      statements: statements ?? stmtLines.length,
      coveredStatements: coveredStatements ?? stmtLines.filter((item) => item.count > 0).length,
      ...(methods === undefined ? {} : { methods }),
      ...(coveredMethods === undefined ? {} : { coveredMethods }),
    });
  }

  return files;
}

function getFileAndClassMetricSources(body: string): { file?: string; classes: string[] } {
  const classes = [...body.matchAll(CLASS_PATTERN)];
  const classSources = classes.flatMap((classMatch) => (
    [...classMatch[1].matchAll(ALL_METRICS_PATTERN)].map((metricsMatch) => metricsMatch[1])
  ));
  const fileBody = body.replace(CLASS_PATTERN, '');
  return {
    file: fileBody.match(METRICS_PATTERN)?.[1],
    classes: classSources,
  };
}

function readMetricWithClassFallback(
  sources: { file?: string; classes: string[] },
  attribute: 'statements' | 'coveredstatements' | 'methods' | 'coveredmethods',
): number | undefined {
  const fileMetric = sources.file ? readNonnegativeIntegerAttribute(sources.file, attribute) : undefined;
  if (fileMetric !== undefined) {
    return fileMetric;
  }

  let total = 0;
  let hasMetric = false;
  for (const classSource of sources.classes) {
    const classMetric = readNonnegativeIntegerAttribute(classSource, attribute);
    if (classMetric !== undefined) {
      total += classMetric;
      hasMetric = true;
    }
  }
  return hasMetric ? total : undefined;
}

function getDeclarationName(attributes: string): string {
  const explicitName = decodeXml(readAttribute(attributes, 'name')).trim();
  if (explicitName) {
    return explicitName;
  }

  // PHPUnit's php-code-coverage reporter writes method/function names as the
  // leading identifier in a `signature` attribute. Keep only signatures whose
  // leading identifier is explicit; do not guess from source lines or paths.
  const signature = decodeXml(readAttribute(attributes, 'signature')).trim();
  return signature.match(/^&?\s*([\\A-Za-z_][\\A-Za-z0-9_]*)\s*\(/)?.[1] ?? '';
}

function readNonnegativeIntegerAttribute(source: string, name: string): number | undefined {
  const value = readAttribute(source, name);
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function readAttribute(source: string, name: keyof typeof ATTRIBUTE_PATTERNS): string {
  const match = source.match(ATTRIBUTE_PATTERNS[name]);
  return match?.[1] ?? match?.[2] ?? '';
}

function decodeXml(value: string): string {
  return value
    .replace(/&#(?:x([\da-f]+)|(\d+));/gi, (entity, hexadecimal: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hexadecimal ?? decimal ?? '', hexadecimal ? 16 : 10);
      const isValidXmlCodePoint = codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd
        || (codePoint >= 0x20 && codePoint <= 0xd7ff)
        || (codePoint >= 0xe000 && codePoint <= 0xfffd)
        || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
      return isValidXmlCodePoint ? String.fromCodePoint(codePoint) : entity;
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
