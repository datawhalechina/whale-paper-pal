import { jsonrepair } from "jsonrepair";

export class StructuredJsonParseError extends Error {
  readonly likelyTruncated: boolean;

  constructor(message: string, likelyTruncated = false) {
    super(message);
    this.name = "StructuredJsonParseError";
    this.likelyTruncated = likelyTruncated;
  }
}

function protectLatexBackslashes(value: string): string {
  let result = "";
  let inString = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"') {
      let precedingSlashes = 0;
      for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) precedingSlashes += 1;
      if (precedingSlashes % 2 === 0) inString = !inString;
      result += char;
      continue;
    }

    if (!inString || char !== "\\") {
      result += char;
      continue;
    }

    const next = value[index + 1] || "";
    if (next === "\\" || next === '"' || next === "/") {
      result += char + next;
      index += 1;
      continue;
    }

    const validUnicodeEscape = next === "u" && /^[0-9a-fA-F]{4}$/.test(value.slice(index + 2, index + 6));
    const shortJsonEscape = "bfnrt".includes(next) && !/[A-Za-z]/.test(value[index + 2] || "");
    result += validUnicodeEscape || shortJsonEscape ? char : `\\${char}`;
  }

  return result;
}

function balancedJsonSlice(value: string, start: number): string | null {
  const opener = value[start];
  const closer = opener === "{" ? "}" : opener === "[" ? "]" : "";
  if (!closer) return null;
  const stack = [closer];
  let inString = false;

  for (let index = start + 1; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"') {
      let precedingSlashes = 0;
      for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) precedingSlashes += 1;
      if (precedingSlashes % 2 === 0) inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if (char === stack.at(-1)) {
      stack.pop();
      if (!stack.length) return value.slice(start, index + 1);
    }
  }
  return null;
}

function jsonCandidates(response: string): string[] {
  const cleaned = response
    .replace(/^\uFEFF/, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
  const candidates: string[] = [];
  const add = (candidate: string | null | undefined) => {
    const normalized = candidate?.trim();
    if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
  };

  for (const match of cleaned.matchAll(/```(?:json|jsonc|javascript|js)?\s*([\s\S]*?)```/gi)) add(match[1]);
  add(cleaned);

  const balanced: string[] = [];
  for (let index = 0; index < cleaned.length; index += 1) {
    if (cleaned[index] !== "{" && cleaned[index] !== "[") continue;
    const candidate = balancedJsonSlice(cleaned, index);
    if (candidate) balanced.push(candidate);
  }
  balanced.sort((left, right) => right.length - left.length).forEach(add);

  const starts = [cleaned.indexOf("{"), cleaned.indexOf("[")].filter((value) => value >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (start >= 0 && end >= start) add(cleaned.slice(start, end + 1));
  return candidates;
}

function isStructuredValue(value: unknown): boolean {
  return value !== null && typeof value === "object";
}

function parseCandidate(candidate: string): unknown {
  const protectedCandidate = protectLatexBackslashes(candidate);
  const attempts = [protectedCandidate, candidate];
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown;
      if (isStructuredValue(parsed)) return parsed;
    } catch {
      // Try the repair parser below.
    }
  }
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(jsonrepair(attempt)) as unknown;
      if (isStructuredValue(parsed)) return parsed;
    } catch {
      // Move on to the next extracted candidate.
    }
  }
  return undefined;
}

function looksTruncated(response: string): boolean {
  const cleaned = response.replace(/```\s*$/i, "").trim();
  const start = [cleaned.indexOf("{"), cleaned.indexOf("[")].filter((value) => value >= 0).sort((a, b) => a - b)[0];
  return start !== undefined && balancedJsonSlice(cleaned, start) === null;
}

export function parseStructuredJson<T>(response: string): T {
  const normalizedEnd = response.replace(/```\s*$/i, "").trim();
  const likelyTruncated = looksTruncated(response);
  if (likelyTruncated && /(?:[:\[\{,]|\\)\s*$/.test(normalizedEnd)) {
    throw new StructuredJsonParseError("模型返回的结构化数据不完整，可能达到了输出长度上限。", true);
  }
  for (const candidate of jsonCandidates(response)) {
    const parsed = parseCandidate(candidate);
    if (parsed !== undefined) return parsed as T;
  }
  throw new StructuredJsonParseError(
    likelyTruncated
      ? "模型返回的结构化数据不完整，可能达到了输出长度上限。"
      : "模型返回的结构化数据格式有误，自动修复后仍无法解析。",
    likelyTruncated,
  );
}
