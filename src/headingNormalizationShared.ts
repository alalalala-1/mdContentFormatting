export const ARABIC_DEPTH_PATTERN = /^(\d+(?:\.\d+)*)\b/;

export type HeadingPrefixKind =
  | "none"
  | "chinese_numeric"
  | "arabic_single"
  | "arabic_path"
  | "alpha_compound_lower"
  | "alpha_compound_upper"
  | "alpha_single_lower"
  | "alpha_single_upper";

export type HeadingPrefixTerminator = "none" | "dot" | "dunhao" | "paren" | "paren_dot" | "whitespace";

export type HeadingMarker = {
  kind: HeadingPrefixKind;
  rawPrefix: string;
  terminator: HeadingPrefixTerminator;
  logicalDepth: number | null;
  numericPath: number[] | null;
  numericValue: number | null;
  alphaValue: string | null;
};

export type HeadingNumberingFamily = "none" | "arabic" | "chinese" | "alpha_lower" | "alpha_upper";
export type HeadingMarkerStrength = "none" | "weak_explicit" | "ordered_explicit" | "structured";

export function clampHeadingLevel(level: number): number {
  if (level < 1) return 1;
  if (level > 6) return 6;
  return level;
}

export function parseArabicPrimary(text: string): number | null {
  const match = text.match(ARABIC_DEPTH_PATTERN);
  if (!match) return null;
  const first = match[1].split(".")[0];
  const value = Number(first);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function parseChineseNumeral(text: string): number | null {
  const digitMap: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    壹: 1,
    贰: 2,
    叁: 3,
    肆: 4,
    伍: 5,
    陆: 6,
    柒: 7,
    捌: 8,
    玖: 9
  };
  const unitMap: Record<string, number> = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000 };
  let total = 0;
  let current = 0;
  for (const char of text) {
    if (char in digitMap) {
      current = digitMap[char];
      continue;
    }
    if (char in unitMap) {
      const unit = unitMap[char];
      if (current === 0) current = 1;
      total += current * unit;
      current = 0;
      continue;
    }
    return null;
  }
  total += current;
  return total > 0 ? total : null;
}

function normalizeHeadingPrefixTerminator(raw: string): HeadingPrefixTerminator {
  if (raw === ".") return "dot";
  if (raw === "、") return "dunhao";
  if (raw === ")" || raw === "）") return "paren";
  if (raw === ")." || raw === "）." || raw === ")．" || raw === "）．") return "paren_dot";
  if (raw.length === 0) return "whitespace";
  return "none";
}

export function parseHeadingMarker(text: string): HeadingMarker {
  const trimmed = text.trimStart();

  const alphaCompoundMatch = trimmed.match(/^([A-Za-z])[.．](\d+(?:\.\d+)*)(\.?)(?=\s|$)/);
  if (alphaCompoundMatch) {
    const alphaValue = alphaCompoundMatch[1];
    const alphaIndex = alphaValue.toLowerCase().charCodeAt(0) - 96;
    const numericTail = alphaCompoundMatch[2].split(".").map((part) => Number(part));
    return {
      kind: /^[a-z]$/.test(alphaValue) ? "alpha_compound_lower" : "alpha_compound_upper",
      rawPrefix: alphaCompoundMatch[0],
      terminator: alphaCompoundMatch[3] === "." ? "dot" : "whitespace",
      logicalDepth: numericTail.length + 1,
      numericPath: [alphaIndex, ...numericTail],
      numericValue: alphaIndex,
      alphaValue
    };
  }

  const arabicPathMatch = trimmed.match(/^(\d+(?:\.\d+)+)(\.?)(?=\s|$)/);
  if (arabicPathMatch) {
    const numericPath = arabicPathMatch[1].split(".").map((part) => Number(part));
    return {
      kind: "arabic_path",
      rawPrefix: arabicPathMatch[0],
      terminator: arabicPathMatch[2] === "." ? "dot" : "whitespace",
      logicalDepth: numericPath.length,
      numericPath,
      numericValue: numericPath[0] ?? null,
      alphaValue: null
    };
  }

  const chineseMatch = trimmed.match(/^([零〇一二两三四五六七八九十百千壹贰叁肆伍陆柒捌玖拾佰仟]+)(?:([、.．:：)）])|(\s+))/);
  if (chineseMatch) {
    const numericValue = parseChineseNumeral(chineseMatch[1]);
    if (numericValue !== null) {
      return {
        kind: "chinese_numeric",
        rawPrefix: chineseMatch[0],
        terminator: chineseMatch[2] ? normalizeHeadingPrefixTerminator(chineseMatch[2]) : "whitespace",
        logicalDepth: 1,
        numericPath: [numericValue],
        numericValue,
        alphaValue: null
      };
    }
  }

  const arabicSingleMatch = trimmed.match(/^(\d+)(?:([.)、])(?=\s*\S|$)|(\s+)(?=\S|$)|$)/);
  if (arabicSingleMatch) {
    const numericValue = Number(arabicSingleMatch[1]);
    if (Number.isFinite(numericValue) && numericValue > 0) {
      return {
        kind: "arabic_single",
        rawPrefix: arabicSingleMatch[0],
        terminator: arabicSingleMatch[2] ? normalizeHeadingPrefixTerminator(arabicSingleMatch[2]) : arabicSingleMatch[3] ? "whitespace" : "none",
        logicalDepth: 1,
        numericPath: [numericValue],
        numericValue,
        alphaValue: null
      };
    }
  }

  const alphaValue = trimmed.charAt(0);
  if (/^[A-Za-z]$/.test(alphaValue)) {
    const rest = trimmed.slice(1);
    let rawPrefix = "";
    let terminator: HeadingPrefixTerminator | null = null;
    if (/^[)）][.．]/.test(rest)) {
      rawPrefix = `${alphaValue}${rest.slice(0, 2)}`;
      terminator = "paren_dot";
    } else if (/^[)）]/.test(rest)) {
      rawPrefix = `${alphaValue}${rest[0]}`;
      terminator = "paren";
    } else if (/^[.．]/.test(rest)) {
      rawPrefix = `${alphaValue}${rest[0]}`;
      terminator = "dot";
    } else {
      const whitespaceMatch = rest.match(/^(\s+)(?=\S|$)/);
      if (whitespaceMatch) {
        rawPrefix = `${alphaValue}${whitespaceMatch[1]}`;
        terminator = "whitespace";
      }
    }
    if (terminator !== null) {
      return {
        kind: /^[a-z]$/.test(alphaValue) ? "alpha_single_lower" : "alpha_single_upper",
        rawPrefix,
        terminator,
        logicalDepth: 1,
        numericPath: null,
        numericValue: null,
        alphaValue
      };
    }
  }

  return {
    kind: "none",
    rawPrefix: "",
    terminator: "none",
    logicalDepth: null,
    numericPath: null,
    numericValue: null,
    alphaValue: null
  };
}

export function getHeadingMarkerFamily(marker: HeadingMarker): HeadingNumberingFamily {
  switch (marker.kind) {
    case "arabic_single":
    case "arabic_path":
      return "arabic";
    case "chinese_numeric":
      return "chinese";
    case "alpha_single_lower":
    case "alpha_compound_lower":
      return "alpha_lower";
    case "alpha_single_upper":
    case "alpha_compound_upper":
      return "alpha_upper";
    default:
      return "none";
  }
}

export function isStructuredHeadingMarker(marker: HeadingMarker): boolean {
  if (marker.kind === "arabic_path") return true;
  if (marker.kind === "chinese_numeric") return true;
  if (marker.kind === "arabic_single") return marker.terminator !== "none";
  if (marker.kind === "alpha_compound_lower" || marker.kind === "alpha_compound_upper") return true;
  return false;
}

export function getHeadingMarkerStrength(marker: HeadingMarker): HeadingMarkerStrength {
  if (isStructuredHeadingMarker(marker)) return "structured";
  if (
    (marker.kind === "alpha_single_lower" || marker.kind === "alpha_single_upper") &&
    marker.terminator !== "whitespace" &&
    marker.terminator !== "none"
  ) {
    return "ordered_explicit";
  }
  if (marker.kind !== "none") return "weak_explicit";
  return "none";
}

export function getAlphaSequenceValue(marker: HeadingMarker): number | null {
  if (
    marker.kind !== "alpha_single_lower" &&
    marker.kind !== "alpha_single_upper" &&
    marker.kind !== "alpha_compound_lower" &&
    marker.kind !== "alpha_compound_upper"
  ) {
    return null;
  }
  if (marker.alphaValue === null) {
    return null;
  }
  const normalized = marker.alphaValue?.toLowerCase() ?? "";
  if (!/^[a-z]$/.test(normalized)) return null;
  return normalized.charCodeAt(0) - 96;
}

export function formatAlphaSequenceValue(
  family: HeadingNumberingFamily,
  value: number,
  terminator: HeadingPrefixTerminator
): string {
  const clamped = Math.max(1, Math.min(26, value));
  const base = String.fromCharCode((family === "alpha_upper" ? 64 : 96) + clamped);
  switch (terminator) {
    case "dot":
      return `${base}.`;
    case "paren":
      return `${base})`;
    case "paren_dot":
      return `${base}).`;
    default:
      return base;
  }
}

export function stripAlphaHeadingPrefix(text: string): string {
  return text.replace(/^\s*[A-Za-z](?:[.．]|[)）](?:[.．])?|\s)+/, "").trim();
}

export function stripAlphaCompositeHeadingPrefix(text: string): string {
  return text.replace(/^\s*[A-Za-z][.．]\d+(?:\.\d+)*(?:\.)?(?:\s+|$)/, "").trim();
}

export function formatAlphaCompositeHeadingPath(family: HeadingNumberingFamily, path: number[]): string {
  if (path.length === 0) return "";
  const alphaPrefix = formatAlphaSequenceValue(family, path[0], "dot");
  if (path.length === 1) return alphaPrefix;
  return `${alphaPrefix}${path.slice(1).join(".")}`;
}

export function parseChineseHeadingPrefixNumber(text: string): number | null {
  const marker = parseHeadingMarker(text);
  return marker.kind === "chinese_numeric" ? marker.numericValue : null;
}

export function parseHeadingDepthByArabicNumber(text: string): number | null {
  const marker = parseHeadingMarker(text);
  return marker.kind === "arabic_path" ? marker.logicalDepth : null;
}

export function parseArabicHeadingPath(text: string): number[] | null {
  const marker = parseHeadingMarker(text);
  return marker.kind === "arabic_path" ? marker.numericPath : null;
}

export function parseSingleNumericHeadingPrefix(text: string): number | null {
  const marker = parseHeadingMarker(text);
  return marker.kind === "arabic_single" && marker.terminator !== "none" ? marker.numericValue : null;
}

export function hasExplicitHeadingPrefix(text: string): boolean {
  return parseHeadingMarker(text).kind !== "none";
}

export function stripChineseHeadingPrefix(text: string): string {
  return text.replace(/^\s*[零〇一二两三四五六七八九十百千壹贰叁肆伍陆柒捌玖拾佰仟]+(?:[、.．:：)）]|\s)+/, "").trim();
}

export function stripArabicHeadingPrefix(text: string): string {
  return text.replace(/^\s*\d+(?:\.\d+)*(?:\.)?(?:\s+|$)/, "").trim();
}

export function normalizeHeadingSemanticText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[（【《「『][^）】》」』]*[）】》」』]/g, " ")
    .replace(/[\s_\-—–:：,.，;；!?！？'"“”‘’`~·•/\\|[\]{}<>]+/g, "");
}

export function isSpecialSectionHeading(text: string): boolean {
  const normalized = normalizeHeadingSemanticText(text);
  const hasKeyConclusion =
    (normalized.includes("关键结论") && normalized.includes("知识点总结")) ||
    (normalized.includes("keyconclusions") && normalized.includes("knowledgesummary"));
  const hasGlossary =
    (normalized.includes("专业术语") &&
      (normalized.includes("中英文对照") || normalized.includes("关键词") || normalized.includes("tag"))) ||
    (normalized.includes("glossary") && (normalized.includes("tag") || normalized.includes("keyword")));
  const hasSectionSummary = normalized.includes("本节小结") || normalized.includes("summaryofthissection");
  const hasEasyConfuse = normalized.includes("容易混淆") || normalized.includes("easytoconfuse");
  const hasLearningReview = normalized.includes("学习主线") || normalized.includes("learningthreadreview");
  const hasMistakeCorrection =
    (normalized.includes("典型错误") && normalized.includes("纠正")) ||
    (normalized.includes("typicalmistakes") && normalized.includes("correction"));
  return hasKeyConclusion || hasGlossary || hasSectionSummary || hasEasyConfuse || hasLearningReview || hasMistakeCorrection;
}

export function getHeadingSequenceCounterKey(parentPath: number[] | null, level: number): string {
  if (!parentPath || parentPath.length === 0) return `root->${level}`;
  return `${parentPath.join(".")}->${level}`;
}

export function normalizeExplicitArabicHeadingPath(
  explicitPath: number[],
  level: number,
  numberedPathByLevel: Map<number, number[]>,
  siblingCounterByParentPath: Map<string, number>
): number[] {
  if (level <= 1) {
    const counterKey = getHeadingSequenceCounterKey(null, 1);
    const previous = siblingCounterByParentPath.get(counterKey) ?? 0;
    if (previous === 0) return [explicitPath[0]];
    return [previous + 1];
  }

  const parentPath = numberedPathByLevel.get(level - 1);
  if (!parentPath) return explicitPath;
  const counterKey = getHeadingSequenceCounterKey(parentPath, level);
  const previous = siblingCounterByParentPath.get(counterKey) ?? 0;
  const expectedNext = previous + 1;
  const prefixMatches =
    explicitPath.length === parentPath.length + 1 &&
    parentPath.every((segment, index) => explicitPath[index] === segment);
  if (prefixMatches && explicitPath[parentPath.length] === expectedNext) {
    return explicitPath;
  }
  return [...parentPath, expectedNext];
}
