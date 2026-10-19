export function unverifiedJUnitMessage(exitCode: number, reportWarning?: string): string | undefined {
  if (exitCode !== 0) {
    return undefined;
  }

  return reportWarning
    ?? 'PHPUnit exited without readable JUnit test cases; test results are unverified.';
}
