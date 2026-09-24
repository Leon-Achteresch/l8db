function isWordStart(text: string, index: number) {
  if (index === 0) return true;
  const previous = text[index - 1];
  return (
    !/[a-z0-9]/i.test(previous) ||
    (previous === previous.toLowerCase() && text[index] !== text[index].toLowerCase())
  );
}

export function mayMatchWord(candidate: string, word: string): boolean {
  if (!word) return true;
  const text = candidate.toLowerCase();
  const pattern = word.toLowerCase();
  let position = -1;
  for (
    let start = text.indexOf(pattern[0]);
    start !== -1;
    start = text.indexOf(pattern[0], start + 1)
  ) {
    if (isWordStart(candidate, start)) {
      position = start;
      break;
    }
  }
  if (position === -1) return false;
  for (let i = 1; i < pattern.length; i++) {
    position = text.indexOf(pattern[i], position + 1);
    if (position === -1) return false;
  }
  return true;
}
