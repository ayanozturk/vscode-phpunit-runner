export function unverifiedJUnitMessage(exitCode: number, reportWarning?: string): string | undefined {
  if (exitCode !== 0) {
    return undefined;
  }

  return reportWarning
    ?? 'PHPUnit exited without readable JUnit test cases; test results are unverified.';
}

export function executionDisposition(input: {
  cancelled?: boolean;
  exitCode: number;
  caseCount: number;
}): 'cancelled' | 'unverified' | 'reported' {
  if (input.cancelled) {
    return 'cancelled';
  }
  if (input.exitCode === 0 && input.caseCount === 0) {
    return 'unverified';
  }
  return 'reported';
}
