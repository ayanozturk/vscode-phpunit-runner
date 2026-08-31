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

  const files: CloverFileCoverage[] = [];
  const filePattern = /<file\b([^>]*)>([\s\S]*?)<\/file>/gi;

  for (const match of xml.matchAll(filePattern)) {
    const pathValue = decodeXml(readAttribute(match[1], 'name')).trim();
    if (!pathValue) {
      continue;
    }

    const body = match[2];
    const lines: CloverLine[] = [];
    const linePattern = /<line\b([^>]*)\/?>/gi;
    for (const lineMatch of body.matchAll(linePattern)) {
      const num = Number(readAttribute(lineMatch[1], 'num'));
      const count = Number(readAttribute(lineMatch[1], 'count') || '0');
      const typeRaw = readAttribute(lineMatch[1], 'type').toLowerCase();
      if (!Number.isFinite(num) || num <= 0) {
        continue;
      }
      const type = typeRaw === 'stmt' || typeRaw === 'method' ? typeRaw : 'other';
      lines.push({ line: num, count: Number.isFinite(count) ? count : 0, type });
    }

    const metrics = body.match(/<metrics\b([^>]*)\/?>/i)?.[1] ?? '';
    const statements = Number(readAttribute(metrics, 'statements') || '0');
    const coveredStatements = Number(readAttribute(metrics, 'coveredstatements') || '0');
    const stmtLines = lines.filter((item) => item.type === 'stmt');

    files.push({
      path: pathValue,
      lines,
      statements: statements || stmtLines.length,
      coveredStatements: coveredStatements || stmtLines.filter((item) => item.count > 0).length,
    });
  }

  return files;
}

function readAttribute(source: string, name: string): string {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'))
    ?? source.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i'));
  return match?.[1] ?? '';
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
