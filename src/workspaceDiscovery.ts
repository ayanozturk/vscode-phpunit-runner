export type WorkspaceSearch<TScope, TResult> = (
  pattern: string,
  excludeGlob: string | undefined,
  scope: TScope | undefined,
) => Promise<TResult[]>;

export async function findAcrossScopes<TScope, TResult>(
  scopes: readonly TScope[],
  search: (scope: TScope) => Promise<TResult[]>,
  keyOf: (result: TResult) => string,
): Promise<TResult[]> {
  const resultsByScope = await Promise.all(scopes.map(search));
  const unique = new Map<string, TResult>();
  for (const results of resultsByScope) {
    for (const result of results) {
      unique.set(keyOf(result), result);
    }
  }
  return [...unique.values()];
}

export async function findWithGlobs<TScope, TResult>(
  includes: string[],
  excludes: string[],
  unique: Map<string, TResult>,
  scope: TScope | undefined,
  search: WorkspaceSearch<TScope, TResult>,
  keyOf: (result: TResult) => string,
): Promise<TResult[]> {
  const excludeGlob = excludes.length > 0 ? `{${excludes.join(',')}}` : undefined;
  const matchesByGlob = await Promise.all(
    // Repeated settings or overlapping suite declarations must not schedule
    // the exact same workspace scan more than once.
    [...new Set(includes)].map((pattern) => search(pattern, excludeGlob, scope)),
  );
  for (const results of matchesByGlob) {
    for (const result of results) {
      unique.set(keyOf(result), result);
    }
  }
  return [...unique.values()];
}
