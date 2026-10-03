export function textCharacters(value: string) {
  const occurrences = new Map<string, number>();
  return Array.from(value, (character) => {
    const occurrence = occurrences.get(character) ?? 0;
    occurrences.set(character, occurrence + 1);
    return { character, id: `${character}-${occurrence}` };
  });
}
