type ProtectedToken = { value: string };

// Preserve identifiers and destinations while the model translates prose.
const PROTECTED_TOKEN_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'\u3001\u3002\uff0c\uff1b\uff09\uff3d\]]+|(?:doi:\s*)?10\.\d{4,9}\/[\w.()/:;+-]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gi;

export function protectTranslationTokens(value: string): { text: string; restore: (translated: string) => string } {
  const tokens: ProtectedToken[] = [];
  const text = value.replace(PROTECTED_TOKEN_PATTERN, (match) => {
    const index = tokens.push({ value: match }) - 1;
    return `__KEEP_TOKEN_${index}__`;
  });
  return {
    text,
    restore: (translated) => translated.replace(/__KEEP_TOKEN_(\d+)__/gi, (placeholder, rawIndex) => tokens[Number(rawIndex)]?.value || placeholder),
  };
}
