const HEADING_PATTERN = /^\s{0,3}(#{1,6})\s*(.*)$/;
const FENCE_PATTERN = /^\s*```/;
const MATH_BLOCK_PATTERN = /^\s*\$\$\s*$/;
const MATH_BLOCK_START_PATTERN = /^\s*\$\$/;
const ARABIC_DEPTH_PATTERN = /^(\d+(?:\.\d+)*)\b/;
const THEMATIC_BREAK_PATTERN = /^\s*---\s*$/;
const CALLOUT_LINE_PATTERN = /^\s*>/;
const CALLOUT_HEADER_PATTERN = /^\s*>\s*\[![^[\]]+\]/;
const TABLE_SEPARATOR_PATTERN = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;
const PARAGRAPH_START_PATTERN = /^[A-Za-z0-9\u4e00-\u9fff\u3040-\u30ff\u0400-\u04ff"'“”‘’(\[（【《「『]/;
const MARKDOWN_IMAGE_PATTERN = /^\s*!\[[^\]]*]\([^)]+\)\s*$/;
const OBSIDIAN_IMAGE_PATTERN = /^\s*!\[\[[^\]]+]]\s*$/;
const UNORDERED_LIST_LINE_PATTERN = /^(\s*)([-+*])(\s+)(.*)$/;
const LIST_ITEM_PATTERN =
  /^\s{0,3}(?:[-+*]|(?:\d+|[a-zA-Z]+|[ivxlcdmIVXLCDM]+)[.)]|(?:\d+|[a-zA-Z]+)[、]|[(（](?:\d+|[a-zA-Z]+)[)）])\s+/;
const LIST_CONTINUATION_PATTERN = /^\s{2,}\S/;
const HEADING_REVIEW_START = "<!-- MD-FMT-HEADING-REVIEW:START -->";
const HEADING_REVIEW_END = "<!-- MD-FMT-HEADING-REVIEW:END -->";
const HEADING_REVIEW_META_START = "<!-- MD-FMT-HEADING-REVIEW-META";

type BlockType = "heading" | "paragraph" | "list" | "math" | "code" | "thematicBreak" | "callout" | "image" | "table";

type Block = {
  type: BlockType;
  lines: string[];
  paragraphLineCount?: number;
  leadingBlank?: boolean;
  startLine: number;
  endLine: number;
};

function isImageLikeSingleLine(lines: string[]): boolean {
  if (lines.length !== 1) return false;
  const trimmed = lines[0].trim();
  return MARKDOWN_IMAGE_PATTERN.test(trimmed) || OBSIDIAN_IMAGE_PATTERN.test(trimmed);
}

function normalizeImageCalloutGap(markdown: string): string {
  const sourceLines = markdown.split(/\r?\n/);
  const outputLines: string[] = [];
  let index = 0;

  while (index < sourceLines.length) {
    const line = sourceLines[index];
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      outputLines.push(line);
      index += 1;
      continue;
    }

    let nextIndex = index + 1;
    while (nextIndex < sourceLines.length && sourceLines[nextIndex].trim().length === 0) {
      nextIndex += 1;
    }

    const previousNonEmpty = outputLines.length > 0 ? outputLines[outputLines.length - 1].trim() : "";
    const nextNonEmpty = nextIndex < sourceLines.length ? sourceLines[nextIndex].trim() : "";
    const previousIsImage =
      MARKDOWN_IMAGE_PATTERN.test(previousNonEmpty) || OBSIDIAN_IMAGE_PATTERN.test(previousNonEmpty);
    const nextIsCallout = CALLOUT_LINE_PATTERN.test(nextNonEmpty);
    if (previousIsImage && nextIsCallout) {
      index = nextIndex;
      continue;
    }

    if (outputLines.length === 0 || outputLines[outputLines.length - 1].trim().length === 0) {
      index = nextIndex;
      continue;
    }

    outputLines.push("");
    index = nextIndex;
  }

  return outputLines.join("\n");
}

type BlankInsertReason =
  | "beforeHeading"
  | "beforeTable"
  | "beforeThematicBreak"
  | "betweenCallouts"
  | "afterHeading"
  | "afterList"
  | "afterLongParagraph"
  | "afterCallout"
  | "beforeCallout";

type BlankSkipReason = "imageBeforeCallout" | "paragraphOrListBeforeList";

export type FormatStats = {
  headingAdjustedCount: number;
  listMarkerAdjustedCount: number;
  blockCountByType: Record<BlockType, number>;
  insertedBlankCountByReason: Record<BlankInsertReason, number>;
  preservedBlankCountByReason: Record<BlankInsertReason, number>;
  skippedBlankCountByReason: Record<BlankSkipReason, number>;
  paragraphSegmentSplitCount: number;
  multiLineParagraphCount: number;
  blockedAfterLongParagraphByNextType: Record<BlockType, number>;
  insertedAfterLongParagraphByNextType: Record<BlockType, number>;
  paragraphDecisionSamples: string[];
  blankDecisionDetails: string[];
};

type HeadingReviewItem = {
  id: string;
  lineIndex: number;
  original: string;
  suggested: string;
  flag: string;
};

export type HeadingReviewTableBuildResult = {
  text: string;
  itemCount: number;
  replacedExisting: boolean;
};

export type HeadingReviewApplyResult = {
  text: string;
  hasReviewTable: boolean;
  appliedCount: number;
  skippedCount: number;
};

type FrontmatterRange = {
  start: number;
  end: number;
};

function createEmptyStats(): FormatStats {
  return {
    headingAdjustedCount: 0,
    listMarkerAdjustedCount: 0,
    blockCountByType: {
      heading: 0,
      paragraph: 0,
      list: 0,
      math: 0,
      code: 0,
      thematicBreak: 0,
      callout: 0,
      image: 0,
      table: 0
    },
    insertedBlankCountByReason: {
      beforeHeading: 0,
      beforeTable: 0,
      beforeThematicBreak: 0,
      betweenCallouts: 0,
      afterHeading: 0,
      afterList: 0,
      afterLongParagraph: 0,
      afterCallout: 0,
      beforeCallout: 0
    },
    preservedBlankCountByReason: {
      beforeHeading: 0,
      beforeTable: 0,
      beforeThematicBreak: 0,
      betweenCallouts: 0,
      afterHeading: 0,
      afterList: 0,
      afterLongParagraph: 0,
      afterCallout: 0,
      beforeCallout: 0
    },
    skippedBlankCountByReason: {
      imageBeforeCallout: 0,
      paragraphOrListBeforeList: 0
    },
    paragraphSegmentSplitCount: 0,
    multiLineParagraphCount: 0,
    blockedAfterLongParagraphByNextType: {
      heading: 0,
      paragraph: 0,
      list: 0,
      math: 0,
      code: 0,
      thematicBreak: 0,
      callout: 0,
      image: 0,
      table: 0
    },
    insertedAfterLongParagraphByNextType: {
      heading: 0,
      paragraph: 0,
      list: 0,
      math: 0,
      code: 0,
      thematicBreak: 0,
      callout: 0,
      image: 0,
      table: 0
    },
    paragraphDecisionSamples: [],
    blankDecisionDetails: []
  };
}

function pushBlankDecisionDetail(
  stats: FormatStats,
  action: "insert" | "keep" | "blocked" | "skip",
  reasons: string[],
  previous: Block | null,
  current: Block
): void {
  if (stats.blankDecisionDetails.length >= 80) return;
  const previousLast = previous?.lines[previous.lines.length - 1] ?? "";
  const currentFirst = current.lines[0] ?? "";
  stats.blankDecisionDetails.push(
    `${action} reasons=${reasons.join("+")} prevType=${previous?.type ?? "none"} nextType=${current.type} prevRange=${
      previous ? `${previous.startLine}-${previous.endLine}` : "n/a"
    } nextRange=${current.startLine}-${current.endLine} sourceHadBlank=${current.leadingBlank === true} prevLast=${previousLast.slice(
      0,
      60
    )} nextFirst=${currentFirst.slice(0, 60)}`
  );
}

function findFrontmatterRange(lines: string[]): FrontmatterRange | null {
  if (lines.length < 2) return null;
  if (lines[0].trim() !== "---") return null;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      return { start: 0, end: index };
    }
  }
  return null;
}

function isLineInFrontmatter(lineIndex: number, range: FrontmatterRange | null): boolean {
  if (!range) return false;
  return lineIndex >= range.start && lineIndex <= range.end;
}

function clampHeadingLevel(level: number): number {
  if (level < 1) return 1;
  if (level > 6) return 6;
  return level;
}

function parseArabicPrimary(text: string): number | null {
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

function parseChineseHeadingPrefixNumber(text: string): number | null {
  const match = text.match(/^\s*([零〇一二两三四五六七八九十百千壹贰叁肆伍陆柒捌玖拾佰仟]+)(?:[、.．:：)）]|\s)/);
  if (!match) return null;
  return parseChineseNumeral(match[1]);
}

function hasExplicitHeadingPrefix(text: string): boolean {
  if (parseHeadingDepthByArabicNumber(text) !== null) return true;
  if (parseChineseHeadingPrefixNumber(text) !== null) return true;
  if (/^\s*\d+[.)、](?=\s)/.test(text)) return true;
  if (/^\s*[A-Za-z][.)](?:\.)?(?=\s)/.test(text)) return true;
  return false;
}

function stripChineseHeadingPrefix(text: string): string {
  return text.replace(/^\s*[零〇一二两三四五六七八九十百千壹贰叁肆伍陆柒捌玖拾佰仟]+(?:[、.．:：)）]|\s)+/, "").trim();
}

function parseArabicHeadingPath(text: string): number[] | null {
  const depth = parseHeadingDepthByArabicNumber(text);
  if (depth === null) return null;
  const match = text.match(/^\s*(\d+(?:\.\d+)*)/);
  if (!match) return null;
  const parts = match[1].split(".").map((part) => Number(part));
  if (parts.length === 0 || parts.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  return parts;
}

function stripArabicHeadingPrefix(text: string): string {
  return text.replace(/^\s*\d+(?:\.\d+)*(?:\.)?(?:\s+|$)/, "").trim();
}

function getHeadingSequenceCounterKey(parentPath: number[] | null, level: number): string {
  if (!parentPath || parentPath.length === 0) return `root->${level}`;
  return `${parentPath.join(".")}->${level}`;
}

function normalizeExplicitArabicHeadingPath(
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

function parseHeadingDepthByArabicNumber(text: string): number | null {
  if (/^\d+[.)、](?=\s)/.test(text)) return null;
  const match = text.match(ARABIC_DEPTH_PATTERN);
  if (!match) return null;
  const nextChar = text.charAt(match[1].length);
  if (nextChar === ".") return null;
  return match[1].split(".").length;
}

function parseSingleNumericHeadingPrefix(text: string): number | null {
  const match = text.match(/^\s*(\d+)(?:[.)、](?=\s)|\s+(?=\S))/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function shouldIgnoreHashLineAsTagDefinition(line: string, hashes: string, text: string): boolean {
  if (hashes.length !== 1) return false;
  if (!/^\s{0,3}#(?:\s*\S)/.test(line)) return false;
  if (hasChineseLabelWithEnglishTag(text)) return true;
  return false;
}

function shouldRestoreHeadingAsTagDefinition(hashes: string, text: string): boolean {
  if (hashes.length < 1) return false;
  if (!hasChineseLabelWithEnglishTag(text)) return false;
  return true;
}

function hasChineseLabelWithEnglishTag(text: string): boolean {
  const englishTagMatch = text.match(/(?:^|[\s（(])(#([A-Za-z][\w-]*))/);
  if (!englishTagMatch || englishTagMatch.index === undefined) return false;
  const prefix = text.slice(0, englishTagMatch.index);
  return /[\u4e00-\u9fff]/.test(prefix);
}

function matchHeadingLine(line: string): RegExpMatchArray | null {
  const match = line.match(HEADING_PATTERN);
  if (!match) return null;
  if (shouldIgnoreHashLineAsTagDefinition(line, match[1], match[2])) return null;
  return match;
}

function normalizeIgnoredTagDefinitionLine(line: string): string | null {
  const match = line.match(HEADING_PATTERN);
  if (!match) return null;
  if (!shouldIgnoreHashLineAsTagDefinition(line, match[1], match[2])) return null;
  return `#${match[2].trimStart()}`;
}

function normalizeTagDefinitionLines(markdown: string): string {
  const sourceLines = markdown.split(/\r?\n/);
  const frontmatterRange = findFrontmatterRange(sourceLines);
  const outputLines: string[] = [];
  let inCodeFence = false;
  for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex += 1) {
    const rawLine = sourceLines[lineIndex];
    const trimmed = rawLine.trim();
    if (isLineInFrontmatter(lineIndex, frontmatterRange)) {
      outputLines.push(rawLine);
      continue;
    }
    if (FENCE_PATTERN.test(trimmed)) {
      inCodeFence = !inCodeFence;
      outputLines.push(rawLine);
      continue;
    }
    if (inCodeFence) {
      outputLines.push(rawLine);
      continue;
    }
    const normalizedIgnoredLine = normalizeIgnoredTagDefinitionLine(rawLine);
    if (normalizedIgnoredLine) {
      outputLines.push(normalizedIgnoredLine);
      continue;
    }
    const headingMatch = rawLine.match(HEADING_PATTERN);
    if (!headingMatch || !shouldRestoreHeadingAsTagDefinition(headingMatch[1], headingMatch[2])) {
      outputLines.push(rawLine);
      continue;
    }
    let restoredText = headingMatch[2].trimStart();
    if (parseArabicHeadingPath(restoredText) !== null) {
      const stripped = stripArabicHeadingPrefix(restoredText);
      if (stripped.length > 0) restoredText = stripped;
    } else if (parseChineseHeadingPrefixNumber(restoredText) !== null) {
      const stripped = stripChineseHeadingPrefix(restoredText);
      if (stripped.length > 0) restoredText = stripped;
    }
    outputLines.push(`#${restoredText}`);
  }
  return outputLines.join("\n");
}

function normalizeHeadingSemanticText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[（【《「『][^）】》」』]*[）】》」』]/g, " ")
    .replace(/[\s_\-—–:：,.，;；!?！？'"“”‘’`~·•/\\|[\]{}<>]+/g, "");
}

function isSpecialSectionHeading(text: string): boolean {
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

function splitParagraphLines(lines: string[]): string[][] {
  if (lines.length < 3) return [lines];
  const segments: string[][] = [];
  let currentSegment: string[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    currentSegment.push(lines[lineIndex]);
    const nextLine = lines[lineIndex + 1];
    if (!nextLine) {
      segments.push(currentSegment);
      break;
    }

    const nextTrimmed = nextLine.trim();
    const currentLastLine = currentSegment[currentSegment.length - 1]?.trim() ?? "";
    const isCurrentLastLineFragment = isLikelyInlineFragment(currentLastLine) && currentSegment.length >= 2;
    const hasCjkContext = /[\u4e00-\u9fff]/u.test(currentLastLine) || /[\u4e00-\u9fff]/u.test(nextTrimmed);
    const currentHasStrongSentenceEnding = /[。！？.!?]["'”’）)\]]*$/.test(currentLastLine);
    const currentLooksLongEnough = hasCjkContext ? currentLastLine.length >= 6 : currentLastLine.length >= 28;
    const nextLooksLongEnough = hasCjkContext ? nextTrimmed.length >= 4 : nextTrimmed.length >= 18;
    const shouldSplit =
      currentSegment.length >= 2 &&
      PARAGRAPH_START_PATTERN.test(nextTrimmed) &&
      currentHasStrongSentenceEnding &&
      currentLooksLongEnough &&
      nextLooksLongEnough &&
      !isCurrentLastLineFragment &&
      !isLikelyInlineFragment(nextTrimmed);
    if (shouldSplit) {
      segments.push(currentSegment);
      currentSegment = [];
    }
  }

  if (segments.length === 0) return [lines];
  return segments;
}

function isShortStandaloneInlineMathToken(text: string): boolean {
  const trimmed = text.trim();
  const match = trimmed.match(/^\$([^$\n]+)\$$/);
  if (!match) return false;
  const body = match[1].trim();
  if (body.length === 0 || body.length > 8) return false;
  if (/\\/.test(body)) return false;
  if (/[=<>]/.test(body)) return false;
  return true;
}

function isLikelyInlineFragment(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (/^\$[^$\n]+\$$/.test(trimmed)) return isShortStandaloneInlineMathToken(trimmed);
  if (trimmed.startsWith("$") || trimmed.endsWith("$")) return true;
  if (/^[\p{P}\p{S}]+$/u.test(trimmed)) return true;
  if (/^\p{L}$/u.test(trimmed) && !/[\u4e00-\u9fff]/u.test(trimmed)) return true;
  if (trimmed.length <= 12 && !/\s/u.test(trimmed) && !/[\u4e00-\u9fff]/u.test(trimmed)) {
    if (/^[\p{L}\p{N}\p{P}\p{S}]+$/u.test(trimmed)) return true;
  }
  return false;
}

function hasHardSentenceStop(text: string): boolean {
  return /[。！？.!?;；:]["'”’）)\]]*$/.test(text.trim());
}

function appendInlineText(base: string, extra: string): string {
  const trimmedBase = base.trimEnd();
  const trimmedExtra = extra.trim();
  if (trimmedExtra.length === 0) return trimmedBase;
  if (/^[,.;:!?，。；：！？）)\]】》]/u.test(trimmedExtra)) return `${trimmedBase}${trimmedExtra}`;
  return `${trimmedBase} ${trimmedExtra}`.replace(/\s+/g, " ").replace(/\s+([,.;:!?，。；：！？])/gu, "$1");
}

function mergeInlineFragmentLines(lines: string[]): string[] {
  if (lines.length <= 1) return lines;
  const merged: string[] = [];
  let pendingContinuationFromFragment = false;

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const currentTrimmed = current.trim();
    if (currentTrimmed.length === 0) {
      merged.push(current);
      pendingContinuationFromFragment = false;
      continue;
    }

    if (merged.length > 0) {
      const previous = merged[merged.length - 1];
      const previousTrimmed = previous.trim();
      if (pendingContinuationFromFragment && !hasHardSentenceStop(previousTrimmed)) {
        merged[merged.length - 1] = appendInlineText(previous, currentTrimmed);
        pendingContinuationFromFragment = false;
        continue;
      }
      const previousIsInlineFragment = isLikelyInlineFragment(previousTrimmed) && !hasHardSentenceStop(previousTrimmed);
      if (previousIsInlineFragment) {
        merged[merged.length - 1] = appendInlineText(previous, currentTrimmed);
        pendingContinuationFromFragment = false;
        continue;
      }
    }

    if (isLikelyInlineFragment(currentTrimmed) && merged.length > 0) {
      const previous = merged[merged.length - 1];
      if (!hasHardSentenceStop(previous)) {
        merged[merged.length - 1] = appendInlineText(previous, currentTrimmed);
        pendingContinuationFromFragment = true;
        continue;
      }
    }

    merged.push(current);
    pendingContinuationFromFragment = isLikelyInlineFragment(currentTrimmed);
  }

  return merged;
}

function extractShortInlineMath(lines: string[]): string | null {
  if (lines.length === 1) {
    const single = lines[0].trim();
    const match = single.match(/^\$\$\s*(.+?)\s*\$\$$/);
    if (!match) return null;
    const body = match[1].trim();
    if (!isLikelyInlineMathBody(body)) return null;
    return body;
  }
  if (lines.length !== 3) return null;
  if (lines[0].trim() !== "$$" || lines[2].trim() !== "$$") return null;
  const body = lines[1].trim();
  if (!isLikelyInlineMathBody(body)) return null;
  return body;
}

function isLikelyInlineMathBody(body: string): boolean {
  if (body.length === 0 || body.length > 24) return false;
  if (/\n/.test(body)) return false;
  if (/\s/.test(body)) return false;
  if (/[=<>]/.test(body)) return false;
  if (/\\(?:frac|sum|int|begin|end)\b/.test(body)) return false;
  if (/^[\p{L}\p{N}\p{P}\p{S}]+$/u.test(body)) return true;
  return false;
}

function mergeInlineFragmentParagraphBlocks(blocks: Block[]): Block[] {
  const merged: Block[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const current = blocks[index];
    const previous = merged.length > 0 ? merged[merged.length - 1] : null;
    const next = index + 1 < blocks.length ? blocks[index + 1] : null;
    const currentFirst = current.lines[0]?.trim() ?? "";
    const currentIsInlineFragmentParagraph =
      current.type === "paragraph" &&
      (current.paragraphLineCount ?? 0) === 1 &&
      current.leadingBlank !== true &&
      isLikelyInlineFragment(currentFirst);
    const canMergeWithPrevious =
      previous !== null &&
      previous.type === "paragraph" &&
      !hasHardSentenceStop(previous.lines[previous.lines.length - 1] ?? "");

    if (currentIsInlineFragmentParagraph && canMergeWithPrevious) {
      const previousLastLine = previous.lines[previous.lines.length - 1] ?? "";
      previous.lines[previous.lines.length - 1] = appendInlineText(previousLastLine, currentFirst);
      previous.endLine = current.endLine;
      previous.paragraphLineCount = previous.lines.length;

      const canMergeNextParagraphIntoSameLine =
        next !== null &&
        next.type === "paragraph" &&
        next.leadingBlank !== true &&
        !hasHardSentenceStop(currentFirst) &&
        (!/^\$[^$\n]+\$$/.test(currentFirst) || isShortStandaloneInlineMathToken(currentFirst));
      if (canMergeNextParagraphIntoSameLine) {
        const nextFirst = next.lines[0]?.trim() ?? "";
        if (nextFirst.length > 0) {
          previous.lines[previous.lines.length - 1] = appendInlineText(previous.lines[previous.lines.length - 1], nextFirst);
        }
        if (next.lines.length > 1) {
          previous.lines.push(...next.lines.slice(1));
        }
        previous.endLine = next.endLine;
        previous.paragraphLineCount = previous.lines.length;
        index += 1;
      }

      continue;
    }

    merged.push(current);
  }
  return merged;
}

function isTableHeaderLine(text: string): boolean {
  if (!text.includes("|")) return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (trimmed === "|") return false;
  return trimmed.startsWith("|") || trimmed.endsWith("|");
}

function normalizeHeadingLine(
  line: string,
  previousHeadingLevel: number | null,
  latestNumberedHeadingLevel: number | null,
  latestSecondLevelNumberedHeadingLevel: number | null,
  nextArabicPrimary: number | null
): {
  level: number;
  isNumbered: boolean;
  arabicDepth: number | null;
  rawText: string;
  sourceLevel: number;
  chinesePrefixNumber: number | null;
  singleNumericPrefix: number | null;
  inferredParentByChinese: boolean;
} {
  const match = matchHeadingLine(line);
  if (!match) {
    return {
      level: previousHeadingLevel ?? 1,
      isNumbered: false,
      arabicDepth: null,
      rawText: line,
      sourceLevel: 1,
      chinesePrefixNumber: null,
      singleNumericPrefix: null,
      inferredParentByChinese: false
    };
  }

  const rawText = match[2].trim();
  const currentLevel = clampHeadingLevel(match[1].length);
  const arabicDepth = parseHeadingDepthByArabicNumber(rawText);
  const singleNumericPrefix = parseSingleNumericHeadingPrefix(rawText);
  const chinesePrefixNumber = parseChineseHeadingPrefixNumber(rawText);
  const inferredParentByChinese =
    arabicDepth === null &&
    chinesePrefixNumber !== null &&
    nextArabicPrimary !== null &&
    chinesePrefixNumber === nextArabicPrimary;
  const isSpecialSection = arabicDepth === null && latestSecondLevelNumberedHeadingLevel === 2 && isSpecialSectionHeading(rawText);
  const effectiveArabicDepth = arabicDepth ?? (inferredParentByChinese ? 1 : null);
  const normalizedLevel =
    isSpecialSection
      ? 3
      : inferredParentByChinese
      ? 1
      : singleNumericPrefix !== null && currentLevel === 1
      ? 1
      : arabicDepth !== null
      ? clampHeadingLevel(arabicDepth)
      : clampHeadingLevel((latestNumberedHeadingLevel ?? previousHeadingLevel ?? currentLevel - 1) + 1);

  return {
    level: normalizedLevel,
    isNumbered: effectiveArabicDepth !== null || (singleNumericPrefix !== null && currentLevel === 1),
    arabicDepth: effectiveArabicDepth ?? (singleNumericPrefix !== null && currentLevel === 1 ? 1 : null),
    rawText,
    sourceLevel: currentLevel,
    chinesePrefixNumber,
    singleNumericPrefix,
    inferredParentByChinese
  };
}

function normalizeHeadingLevels(markdown: string, stats: FormatStats): string {
  const sourceLines = markdown.split(/\r?\n/);
  const frontmatterRange = findFrontmatterRange(sourceLines);
  const nextArabicPrimaryByLineIndex = new Map<number, number | null>();
  {
    const headingMeta: Array<{ lineIndex: number; arabicDepth: number | null; arabicPrimary: number | null }> = [];
    let scanInCodeFence = false;
    for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex += 1) {
      const line = sourceLines[lineIndex];
      if (isLineInFrontmatter(lineIndex, frontmatterRange)) continue;
      const trimmed = line.trim();
      if (FENCE_PATTERN.test(trimmed)) {
        scanInCodeFence = !scanInCodeFence;
        continue;
      }
      if (scanInCodeFence) continue;
      const headingMatch = matchHeadingLine(line);
      if (!headingMatch) continue;
      const rawText = headingMatch[2].trim();
      headingMeta.push({
        lineIndex,
        arabicDepth: parseHeadingDepthByArabicNumber(rawText),
        arabicPrimary: parseArabicPrimary(rawText)
      });
    }
    let nextPrimary: number | null = null;
    for (let index = headingMeta.length - 1; index >= 0; index -= 1) {
      const item = headingMeta[index];
      nextArabicPrimaryByLineIndex.set(item.lineIndex, nextPrimary);
      if (item.arabicDepth !== null && item.arabicDepth >= 2 && item.arabicPrimary !== null) {
        nextPrimary = item.arabicPrimary;
      }
    }
  }
  const outputLines: string[] = [];
  let inCodeFence = false;
  let previousHeadingLevel: number | null = null;
  let previousSourceHeadingLevel: number | null = null;
  let latestNumberedHeadingLevel: number | null = null;
  let latestSecondLevelNumberedHeadingLevel: number | null = null;
  const numberedPathByLevel = new Map<number, number[]>();
  const numberedSourceByLevel = new Map<number, "single" | "path">();
  const outputPathBySourceLevel = new Map<number, number[]>();
  const syntheticSiblingCounterByParentPath = new Map<string, number>();

  for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex += 1) {
    const rawLine = sourceLines[lineIndex];
    if (isLineInFrontmatter(lineIndex, frontmatterRange)) {
      outputLines.push(rawLine);
      continue;
    }
    if (FENCE_PATTERN.test(rawLine)) {
      inCodeFence = !inCodeFence;
      outputLines.push(rawLine);
      continue;
    }

    if (inCodeFence) {
      outputLines.push(rawLine);
      continue;
    }

    const headingMatch = matchHeadingLine(rawLine);
    if (!headingMatch) {
      const normalizedIgnoredTagLine = normalizeIgnoredTagDefinitionLine(rawLine);
      if (normalizedIgnoredTagLine) {
        if (normalizedIgnoredTagLine !== rawLine) {
          stats.headingAdjustedCount += 1;
        }
        outputLines.push(normalizedIgnoredTagLine);
        continue;
      }
      outputLines.push(rawLine);
      continue;
    }

    const normalized = normalizeHeadingLine(
      rawLine,
      previousHeadingLevel,
      latestNumberedHeadingLevel,
      latestSecondLevelNumberedHeadingLevel,
      nextArabicPrimaryByLineIndex.get(lineIndex) ?? null
    );
    const explicitArabicPath = parseArabicHeadingPath(normalized.rawText);
    const explicitArabicDepth = explicitArabicPath?.length ?? null;
    const previousOutputPathAtSourceLevel =
      explicitArabicDepth !== null ? outputPathBySourceLevel.get(normalized.sourceLevel) ?? null : null;
    const hasImmediateParentContext =
      explicitArabicDepth !== null &&
      previousSourceHeadingLevel === normalized.sourceLevel - 1 &&
      (numberedPathByLevel.get(normalized.sourceLevel - 1)?.length ?? 0) >= explicitArabicDepth;
    const contextualParentPath =
      explicitArabicDepth !== null &&
      normalized.sourceLevel > explicitArabicDepth &&
      normalized.sourceLevel > 1 &&
      (hasImmediateParentContext ||
        (previousOutputPathAtSourceLevel !== null && previousOutputPathAtSourceLevel.length > explicitArabicDepth))
        ? numberedPathByLevel.get(normalized.sourceLevel - 1) ?? null
        : null;
    const outputLevel =
      explicitArabicPath !== null && contextualParentPath ? normalized.sourceLevel : normalized.level;
    let outputPath: number[] | null =
      explicitArabicPath !== null
        ? contextualParentPath
          ? [
              ...contextualParentPath,
              (syntheticSiblingCounterByParentPath.get(getHeadingSequenceCounterKey(contextualParentPath, outputLevel)) ?? 0) + 1
            ]
          : normalizeExplicitArabicHeadingPath(
              explicitArabicPath,
              outputLevel,
              numberedPathByLevel,
              syntheticSiblingCounterByParentPath
            )
        : null;
    let outputBody = normalized.rawText;
    if (normalized.chinesePrefixNumber !== null) {
      const chineseBody = stripChineseHeadingPrefix(outputBody);
      outputBody = `${normalized.chinesePrefixNumber} ${chineseBody.length > 0 ? chineseBody : normalized.rawText}`.trim();
      outputPath = [normalized.chinesePrefixNumber];
    } else if (normalized.singleNumericPrefix !== null && outputLevel === 1) {
      outputPath = normalizeExplicitArabicHeadingPath(
        [normalized.singleNumericPrefix],
        1,
        numberedPathByLevel,
        syntheticSiblingCounterByParentPath
      );
    } else if (outputPath === null && outputLevel > 1 && !hasExplicitHeadingPrefix(normalized.rawText)) {
      const parentPath = numberedPathByLevel.get(outputLevel - 1);
      const isTopOrAlignedLevel =
        normalized.sourceLevel === 1 ||
        normalized.sourceLevel === outputLevel ||
        (parentPath?.length === 1 &&
          numberedSourceByLevel.get(outputLevel - 1) === "single" &&
          normalized.sourceLevel > outputLevel);
      const shouldAutoNumberUnnumbered = Boolean(parentPath && parentPath.length >= 1 && isTopOrAlignedLevel);
      if (parentPath && shouldAutoNumberUnnumbered) {
        const counterKey = `${parentPath.join(".")}->${outputLevel}`;
        const nextCounter = (syntheticSiblingCounterByParentPath.get(counterKey) ?? 0) + 1;
        syntheticSiblingCounterByParentPath.set(counterKey, nextCounter);
        outputPath = [...parentPath, nextCounter];
        const stripped = stripArabicHeadingPrefix(outputBody);
        outputBody = stripped.length > 0 ? stripped : outputBody;
      }
    }
    if (outputPath !== null) {
      let suffix = "";
      if (normalized.chinesePrefixNumber !== null) {
        suffix = stripChineseHeadingPrefix(normalized.rawText);
      } else if (normalized.singleNumericPrefix !== null && outputLevel === 1) {
        suffix = normalized.rawText.replace(/^\s*\d+(?:[.)、])?\s+/, "").trim();
      } else if (explicitArabicPath !== null) {
        suffix = stripArabicHeadingPrefix(normalized.rawText);
      } else {
        suffix = stripArabicHeadingPrefix(outputBody);
      }
      const prefix = outputPath.join(".");
      outputBody = suffix.length > 0 ? `${prefix} ${suffix}` : prefix;
    }
    const normalizedLine = `${"#".repeat(outputLevel)} ${outputBody}`;
    if (normalizedLine !== rawLine) {
      stats.headingAdjustedCount += 1;
    }
    for (const level of Array.from(numberedPathByLevel.keys())) {
      if (level > outputLevel) {
        numberedPathByLevel.delete(level);
        numberedSourceByLevel.delete(level);
      }
    }
    for (const level of Array.from(outputPathBySourceLevel.keys())) {
      if (level > normalized.sourceLevel) outputPathBySourceLevel.delete(level);
    }
    if (outputPath !== null) {
      numberedPathByLevel.set(outputLevel, outputPath);
      numberedSourceByLevel.set(outputLevel, normalized.singleNumericPrefix !== null && outputLevel === 1 ? "single" : "path");
      const parentPath = outputPath.length > 1 ? outputPath.slice(0, -1) : null;
      const counterKey = getHeadingSequenceCounterKey(parentPath, outputLevel);
      syntheticSiblingCounterByParentPath.set(counterKey, outputPath[outputPath.length - 1]);
    } else {
      numberedPathByLevel.delete(outputLevel);
      numberedSourceByLevel.delete(outputLevel);
    }
    if (outputPath !== null) {
      outputPathBySourceLevel.set(normalized.sourceLevel, outputPath);
    } else {
      outputPathBySourceLevel.delete(normalized.sourceLevel);
    }
    previousSourceHeadingLevel = normalized.sourceLevel;
    previousHeadingLevel = outputLevel;
    if (normalized.isNumbered) {
      latestNumberedHeadingLevel = outputLevel;
      if (normalized.arabicDepth === 1) {
        latestSecondLevelNumberedHeadingLevel = null;
      } else if (normalized.arabicDepth === 2) {
        latestSecondLevelNumberedHeadingLevel = 2;
      }
    }
    outputLines.push(normalizedLine);
  }

  return outputLines.join("\n");
}

function normalizeBlankLines(markdown: string, stats: FormatStats): string {
  const sourceLines = markdown.split(/\r?\n/);
  const frontmatterRange = findFrontmatterRange(sourceLines);
  const blocks: Block[] = [];
  let pendingBlankGap = false;

  let index = 0;
  while (index < sourceLines.length) {
    const activeFrontmatterRange = frontmatterRange && isLineInFrontmatter(index, frontmatterRange) ? frontmatterRange : null;
    if (activeFrontmatterRange) {
      const lines = sourceLines.slice(activeFrontmatterRange.start, activeFrontmatterRange.end + 1);
      blocks.push({
        type: "code",
        lines,
        leadingBlank: pendingBlankGap,
        startLine: activeFrontmatterRange.start + 1,
        endLine: activeFrontmatterRange.end + 1
      });
      stats.blockCountByType.code += 1;
      pendingBlankGap = false;
      index = activeFrontmatterRange.end + 1;
      continue;
    }
    const rawLine = sourceLines[index];
    const line = rawLine.replace(/[ \t]+$/g, "");
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      pendingBlankGap = true;
      index += 1;
      continue;
    }
    const currentLeadingBlank = pendingBlankGap;
    pendingBlankGap = false;
    const blockStartLine = index + 1;

    if (FENCE_PATTERN.test(trimmed)) {
      const lines: string[] = [line];
      index += 1;
      while (index < sourceLines.length) {
        const fenceLine = sourceLines[index].replace(/[ \t]+$/g, "");
        lines.push(fenceLine);
        index += 1;
        if (FENCE_PATTERN.test(fenceLine.trim())) {
          break;
        }
      }
      blocks.push({ type: "code", lines, leadingBlank: currentLeadingBlank, startLine: blockStartLine, endLine: index });
      stats.blockCountByType.code += 1;
      continue;
    }

    if (MATH_BLOCK_START_PATTERN.test(trimmed)) {
      const lines: string[] = [trimmed];
      const isSingleLineMath = /^\$\$.*\$\$\s*$/.test(trimmed) && trimmed !== "$$";
      index += 1;
      if (!isSingleLineMath) {
        while (index < sourceLines.length) {
          const mathLine = sourceLines[index].replace(/[ \t]+$/g, "");
          const mathTrimmed = mathLine.trim();
          lines.push(mathTrimmed === "$$" ? "$$" : mathLine);
          index += 1;
          if (MATH_BLOCK_PATTERN.test(mathTrimmed)) {
            break;
          }
        }
      }
      const inlineMath = extractShortInlineMath(lines);
      if (inlineMath) {
        blocks.push({
          type: "paragraph",
          lines: [`$${inlineMath}$`],
          paragraphLineCount: 1,
          leadingBlank: currentLeadingBlank,
          startLine: blockStartLine,
          endLine: blockStartLine + lines.length - 1
        });
        stats.blockCountByType.paragraph += 1;
      } else {
        blocks.push({
          type: "math",
          lines,
          leadingBlank: currentLeadingBlank,
          startLine: blockStartLine,
          endLine: blockStartLine + lines.length - 1
        });
        stats.blockCountByType.math += 1;
      }
      continue;
    }

    if (matchHeadingLine(trimmed)) {
      blocks.push({
        type: "heading",
        lines: [trimmed],
        leadingBlank: currentLeadingBlank,
        startLine: blockStartLine,
        endLine: blockStartLine
      });
      stats.blockCountByType.heading += 1;
      index += 1;
      continue;
    }

    if (THEMATIC_BREAK_PATTERN.test(trimmed)) {
      blocks.push({
        type: "thematicBreak",
        lines: ["---"],
        leadingBlank: currentLeadingBlank,
        startLine: blockStartLine,
        endLine: blockStartLine
      });
      stats.blockCountByType.thematicBreak += 1;
      index += 1;
      continue;
    }

    const nextLine = sourceLines[index + 1]?.replace(/[ \t]+$/g, "");
    const nextTrimmed = nextLine?.trim() ?? "";
    if (isTableHeaderLine(trimmed) && TABLE_SEPARATOR_PATTERN.test(nextTrimmed)) {
      const lines: string[] = [line, nextLine];
      index += 2;
      while (index < sourceLines.length) {
        const tableLine = sourceLines[index].replace(/[ \t]+$/g, "");
        const tableTrimmed = tableLine.trim();
        if (tableTrimmed.length === 0) {
          pendingBlankGap = true;
          index += 1;
          break;
        }
        if (!tableTrimmed.includes("|")) {
          break;
        }
        lines.push(tableLine);
        index += 1;
      }
      blocks.push({
        type: "table",
        lines,
        leadingBlank: currentLeadingBlank,
        startLine: blockStartLine,
        endLine: blockStartLine + lines.length - 1
      });
      stats.blockCountByType.table += 1;
      continue;
    }

    if (CALLOUT_LINE_PATTERN.test(trimmed)) {
      const lines: string[] = [line];
      index += 1;
      while (index < sourceLines.length) {
        const nextLine = sourceLines[index].replace(/[ \t]+$/g, "");
        const nextTrimmed = nextLine.trim();
        if (nextTrimmed.length === 0) {
          pendingBlankGap = true;
          index += 1;
          break;
        }
        if (CALLOUT_HEADER_PATTERN.test(nextTrimmed) && lines.length > 0) {
          break;
        }
        if (CALLOUT_LINE_PATTERN.test(nextTrimmed)) {
          lines.push(nextLine);
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({
        type: "callout",
        lines,
        leadingBlank: currentLeadingBlank,
        startLine: blockStartLine,
        endLine: blockStartLine + lines.length - 1
      });
      stats.blockCountByType.callout += 1;
      continue;
    }

    if (MARKDOWN_IMAGE_PATTERN.test(trimmed) || OBSIDIAN_IMAGE_PATTERN.test(trimmed)) {
      blocks.push({
        type: "image",
        lines: [trimmed],
        leadingBlank: currentLeadingBlank,
        startLine: blockStartLine,
        endLine: blockStartLine
      });
      stats.blockCountByType.image += 1;
      index += 1;
      continue;
    }

    if (LIST_ITEM_PATTERN.test(trimmed)) {
      const lines: string[] = [line];
      index += 1;
      while (index < sourceLines.length) {
        const nextLine = sourceLines[index].replace(/[ \t]+$/g, "");
        const nextTrimmed = nextLine.trim();
        if (nextTrimmed.length === 0) {
          pendingBlankGap = true;
          index += 1;
          break;
        }
        if (LIST_ITEM_PATTERN.test(nextTrimmed) || LIST_CONTINUATION_PATTERN.test(nextLine)) {
          lines.push(nextLine);
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({
        type: "list",
        lines,
        leadingBlank: currentLeadingBlank,
        startLine: blockStartLine,
        endLine: blockStartLine + lines.length - 1
      });
      stats.blockCountByType.list += 1;
      continue;
    }

    const lines: string[] = [line];
    index += 1;
    while (index < sourceLines.length) {
      const nextLine = sourceLines[index].replace(/[ \t]+$/g, "");
      const nextTrimmed = nextLine.trim();
      if (nextTrimmed.length === 0) {
        pendingBlankGap = true;
        index += 1;
        break;
      }
      if (
        FENCE_PATTERN.test(nextTrimmed) ||
        MATH_BLOCK_PATTERN.test(nextTrimmed) ||
        MATH_BLOCK_START_PATTERN.test(nextTrimmed) ||
        Boolean(matchHeadingLine(nextTrimmed)) ||
        THEMATIC_BREAK_PATTERN.test(nextTrimmed) ||
        CALLOUT_LINE_PATTERN.test(nextTrimmed) ||
        MARKDOWN_IMAGE_PATTERN.test(nextTrimmed) ||
        OBSIDIAN_IMAGE_PATTERN.test(nextTrimmed) ||
        LIST_ITEM_PATTERN.test(nextTrimmed) ||
        (isTableHeaderLine(nextTrimmed) &&
          TABLE_SEPARATOR_PATTERN.test((sourceLines[index + 1]?.replace(/[ \t]+$/g, "").trim() ?? "")))
      ) {
        break;
      }
      lines.push(nextLine);
      index += 1;
    }
    const paragraphSegments = splitParagraphLines(lines);
    if (paragraphSegments.length > 1) {
      stats.paragraphSegmentSplitCount += paragraphSegments.length - 1;
    }
    let segmentStartLine = blockStartLine;
    for (let segmentIndex = 0; segmentIndex < paragraphSegments.length; segmentIndex += 1) {
      const segment = paragraphSegments[segmentIndex];
      blocks.push({
        type: "paragraph",
        lines: segment,
        paragraphLineCount: segment.length,
        leadingBlank: segmentIndex === 0 ? currentLeadingBlank : false,
        startLine: segmentStartLine,
        endLine: segmentStartLine + segment.length - 1
      });
      segmentStartLine += segment.length;
      stats.blockCountByType.paragraph += 1;
      if (segment.length >= 2) {
        stats.multiLineParagraphCount += 1;
      }
    }
  }

  const normalizedBlocks = mergeInlineFragmentParagraphBlocks(blocks);
  const outputLines: string[] = [];
  for (let blockIndex = 0; blockIndex < normalizedBlocks.length; blockIndex += 1) {
    const block = normalizedBlocks[blockIndex];
    const previous = blockIndex > 0 ? normalizedBlocks[blockIndex - 1] : null;
    const currentFirstLine = block.lines[0]?.trim() ?? "";
    const currentParagraphLooksFragment =
      block.type === "paragraph" &&
      isLikelyInlineFragment(currentFirstLine) &&
      (block.paragraphLineCount ?? 0) <= 2;
    const previousLastLine = previous?.lines[previous.lines.length - 1]?.trim() ?? "";
    const previousParagraphLooksFragment =
      previous?.type === "paragraph" &&
      (previous.paragraphLineCount ?? 0) <= 2 &&
      isLikelyInlineFragment(previousLastLine);
    const previousIsImageLike = previous !== null && (previous.type === "image" || isImageLikeSingleLine(previous.lines));
    const needBlankBeforeHeading = block.type === "heading" && previous !== null && previous.type !== "heading";
    const needBlankBeforeTable = block.type === "table" && previous !== null;
    const needBlankBeforeThematicBreak = block.type === "thematicBreak" && previous !== null;
    const needBlankBetweenCallouts = block.type === "callout" && previous !== null && previous.type === "callout";
    const needBlankAfterHeading = previous !== null && previous.type === "heading";
    const needBlankAfterList =
      previous !== null &&
      previous.type === "list" &&
      block.type !== "heading" &&
      block.type !== "list" &&
      block.type !== "math";
    const needBlankAfterLongParagraph = false;
    const isBlockedAfterLongParagraph = false;
    const needBlankAfterCallout = previous !== null && previous.type === "callout" && block.type !== "callout";
    const needBlankBeforeCallout = false;
    const needNoBlankBetweenImageAndCallout = block.type === "callout" && previous !== null && previousIsImageLike;
    const needNoBlankBeforeListWhenPreviousIsParagraphOrList =
      block.type === "list" &&
      previous !== null &&
      block.leadingBlank !== true &&
      (previous.type === "list" || (previous.type === "paragraph" && (previous.paragraphLineCount ?? 0) < 2));
    const previousHasHardStop = hasHardSentenceStop(previousLastLine);
    const keepOriginalBlankBeforeParagraphListOrCallout =
      block.leadingBlank === true &&
      previous !== null &&
      previous.type === "paragraph" &&
      block.type === "paragraph" &&
      previousHasHardStop &&
      PARAGRAPH_START_PATTERN.test(currentFirstLine) &&
      !previousParagraphLooksFragment &&
      !currentParagraphLooksFragment;
    const shouldInsertBlank =
      needBlankBeforeHeading ||
      needBlankBeforeTable ||
      needBlankBeforeThematicBreak ||
      needBlankBetweenCallouts ||
      needBlankAfterHeading ||
      needBlankAfterList ||
      needBlankAfterLongParagraph ||
      needBlankAfterCallout ||
      needBlankBeforeCallout ||
      keepOriginalBlankBeforeParagraphListOrCallout;

    if (
      outputLines.length > 0 &&
      outputLines[outputLines.length - 1].trim().length > 0 &&
      !needNoBlankBetweenImageAndCallout &&
      !needNoBlankBeforeListWhenPreviousIsParagraphOrList &&
      shouldInsertBlank
    ) {
      const insertReasons: string[] = [];
      const sourceHadBlank = block.leadingBlank === true;
      const counter = sourceHadBlank ? stats.preservedBlankCountByReason : stats.insertedBlankCountByReason;
      if (needBlankBeforeHeading) counter.beforeHeading += 1;
      if (needBlankBeforeHeading) insertReasons.push("beforeHeading");
      if (needBlankBeforeTable) counter.beforeTable += 1;
      if (needBlankBeforeTable) insertReasons.push("beforeTable");
      if (needBlankBeforeThematicBreak) counter.beforeThematicBreak += 1;
      if (needBlankBeforeThematicBreak) insertReasons.push("beforeThematicBreak");
      if (needBlankBetweenCallouts) counter.betweenCallouts += 1;
      if (needBlankBetweenCallouts) insertReasons.push("betweenCallouts");
      if (needBlankAfterHeading) counter.afterHeading += 1;
      if (needBlankAfterHeading) insertReasons.push("afterHeading");
      if (needBlankAfterList) counter.afterList += 1;
      if (needBlankAfterList) insertReasons.push("afterList");
      if (needBlankAfterLongParagraph) counter.afterLongParagraph += 1;
      if (needBlankAfterLongParagraph) insertReasons.push("afterLongParagraph");
      if (needBlankAfterLongParagraph && !sourceHadBlank) stats.insertedAfterLongParagraphByNextType[block.type] += 1;
      if (needBlankAfterCallout) counter.afterCallout += 1;
      if (needBlankAfterCallout) insertReasons.push("afterCallout");
      if (needBlankBeforeCallout) counter.beforeCallout += 1;
      if (needBlankBeforeCallout) insertReasons.push("beforeCallout");
      if (keepOriginalBlankBeforeParagraphListOrCallout) insertReasons.push("keepOriginalBlankBeforeParagraphListOrCallout");
      pushBlankDecisionDetail(stats, sourceHadBlank ? "keep" : "insert", insertReasons, previous, block);
      if (needBlankAfterLongParagraph && stats.paragraphDecisionSamples.length < 20) {
        const previousLast = previous?.lines[previous.lines.length - 1] ?? "";
        const currentFirst = block.lines[0] ?? "";
        stats.paragraphDecisionSamples.push(
          `insert next=${block.type} prevLines=${previous?.paragraphLineCount ?? 0} prevLast=${previousLast.slice(0, 60)} nextFirst=${currentFirst.slice(0, 60)}`
        );
      }
      outputLines.push("");
    } else {
      if (needNoBlankBetweenImageAndCallout) stats.skippedBlankCountByReason.imageBeforeCallout += 1;
      if (needNoBlankBeforeListWhenPreviousIsParagraphOrList) {
        stats.skippedBlankCountByReason.paragraphOrListBeforeList += 1;
      }
      const skipReasons: string[] = [];
      if (needNoBlankBetweenImageAndCallout) skipReasons.push("imageBeforeCallout");
      if (needNoBlankBeforeListWhenPreviousIsParagraphOrList) skipReasons.push("paragraphOrListBeforeList");
      if (skipReasons.length > 0) {
        pushBlankDecisionDetail(stats, "skip", skipReasons, previous, block);
      }
      if (isBlockedAfterLongParagraph) {
        stats.blockedAfterLongParagraphByNextType[block.type] += 1;
        pushBlankDecisionDetail(stats, "blocked", ["afterLongParagraph"], previous, block);
        if (stats.paragraphDecisionSamples.length < 20) {
          const previousLast = previous?.lines[previous.lines.length - 1] ?? "";
          const currentFirst = block.lines[0] ?? "";
          stats.paragraphDecisionSamples.push(
            `blocked next=${block.type} prevLines=${previous?.paragraphLineCount ?? 0} prevLast=${previousLast.slice(0, 60)} nextFirst=${currentFirst.slice(0, 60)}`
          );
        }
      }
    }

    const linesToEmit = block.type === "paragraph" ? mergeInlineFragmentLines(block.lines) : block.lines;
    outputLines.push(...linesToEmit);
  }

  return outputLines.join("\n");
}

function splitBlockquotePrefix(line: string): { prefix: string; content: string } {
  let remaining = line;
  let prefix = "";
  while (true) {
    const match = remaining.match(/^(\s*>\s?)/);
    if (!match) break;
    prefix += match[1];
    remaining = remaining.slice(match[1].length);
  }
  return { prefix, content: remaining };
}

function normalizeUnorderedListMarkers(markdown: string, stats: FormatStats): string {
  const sourceLines = markdown.split(/\r?\n/);
  const outputLines: string[] = [];
  let inCodeFence = false;
  const indentStackByQuotePrefix = new Map<string, number[]>();
  for (const sourceLine of sourceLines) {
    const trimmed = sourceLine.trim();
    if (FENCE_PATTERN.test(trimmed)) {
      inCodeFence = !inCodeFence;
      outputLines.push(sourceLine);
      continue;
    }
    if (inCodeFence) {
      outputLines.push(sourceLine);
      continue;
    }
    if (trimmed.length === 0) {
      indentStackByQuotePrefix.clear();
      outputLines.push(sourceLine);
      continue;
    }
    const { prefix: quotePrefix, content: contentWithoutQuote } = splitBlockquotePrefix(sourceLine);
    const match = contentWithoutQuote.match(UNORDERED_LIST_LINE_PATTERN);
    if (!match) {
      outputLines.push(sourceLine);
      continue;
    }
    const indent = match[1];
    const originalMarker = match[2];
    const spacing = match[3];
    const content = match[4];
    const indentWidth = indent.replace(/\t/g, "  ").length;
    const indentStack = indentStackByQuotePrefix.get(quotePrefix) ?? [];
    while (indentStack.length > 0 && indentWidth < indentStack[indentStack.length - 1]) {
      indentStack.pop();
    }
    if (indentStack.length === 0 || indentWidth > indentStack[indentStack.length - 1]) {
      indentStack.push(indentWidth);
    }
    indentStackByQuotePrefix.set(quotePrefix, indentStack);
    const depth = Math.max(0, indentStack.length - 1);
    const normalizedMarker = depth <= 0 ? originalMarker : ["-", "+", "*"][depth % 3];
    if (normalizedMarker !== originalMarker) {
      stats.listMarkerAdjustedCount += 1;
    }
    outputLines.push(`${quotePrefix}${indent}${normalizedMarker}${spacing}${content}`);
  }
  return outputLines.join("\n");
}

function normalizeMathBlockDelimiterIndent(markdown: string): string {
  const sourceLines = markdown.split(/\r?\n/);
  const outputLines: string[] = [];
  let inCodeFence = false;
  for (const sourceLine of sourceLines) {
    const trimmed = sourceLine.trim();
    if (FENCE_PATTERN.test(trimmed)) {
      inCodeFence = !inCodeFence;
      outputLines.push(sourceLine);
      continue;
    }
    if (inCodeFence) {
      outputLines.push(sourceLine);
      continue;
    }
    if (/^[ \t]+\$\$/.test(sourceLine)) {
      outputLines.push(sourceLine.replace(/^[ \t]+(?=\$\$)/, ""));
      continue;
    }
    outputLines.push(sourceLine);
  }
  return outputLines.join("\n");
}

export function formatMarkdown(markdown: string): string {
  return formatMarkdownWithStats(markdown).text;
}

export function formatMarkdownContentOnly(markdown: string): string {
  return formatMarkdownContentOnlyWithStats(markdown).text;
}

export function formatMarkdownWithStats(
  markdown: string,
  options?: { normalizeHeadings?: boolean }
): { text: string; stats: FormatStats } {
  const shouldNormalizeHeadings = options?.normalizeHeadings !== false;
  const stats = createEmptyStats();
  const headingNormalized = shouldNormalizeHeadings ? normalizeHeadingLevels(markdown, stats) : markdown;
  const tagDefinitionNormalized = normalizeTagDefinitionLines(headingNormalized);
  const listMarkerNormalized = normalizeUnorderedListMarkers(tagDefinitionNormalized, stats);
  const mathDelimiterNormalized = normalizeMathBlockDelimiterIndent(listMarkerNormalized);
  const blankNormalized = normalizeBlankLines(mathDelimiterNormalized, stats);
  const text = normalizeImageCalloutGap(blankNormalized);
  return { text, stats };
}

export function formatMarkdownContentOnlyWithStats(markdown: string): { text: string; stats: FormatStats } {
  return formatMarkdownWithStats(markdown, { normalizeHeadings: false });
}

function extractHeadingLines(markdown: string): Array<{ lineIndex: number; line: string }> {
  const lines = markdown.split(/\r?\n/);
  const frontmatterRange = findFrontmatterRange(lines);
  const result: Array<{ lineIndex: number; line: string }> = [];
  let inCodeFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isLineInFrontmatter(index, frontmatterRange)) continue;
    const trimmed = line.trim();
    if (FENCE_PATTERN.test(trimmed)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;
    if (!matchHeadingLine(trimmed)) continue;
    const normalized = trimmed.replace(/^(\s{0,3}#{1,6})\s*/, "$1 ");
    result.push({ lineIndex: index, line: normalized });
  }
  return result;
}

function findHeadingReviewBlock(markdown: string): { start: number; end: number; block: string } | null {
  const start = markdown.indexOf(HEADING_REVIEW_START);
  if (start < 0) return null;
  const endMarkerStart = markdown.indexOf(HEADING_REVIEW_END, start);
  if (endMarkerStart < 0) return null;
  const end = endMarkerStart + HEADING_REVIEW_END.length;
  return { start, end, block: markdown.slice(start, end) };
}

function stripHeadingReviewBlock(markdown: string): { body: string; block: string | null; replacedExisting: boolean } {
  const found = findHeadingReviewBlock(markdown);
  if (!found) return { body: markdown, block: null, replacedExisting: false };
  const before = markdown.slice(0, found.start).replace(/[ \t]*\n?$/, "");
  const after = markdown.slice(found.end).replace(/^\n+/, "");
  const body = [before, after].filter((part) => part.length > 0).join("\n\n");
  return { body, block: found.block, replacedExisting: true };
}

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, "｜").replace(/\n/g, " ");
}

function getHeadingReviewDisplayPrefix(text: string): string {
  const level = text.match(/^#{1,6}/)?.[0].length ?? 0;
  if (level <= 1) return "";
  return `${"　".repeat(level - 1)}↳ `;
}

function formatHeadingReviewDisplayText(text: string): string {
  return `${getHeadingReviewDisplayPrefix(text)}${text}`;
}

function stripHeadingReviewDisplayPrefix(text: string): string {
  return text.replace(/^(?:　+↳\s*)/, "");
}

function classifyHeadingFlag(original: string, suggested: string): string {
  const originalLevel = (original.match(/^#{1,6}/)?.[0].length ?? 0);
  const suggestedLevel = (suggested.match(/^#{1,6}/)?.[0].length ?? 0);
  const originalBody = original.replace(/^#{1,6}\s*/, "");
  const suggestedBody = suggested.replace(/^#{1,6}\s*/, "");
  if (!matchHeadingLine(suggested) && /#[A-Za-z][\w-]*/.test(suggested)) {
    return "恢复术语定义行";
  }
  const originalPath = parseArabicHeadingPath(originalBody);
  const suggestedPath = parseArabicHeadingPath(suggestedBody);
  const tags: string[] = [];
  if (originalLevel !== suggestedLevel) tags.push(`H${originalLevel}→H${suggestedLevel}`);
  if (originalPath && suggestedPath && originalPath.length === suggestedPath.length && originalPath.length > 0) {
    const originalParent = originalPath.slice(0, -1);
    const suggestedParent = suggestedPath.slice(0, -1);
    const originalLast = originalPath[originalPath.length - 1];
    const suggestedLast = suggestedPath[suggestedPath.length - 1];
    if (originalPath.length === 1 && originalLast !== suggestedLast) {
      tags.push("章节锚点修复");
    } else {
      if (originalParent.length > 0 && originalParent.join(".") !== suggestedParent.join(".")) {
        tags.push("父路径补全");
      }
      if (originalLast !== suggestedLast) {
        tags.push("同级顺排");
      }
    }
  } else if (originalBody !== suggestedBody) {
    tags.push("编号/文本调整");
  }
  if (!/^\d+(?:\.\d+)*\.?\s+/.test(originalBody)) tags.push("原始非标准编号");
  if (tags.length === 0) return "保持";
  return tags.join("、");
}

function parseHeadingReviewMeta(block: string): HeadingReviewItem[] {
  const metaPattern = new RegExp(`${HEADING_REVIEW_META_START}\\s*\\n([\\s\\S]*?)\\n-->`);
  const match = block.match(metaPattern);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]) as { items?: HeadingReviewItem[] };
    if (!parsed.items || !Array.isArray(parsed.items)) return [];
    return parsed.items;
  } catch {
    return [];
  }
}

function parseEditableHeadingRows(block: string): string[] {
  const lines = block.split(/\r?\n/);
  const rows = lines.filter((line) => /^\|/.test(line.trim()));
  if (rows.length <= 2) return [];
  const dataRows = rows.slice(2);
  const editable: string[] = [];
  for (const row of dataRows) {
    const content = row.trim();
    if (content.length === 0) continue;
    const cells = splitMarkdownTableRow(content.slice(1, content.endsWith("|") ? -1 : undefined)).map((cell) => cell.trim());
    if (cells.length < 2) continue;
    editable.push(decodeHeadingReviewCellText(stripHeadingReviewDisplayPrefix(cells[1].trim())));
  }
  return editable;
}

function decodeHeadingReviewCellText(text: string): string {
  return text.replace(/｜/g, "|").replace(/\\\\\|/g, "\\|");
}

function splitMarkdownTableRow(row: string): string[] {
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    if (char === "|" && row[index - 1] !== "\\") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function buildHeadingReviewBlock(body: string): { block: string; itemCount: number } {
  const headingOnlyFormatted = normalizeTagDefinitionLines(normalizeHeadingLevels(body, createEmptyStats()));
  const sourceHeadings = extractHeadingLines(body);
  const headingOnlyLines = headingOnlyFormatted.split(/\r?\n/);
  const items: HeadingReviewItem[] = [];
  for (let index = 0; index < sourceHeadings.length; index += 1) {
    const source = sourceHeadings[index];
    const suggestedRaw = headingOnlyLines[source.lineIndex] ?? source.line;
    const suggested = matchHeadingLine(suggestedRaw)
      ? suggestedRaw.replace(/^(\s{0,3}#{1,6})\s*/, "$1 ")
      : suggestedRaw.trim();
    const id = `H${String(index + 1).padStart(4, "0")}`;
    const flag = classifyHeadingFlag(source.line, suggested);
    items.push({
      id,
      lineIndex: source.lineIndex,
      original: source.line,
      suggested,
      flag
    });
  }
  const meta = JSON.stringify({ items });
  const tableLines = [
    "## 标题快修表",
    "",
    "| 原标题 | 快修标题（可编辑） | 标记 |",
    "| --- | --- | --- |",
    ...items.map(
      (item) =>
        `| ${escapeTableCell(formatHeadingReviewDisplayText(item.original))} | ${escapeTableCell(
          formatHeadingReviewDisplayText(item.suggested)
        )} | ${item.flag} |`
    )
  ];
  const block = [
    HEADING_REVIEW_START,
    HEADING_REVIEW_META_START,
    meta,
    "-->",
    ...tableLines,
    HEADING_REVIEW_END
  ].join("\n");
  return { block, itemCount: items.length };
}

export function buildHeadingReviewTable(markdown: string): HeadingReviewTableBuildResult {
  const stripped = stripHeadingReviewBlock(markdown);
  const body = stripped.body.trimEnd();
  const built = buildHeadingReviewBlock(body);
  const text = `${body}\n\n${built.block}\n`;
  return { text, itemCount: built.itemCount, replacedExisting: stripped.replacedExisting };
}

export function applyHeadingReviewTable(markdown: string): HeadingReviewApplyResult {
  const stripped = stripHeadingReviewBlock(markdown);
  if (!stripped.block) {
    return { text: markdown, hasReviewTable: false, appliedCount: 0, skippedCount: 0 };
  }
  const items = parseHeadingReviewMeta(stripped.block);
  const editedHeadings = parseEditableHeadingRows(stripped.block);
  const bodyLines = stripped.body.split(/\r?\n/);
  let appliedCount = 0;
  let skippedCount = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const edited = decodeHeadingReviewCellText((editedHeadings[index] ?? item.suggested).trim());
    if (edited.length === 0) {
      skippedCount += 1;
      continue;
    }
    if (item.lineIndex < 0 || item.lineIndex >= bodyLines.length) {
      skippedCount += 1;
      continue;
    }
    bodyLines[item.lineIndex] = edited;
    appliedCount += 1;
  }
  const rewrittenBody = formatMarkdownWithStats(bodyLines.join("\n"), { normalizeHeadings: false }).text;
  const rebuilt = buildHeadingReviewTable(rewrittenBody);
  return {
    text: rebuilt.text,
    hasReviewTable: true,
    appliedCount,
    skippedCount
  };
}
