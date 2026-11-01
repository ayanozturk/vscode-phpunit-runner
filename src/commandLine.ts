/** Splits a simple command line into argv words while preserving quoted whitespace. */
export function splitCommandLine(value: string): string[] {
  const words: string[] = [];
  let word = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;
  let wordStarted = false;

  const finishWord = () => {
    if (wordStarted) {
      words.push(word);
      word = '';
      wordStarted = false;
    }
  };

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const next = value[index + 1];

    if (escaped) {
      word += character;
      wordStarted = true;
      escaped = false;
      continue;
    }

    if (quote === "'") {
      if (character === "'") {
        quote = undefined;
      } else {
        word += character;
      }
      wordStarted = true;
      continue;
    }

    if (quote === '"') {
      if (character === '"') {
        quote = undefined;
      } else if (character === '\\' && next === '"') {
        escaped = true;
      } else {
        word += character;
      }
      wordStarted = true;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      wordStarted = true;
    } else if (character === '\\' && next && (/[\s'"]/.test(next))) {
      escaped = true;
      wordStarted = true;
    } else if (/\s/.test(character)) {
      finishWord();
    } else {
      word += character;
      wordStarted = true;
    }
  }

  if (quote) {
    throw new Error('phpunitRunner.phpunitCommand contains an unterminated quote.');
  }
  if (escaped) {
    word += '\\';
  }
  finishWord();
  return words;
}
