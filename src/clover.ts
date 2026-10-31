export type CloverLine = {
  line: number;
  count: number;
  type: 'stmt' | 'method' | 'other';
};

export type CloverFileCoverage = {
  path: string;
  lines: CloverLine[];
  statements: number;
  coveredStatements: number;
};

export function parseCloverXml(xml: string): CloverFileCoverage[] {
  if (!xml.trim()) {
    return [];
  }

  // Do not interpret report-looking tags embedded in XML comments as coverage.
  const report = xml.replace(/<!--[\s\S]*?-->/g, '');
  const files: CloverFileCoverage[] = [];
  const filePattern = /<file\b([^>]*)>([\s\S]*?)<\/file>/gi;

  for (const match of report.matchAll(filePattern)) {
    const pathValue = decodeXml(readAttribute(match[1], 'name')).trim();
    if (!pathValue) {
      continue;
    }

    const body = match[2];
    const lines: CloverLine[] = [];
    const linePattern = /<line\b([^>]*)\/?>/gi;
    for (const lineMatch of body.matchAll(linePattern)) {
      const num = Number(readAttribute(lineMatch[1], 'num'));
      const rawCount = readAttribute(lineMatch[1], 'count');
      const count = rawCount ? Number(rawCount) : 0;
      const typeRaw = readAttribute(lineMatch[1], 'type').toLowerCase();
      if (!Number.isInteger(num) || num <= 0) {
        continue;
      }
      const type = typeRaw === 'stmt' || typeRaw === 'method' ? typeRaw : 'other';
      lines.push({ line: num, count: Number.isInteger(count) && count >= 0 ? count : 0, type });
    }

    const metrics = body.match(/<metrics\b([^>]*)\/?>/i)?.[1] ?? '';
    const statements = readNonnegativeIntegerAttribute(metrics, 'statements');
    const coveredStatements = readNonnegativeIntegerAttribute(metrics, 'coveredstatements');
    const stmtLines = lines.filter((item) => item.type === 'stmt');

    files.push({
      path: pathValue,
      lines,
      statements: statements ?? stmtLines.length,
      coveredStatements: coveredStatements ?? stmtLines.filter((item) => item.count > 0).length,
    });
  }

  return files;
}

function readNonnegativeIntegerAttribute(source: string, name: string): number | undefined {
  const value = readAttribute(source, name);
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function readAttribute(source: string, name: string): string {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'))
    ?? source.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i'));
  return match?.[1] ?? '';
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
