/** Use the drawing title, never the sheet number or PDF page index, as level evidence. */
export function roomLevelName(
  title: string | null | undefined,
  sheetName: string,
): string {
  const words: Record<string, number> = {
    one: 1,
    first: 1,
    two: 2,
    second: 2,
    three: 3,
    third: 3,
    four: 4,
    fourth: 4,
    five: 5,
    fifth: 5,
    six: 6,
    sixth: 6,
    seven: 7,
    seventh: 7,
    eight: 8,
    eighth: 8,
    nine: 9,
    ninth: 9,
    ten: 10,
    tenth: 10,
    eleven: 11,
    eleventh: 11,
    twelve: 12,
    twelfth: 12,
  };
  for (const source of [title, sheetName]) {
    if (!source?.trim()) continue;
    const text = source
      .replace(/[_–—-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const names = new Set<string>();
    for (const match of text.matchAll(
      /\b(?:(mechanical|electrical)\s+)?penthouse\b|\b(basement|mezzanine|lower ground|ground floor|ground level|roof)\b/gi,
    )) {
      const special = match[0].toLowerCase();
      names.add(
        special === "ground floor" || special === "ground level"
          ? "Level 1"
          : special.replace(/\b\w/g, (letter) => letter.toUpperCase()),
      );
    }
    const token = `(?:\\d+(?:st|nd|rd|th)?|${Object.keys(words).join("|")})`;
    const patterns = [
      new RegExp(`\\b(?:level|floor)\\s+(${token})\\b`, "gi"),
      new RegExp(`\\b(${token})\\s+(?:floor|level)\\b`, "gi"),
    ];
    for (const pattern of patterns)
      for (const match of text.matchAll(pattern)) {
        const value = match[1]!.toLowerCase();
        names.add(`Level ${words[value] ?? parseInt(value, 10)}`);
      }
    // Multiple levels on a sheet must not silently become just one of them.
    if (names.size > 1) return source.trim();
    if (names.size === 1) return [...names][0]!;
  }
  return title?.trim() ? title.trim() : sheetName;
}
