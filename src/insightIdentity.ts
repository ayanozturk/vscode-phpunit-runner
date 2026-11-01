import { classNamesMatch, datasetSuffixFromTestCase, methodNameFromTestCase } from './parser';
import type { TestTarget } from './types';

export type InsightTestIdentity = {
  className: string;
  caseName: string;
  methodName: string;
  datasetSuffix?: string;
};

/** Parses the persisted workspace::class::case identity used by run history. */
export function parseInsightTestIdentity(
  identity: string,
  workspaceUri?: string,
): InsightTestIdentity | undefined {
  const prefix = workspaceUri ? `${workspaceUri}::` : '';
  if (prefix && !identity.startsWith(prefix)) {
    return undefined;
  }

  const reportIdentity = prefix ? identity.slice(prefix.length) : identity;
  const separator = reportIdentity.indexOf('::');
  if (separator < 1) {
    return undefined;
  }

  const className = reportIdentity.slice(0, separator).trim();
  const caseName = reportIdentity.slice(separator + 2).trim();
  if (!className || !caseName) {
    return undefined;
  }

  const methodName = methodNameFromTestCase(caseName);
  return {
    className,
    caseName,
    methodName,
    ...(datasetSuffixFromTestCase(caseName, methodName)
      ? { datasetSuffix: datasetSuffixFromTestCase(caseName, methodName) }
      : {}),
  };
}

/**
 * Maps persisted report identity to available discovered metadata. A concrete
 * data set is preferred when report and discovery names agree; if that row is
 * unavailable, the containing method remains a useful safe fallback.
 */
export function findInsightTarget<T extends TestTarget>(
  identity: string,
  candidates: readonly T[],
  workspaceUri?: string,
): T | undefined {
  const report = parseInsightTestIdentity(identity, workspaceUri);
  if (!report) {
    return undefined;
  }

  const eligible = candidates.filter((candidate) => (
    (candidate.kind === 'method' || candidate.kind === 'dataset')
    && Boolean(candidate.className)
    && classNamesMatch(candidate.className!, report.className)
  ));

  if (report.datasetSuffix) {
    const dataset = eligible.find((candidate) => (
      (candidate.kind === 'dataset' && sameIdentity(candidate.datasetName, report.caseName))
      || ((candidate.kind === 'method' || candidate.kind === 'dataset')
        && candidate.pestTestName
        && candidate.pestDatasetName
        && sameIdentity(`${candidate.pestTestName} ${candidate.pestDatasetName}`, report.caseName))
    ));
    if (dataset) {
      return dataset;
    }
  }

  return eligible.find((candidate) => (
    candidate.kind === 'method'
    && (sameIdentity(candidate.methodName, report.methodName)
      || sameIdentity(candidate.pestTestName, report.caseName))
  ));
}

function sameIdentity(left: string | undefined, right: string): boolean {
  return left?.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}
