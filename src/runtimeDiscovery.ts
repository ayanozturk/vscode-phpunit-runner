import * as sax from 'sax';
import { datasetSuffixFromTestCase, methodNameFromTestCase, normalizeClassName } from './parser';
import { normalizeSaxAttributes, readSaxAttribute } from './xmlAttributes';
import type { ParsedTestFile } from './types';

export type RuntimeTestCase = {
  className: string;
  /** The unmodified `name` attribute from PHPUnit's XML listing. */
  caseName: string;
  methodName: string;
  dataSetName?: string;
  dataSetSuffix?: string;
  groups: string[];
};

export type RuntimePhptFile = {
  path: string;
};

export type RuntimeTestListing = {
  testCases: RuntimeTestCase[];
  phptFiles: RuntimePhptFile[];
};

export type ReconciledRuntimeTest = RuntimeTestCase & {
  filePath: string;
  identity: string;
};

/**
 * Parses the XML written by PHPUnit's `--list-tests-xml` option.
 *
 * The output is intentionally kept independent of VS Code TestItems so it can
 * be used by discovery and execution code without coupling this parser to UI
 * state. Unknown XML elements are ignored for forward compatibility.
 */
export function parseRuntimeTestListing(xml: string): RuntimeTestListing {
  if (!xml.trim()) {
    throw new Error('PHPUnit test listing is empty.');
  }

  const testCases: RuntimeTestCase[] = [];
  const phptFiles: RuntimePhptFile[] = [];
  const parser = sax.parser(true, { trim: true, normalize: false });
  let rootSeen = false;
  let rootClosed = false;
  let currentClass: string | undefined;
  const elementStack: string[] = [];

  parser.onopentag = (tag) => {
    const name = tag.name.toLowerCase();
    const attributes = normalizeSaxAttributes(tag.attributes);

    if (!rootSeen) {
      if (name !== 'tests') {
        throw new Error(`Unexpected PHPUnit test listing root element: ${tag.name}.`);
      }
      rootSeen = true;
      elementStack.push(name);
      return;
    }

    const parent = elementStack[elementStack.length - 1];
    if (name === 'testcaseclass' && parent === 'tests') {
      if (currentClass) {
        throw new Error('PHPUnit test listing contains nested test classes.');
      }
      currentClass = readSaxAttribute(attributes, 'name').trim();
      if (!currentClass) {
        throw new Error('PHPUnit test listing contains a class without a name.');
      }
      elementStack.push(name);
      return;
    }

    if (name === 'testcasemethod' && parent === 'testcaseclass' && currentClass) {
      const listedName = readSaxAttribute(attributes, 'name').trim();
      if (!listedName) {
        throw new Error(`PHPUnit test listing contains an unnamed method in ${currentClass}.`);
      }
      const methodName = methodNameFromTestCase(listedName);
      if (!methodName) {
        throw new Error(`PHPUnit test listing contains an invalid method name in ${currentClass}.`);
      }
      const dataSetName = readSaxAttribute(attributes, 'dataSet').trim() || undefined;
      const dataSetSuffix = datasetSuffixFromTestCase(listedName, methodName);
      const rawGroups = readSaxAttribute(attributes, 'groups').trim();
      testCases.push({
        className: currentClass,
        caseName: listedName,
        methodName,
        ...(dataSetName ? { dataSetName } : {}),
        ...(dataSetSuffix ? { dataSetSuffix } : {}),
        groups: rawGroups ? rawGroups.split(/\s+/).filter(Boolean) : [],
      });
      return;
    }

    if (name === 'phptfile' && parent === 'tests') {
      const filePath = readSaxAttribute(attributes, 'path').trim();
      if (filePath) {
        phptFiles.push({ path: filePath });
      }
    }
    elementStack.push(name);
  };

  parser.onclosetag = (rawName) => {
    const name = rawName.toLowerCase();
    if (name === 'testcaseclass') {
      currentClass = undefined;
    } else if (name === 'tests') {
      rootClosed = true;
    }
    if (elementStack[elementStack.length - 1] === name) {
      elementStack.pop();
    }
  };
  parser.onerror = (error) => {
    throw error;
  };

  parser.write(xml).close();
  if (!rootSeen || !rootClosed) {
    throw new Error('PHPUnit test listing is incomplete.');
  }

  return { testCases, phptFiles };
}

/**
 * Connects runtime class/method identities to files discovered by the static
 * parser. Runtime entries that cannot be mapped are omitted rather than being
 * assigned a guessed source file.
 */
export function reconcileRuntimeTestListing(
  listing: RuntimeTestListing,
  parsedFiles: readonly ParsedTestFile[],
): ReconciledRuntimeTest[] {
  const locationsByClassAndMethod = new Map<string, string[]>();

  for (const parsedFile of parsedFiles) {
    for (const testClass of parsedFile.classes) {
      const normalizedClassName = normalizeClassName(testClass.fullyQualifiedName);
      for (const method of testClass.methods) {
        const baseMethodName = methodNameFromTestCase(method.name);
        const key = runtimeMethodKey(normalizedClassName, baseMethodName);
        const files = locationsByClassAndMethod.get(key) ?? [];
        if (!files.includes(parsedFile.filePath)) {
          files.push(parsedFile.filePath);
          locationsByClassAndMethod.set(key, files);
        }
      }
    }
  }

  const reconciled: ReconciledRuntimeTest[] = [];
  for (const testCase of listing.testCases) {
    const files = locationsByClassAndMethod.get(
      runtimeMethodKey(normalizeClassName(testCase.className), testCase.methodName),
    );
    if (!files || files.length !== 1) {
      continue;
    }

    const identity = `${normalizeClassName(testCase.className)}::${testCase.methodName}`
      + (testCase.dataSetSuffix
        ? ` ${testCase.dataSetSuffix}`
        : (testCase.dataSetName ? ` with data set ${testCase.dataSetName}` : ''));
    reconciled.push({ ...testCase, filePath: files[0], identity });
  }

  return reconciled;
}

function runtimeMethodKey(className: string, methodName: string): string {
  return `${className.toLowerCase()}::${methodName.toLowerCase()}`;
}
