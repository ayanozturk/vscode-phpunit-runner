import { quoteTemplateShellArg } from './commandTemplate';

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
  const unresolved = new Set<string>();
  // Substitute the template in one pass. Repeatedly replacing variables can
  // accidentally interpret a placeholder-shaped string inside a quoted path
  // value as a second template variable.
  const command = trimmed.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (placeholder, name: string) => {
    const value = values[name];
    if (value === undefined) {
      unresolved.add(name);
      return placeholder;
    }
    return value;
  });
  if (unresolved.size > 0) {
    throw new Error(
      `Unknown variable(s) in phpunitRunner.remote.reportTransferCommand: ${[...unresolved].join(', ')}.`,
    );
  }

  return command;
}
