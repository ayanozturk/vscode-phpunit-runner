export type PathMapping = {
  from: string;
  to: string;
};

export function substituteVariables(template: string, vars: Record<string, string>): string {
  const keys = Object.keys(vars).sort((left, right) => right.length - left.length);
  let result = template;
  for (const key of keys) {
    result = result.split(`\${${key}}`).join(vars[key]);
  }
  return result;
}

export function expandPathMappings(
  record: Record<string, string>,
  vars: Record<string, string>,
): PathMapping[] {
  const mappings: PathMapping[] = Object.entries(record).map(([from, to]) => ({
    from: normalizeMappedPath(substituteVariables(from, vars)),
    to: normalizeMappedPath(substituteVariables(to, vars)),
  }));
  mappings.sort((left, right) => right.from.length - left.from.length);
  return mappings;
}

export function mapWithMappings(value: string, mappings: PathMapping[]): string {
  if (!value || mappings.length === 0) {
    return value;
  }

  const normalized = looksLikePath(value) ? normalizeMappedPath(value) : value;
  for (const mapping of mappings) {
    const mapped = replacePathPrefix(normalized, mapping.from, mapping.to);
    if (mapped !== undefined) {
      return mapped;
    }
  }

  return value;
}

export function unmapWithMappings(value: string, mappings: PathMapping[]): string {
  if (!value || mappings.length === 0) {
    return value;
  }

  const normalized = normalizeMappedPath(value);
  const ordered = [...mappings].sort((left, right) => right.to.length - left.to.length);
  for (const mapping of ordered) {
    const unmapped = replacePathPrefix(normalized, mapping.to, mapping.from);
    if (unmapped !== undefined) {
      return unmapped;
    }
  }

  return value;
}

export function quoteShellArg(value: string): string {
  if (value.length === 0) {
    return '""';
  }
  if (!/[^\w@%+=:,./-]/i.test(value)) {
    return value;
  }
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\$(?=[A-Za-z0-9_{(!#?$*@-])/g, '\\$');
  return `"${escaped}"`;
}

export function joinQuoted(parts: string[]): string {
  return parts.map(quoteShellArg).join(' ');
}

export function quoteTemplateShellArg(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  if (/^[\w@%+=:,./-]+$/i.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function joinTemplateShellArgs(parts: string[]): string {
  return parts.map(quoteTemplateShellArg).join(' ');
}

function looksLikePath(value: string): boolean {
  return value.startsWith('/')
    || value.startsWith('\\')
    || /^[A-Za-z]:[\\/]/.test(value)
    || value.includes('/')
    || value.includes('\\');
}

function normalizeMappedPath(targetPath: string): string {
  return targetPath.replace(/\\/g, '/').replace(/\/+$/, '');
}

function replacePathPrefix(value: string, from: string, to: string): string | undefined {
  const compareCaseInsensitive = isWindowsDrivePath(value) && isWindowsDrivePath(from);
  const comparedValue = compareCaseInsensitive ? value.toLowerCase() : value;
  const comparedFrom = compareCaseInsensitive ? from.toLowerCase() : from;
  if (comparedValue === comparedFrom) {
    return to;
  }
  if (comparedValue.startsWith(`${comparedFrom}/`)) {
    return `${to}${value.slice(from.length)}`;
  }
  return undefined;
}

function isWindowsDrivePath(value: string): boolean {
  return /^[A-Za-z]:\//.test(value);
}
