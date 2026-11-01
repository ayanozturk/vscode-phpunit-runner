import { quoteTemplateShellArg, substituteVariables } from './commandTemplate';

export type RemoteReportTransferPaths = {
  workspaceFolder: string;
  remoteJunitReport: string;
  localJunitReport: string;
  remoteCoverageReport?: string;
  localCoverageReport?: string;
};

/**
 * Renders the optional command used to copy reports from a remote runner to the
 * host. Each supported substitution is quoted as one shell argument.
 */
export function renderRemoteReportTransferCommand(
  template: string,
  paths: RemoteReportTransferPaths,
): string | undefined {
  const trimmed = template.trim();
  if (!trimmed) {
    return undefined;
  }

  if (!trimmed.includes('${remoteJunitReport}') || !trimmed.includes('${localJunitReport}')) {
    throw new Error(
      'phpunitRunner.remote.reportTransferCommand must use ${remoteJunitReport} and ${localJunitReport}.',
    );
  }

  const values = Object.fromEntries(
    Object.entries({
      workspaceFolder: paths.workspaceFolder,
      remoteJunitReport: paths.remoteJunitReport,
      localJunitReport: paths.localJunitReport,
      remoteCoverageReport: paths.remoteCoverageReport ?? '',
      localCoverageReport: paths.localCoverageReport ?? '',
    }).map(([name, value]) => [name, quoteTemplateShellArg(value)]),
  );
  const command = substituteVariables(trimmed, values);
  const unresolved = [...command.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)]
    .map((match) => match[1]);
  if (unresolved.length > 0) {
    throw new Error(
      `Unknown variable(s) in phpunitRunner.remote.reportTransferCommand: ${[...new Set(unresolved)].join(', ')}.`,
    );
  }

  return command;
}
