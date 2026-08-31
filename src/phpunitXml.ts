export type PhpUnitSuite = {
  name: string;
  directories: { path: string; suffix?: string }[];
  files: string[];
  excludes: string[];
};

export type PhpUnitXmlConfig = {
  suites: PhpUnitSuite[];
  excludes: string[];
};

export function parsePhpUnitXml(xml: string): PhpUnitXmlConfig {
  const suites: PhpUnitSuite[] = [];
  const suitePattern = /<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/gi;

  for (const match of xml.matchAll(suitePattern)) {
    const name = readAttribute(match[1], 'name') || 'default';
    const body = match[2];
    suites.push({
      name,
      directories: collectDirectories(body),
      files: collectTaggedPaths(body, 'file'),
      excludes: collectTaggedPaths(body, 'exclude'),
    });
  }

  const testsuitesBody = xml.match(/<testsuites\b[^>]*>([\s\S]*?)<\/testsuites>/i)?.[1] ?? '';
  const topLevelExcludes = collectTaggedPaths(testsuitesBody, 'exclude');

  return {
    suites,
    excludes: [...new Set(topLevelExcludes)],
  };
}

export function resolveDiscoveryGlobs(options: {
  configuredIncludes: string[];
  configuredExcludes: string[];
  xmlText?: string;
  xmlDirectoryRelative?: string;
}): { includeGlobs: string[]; excludeGlobs: string[] } {
  const xml = options.xmlText ? parsePhpUnitXml(options.xmlText) : undefined;
  const fromXml = xml
    ? discoveryPatternsFromXml(xml)
    : { includeGlobs: [], excludeGlobs: [] };
  const includeGlobs = fromXml.includeGlobs.length > 0
    ? fromXml.includeGlobs.map((glob) => prefixRelative(options.xmlDirectoryRelative, glob))
    : options.configuredIncludes;

  const excludeGlobs = [
    ...options.configuredExcludes,
    ...fromXml.excludeGlobs.map((glob) => prefixRelative(options.xmlDirectoryRelative, glob)),
  ];

  return {
    includeGlobs: [...new Set(includeGlobs)],
    excludeGlobs: [...new Set(excludeGlobs)],
  };
}

function prefixRelative(directory: string | undefined, glob: string): string {
  if (!directory || directory === '.' || glob.startsWith('/') || /^[A-Za-z]:/.test(glob)) {
    return glob;
  }
  return `${toPosixRelative(directory)}/${glob}`;
}

function discoveryPatternsFromXml(config: PhpUnitXmlConfig): { includeGlobs: string[]; excludeGlobs: string[] } {
  const includeGlobs: string[] = [];
  const excludeGlobs: string[] = [];

  for (const suite of config.suites) {
    for (const directory of suite.directories) {
      const relative = toPosixRelative(directory.path);
      const suffix = directory.suffix?.replace(/^\*/, '') || '.php';
      includeGlobs.push(`${relative}/**/*${suffix}`);
    }
    for (const file of suite.files) {
      includeGlobs.push(toPosixRelative(file));
    }
    for (const exclude of suite.excludes) {
      excludeGlobs.push(excludeGlob(exclude));
    }
  }

  for (const exclude of config.excludes) {
    excludeGlobs.push(excludeGlob(exclude));
  }

  return {
    includeGlobs: [...new Set(includeGlobs)],
    excludeGlobs: [...new Set(excludeGlobs)],
  };
}

export function listSuiteNames(config: PhpUnitXmlConfig): string[] {
  return config.suites.map((suite) => suite.name).filter(Boolean);
}

function collectDirectories(body: string): { path: string; suffix?: string }[] {
  const directories: { path: string; suffix?: string }[] = [];
  const pattern = /<directory\b([^>]*)>([\s\S]*?)<\/directory>/gi;
  for (const match of body.matchAll(pattern)) {
    const pathValue = decodeXml(match[2]).trim();
    if (!pathValue) {
      continue;
    }
    directories.push({
      path: pathValue,
      suffix: readAttribute(match[1], 'suffix') || undefined,
    });
  }
  return directories;
}

function collectTaggedPaths(body: string, tag: string): string[] {
  const values: string[] = [];
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  for (const match of body.matchAll(pattern)) {
    const value = decodeXml(match[1]).trim();
    if (value) {
      values.push(value);
    }
  }
  return values;
}

function excludeGlob(target: string): string {
  const relative = toPosixRelative(target);
  return relative.endsWith('.php') ? relative : `${relative}/**`;
}

function toPosixRelative(target: string): string {
  return target.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function readAttribute(source: string, name: string): string {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'))
    ?? source.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i'));
  return decodeXml(match?.[1] ?? '');
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
