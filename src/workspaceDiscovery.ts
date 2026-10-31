export type WorkspaceSearch<TScope, TResult> = (
  pattern: string,
  excludeGlob: string | undefined,
  scope: TScope | undefined,
) => Promise<TResult[]>;

export async function findWithGlobs<TScope, TResult>(
  includes: string[],
  excludes: string[],
  unique: Map<string, TResult>,
  scope: TScope | undefined,
  search: WorkspaceSearch<TScope, TResult>,
  keyOf: (result: TResult) => string,
): Promise<TResult[]> {
  const excludeGlob = excludes.length > 0 ? `{${excludes.join(',')}}` : undefined;
  for (const pattern of includes) {
    const results = await search(pattern, excludeGlob, scope);
    for (const result of results) {
      unique.set(keyOf(result), result);
    }
  }
  return [...unique.values()];
}
