import * as sax from 'sax';
import { readSaxAttribute } from './xmlAttributes';

export type PhpUnitSuite = {
  name: string;
  directories: { path: string; prefix?: string; suffix?: string }[];
  files: string[];
  excludes: string[];
};

export type PhpUnitXmlConfig = {
  suites: PhpUnitSuite[];
  excludes: string[];
};

export function parsePhpUnitXml(xml: string): PhpUnitXmlConfig {
  const suites: PhpUnitSuite[] = [];
  const excludes: string[] = [];
  const suiteStack: PhpUnitSuite[] = [];
  let testsuitesDepth = 0;
  let pathElement: {
    name: 'directory' | 'file' | 'exclude';
    value: string;
    prefix?: string;
    suffix?: string;
    suite?: PhpUnitSuite;
    isTopLevelExclude: boolean;
  } | undefined;

  const parser = sax.parser(true, { trim: false, normalize: false });
  parser.onopentag = (tag) => {
    const name = tag.name.toLowerCase();
    if (name === 'testsuites') {
      testsuitesDepth += 1;
      return;
    }

    if (name === 'testsuite') {
      const suite: PhpUnitSuite = {
        name: readSaxAttribute(tag.attributes, 'name') || 'default',
        directories: [],
        files: [],
        excludes: [],
      };
      suites.push(suite);
      suiteStack.push(suite);
      return;
    }

    if (name === 'directory' || name === 'file' || name === 'exclude') {
      pathElement = {
        name,
        value: '',
        prefix: name === 'directory' ? readSaxAttribute(tag.attributes, 'prefix') || undefined : undefined,
        suffix: name === 'directory' ? readSaxAttribute(tag.attributes, 'suffix') || undefined : undefined,
        suite: suiteStack.at(-1),
        isTopLevelExclude: name === 'exclude' && suiteStack.length === 0 && testsuitesDepth > 0,
      };
    }
  };

  const appendText = (value: string) => {
    if (pathElement) {
      pathElement.value += value;
    }
  };
  parser.ontext = appendText;
  parser.oncdata = appendText;
  parser.onclosetag = (rawName) => {
    const name = rawName.toLowerCase();
    if (pathElement?.name === name) {
      const value = pathElement.value.trim();
      if (value && pathElement.suite) {
        if (pathElement.name === 'directory') {
          pathElement.suite.directories.push({
            path: value,
            ...(pathElement.prefix ? { prefix: pathElement.prefix } : {}),
            ...(pathElement.suffix ? { suffix: pathElement.suffix } : {}),
          });
        } else if (pathElement.name === 'file') {
          pathElement.suite.files.push(value);
        } else {
          pathElement.suite.excludes.push(value);
        }
      } else if (value && pathElement.isTopLevelExclude) {
        excludes.push(value);
      }
      pathElement = undefined;
    }

    if (name === 'testsuite') {
      suiteStack.pop();
    } else if (name === 'testsuites') {
      testsuitesDepth = Math.max(0, testsuitesDepth - 1);
    }
  };
  parser.onerror = (error) => {
    throw error;
  };
  parser.write(xml).close();

  return {
    suites,
    excludes: [...new Set(excludes)],
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
      includeGlobs.push(`${relative}/**/${directory.prefix ?? ''}*${suffix}`);
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

function excludeGlob(target: string): string {
  const relative = toPosixRelative(target);
  return relative.endsWith('.php') ? relative : `${relative}/**`;
}

function toPosixRelative(target: string): string {
  return target.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}
