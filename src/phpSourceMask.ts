/** Masks PHP strings, comments, and heredoc bodies while preserving source offsets. */
export function maskPhpNonCode(source: string): string {
  const chars = source.split('');
  let quote = '';
  let lineComment = false;
  let blockComment = false;
  let heredocLabel: string | undefined;

  const mask = (index: number) => {
    if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' ';
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] ?? '';
    const prev = source[index - 1] ?? '';

    if (heredocLabel) {
      mask(index);
      if (index === 0 || prev === '\n') {
        let markerStart = index;
        while (source[markerStart] === '\t' || source[markerStart] === ' ') markerStart += 1;
        const markerEnd = markerStart + heredocLabel.length;
        const nextMarkerChar = source[markerEnd] ?? '';
        if (source.startsWith(heredocLabel, markerStart) && !/[A-Za-z0-9_]/.test(nextMarkerChar)) {
          for (let offset = 0; offset < markerEnd - index; offset += 1) mask(index + offset);
          index = markerEnd - 1;
          heredocLabel = undefined;
        }
      }
      continue;
    }

    if (lineComment) {
      mask(index);
      if (char === '\n') lineComment = false;
      continue;
    }

    if (blockComment) {
      mask(index);
      if (prev === '*' && char === '/') blockComment = false;
      continue;
    }

    if (quote) {
      mask(index);
      if (char === '\\') {
        if (index + 1 < source.length) {
          mask(index + 1);
          index += 1;
        }
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }

    if ((char === '/' && next === '/') || (char === '#' && next !== '[')) {
      lineComment = true;
      mask(index);
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      mask(index);
      continue;
    }

    if (source.startsWith('<<<', index)) {
      const heredocStart = source.slice(index).match(/^<<<[\t ]*(?:(['"])([A-Za-z_][A-Za-z0-9_]*)\1|([A-Za-z_][A-Za-z0-9_]*))[\t ]*\r?\n/);
      if (heredocStart) {
        heredocLabel = heredocStart[2] ?? heredocStart[3];
        for (let offset = 0; offset < heredocStart[0].length; offset += 1) mask(index + offset);
        index += heredocStart[0].length - 1;
        continue;
      }
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      mask(index);
    }
  }

  return chars.join('');
}
