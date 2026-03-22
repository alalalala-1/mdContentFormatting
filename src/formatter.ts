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

function clampHeadingLevel(level: number): number {
  if (level < 1) return 1;
  if (level > 6) return 6;
  return level;
}

function parseHeadingDepthByArabicNumber(text: string): number | null {
  if (/^\d+[.)、](?=\s)/.test(text)) return null;
  const match = text.match(ARABIC_DEPTH_PATTERN);
  if (!match) return null;
  const nextChar = text.charAt(match[1].length);
  if (nextChar === ".") return null;
  return match[1].split(".").length;
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
  latestSecondLevelNumberedHeadingLevel: number | null
): { line: string; level: number; isNumbered: boolean; arabicDepth: number | null } {
  const match = line.match(HEADING_PATTERN);
  if (!match) {
    return { line, level: previousHeadingLevel ?? 1, isNumbered: false, arabicDepth: null };
  }

  const rawText = match[2].trim();
  const currentLevel = clampHeadingLevel(match[1].length);
  const arabicDepth = parseHeadingDepthByArabicNumber(rawText);
  const isSpecialSection = arabicDepth === null && latestSecondLevelNumberedHeadingLevel === 2 && isSpecialSectionHeading(rawText);
  const normalizedLevel =
    isSpecialSection
      ? 3
      : arabicDepth !== null
      ? clampHeadingLevel(arabicDepth)
      : clampHeadingLevel((latestNumberedHeadingLevel ?? previousHeadingLevel ?? currentLevel - 1) + 1);

  return {
    line: `${"#".repeat(normalizedLevel)} ${rawText}`,
    level: normalizedLevel,
    isNumbered: arabicDepth !== null,
    arabicDepth
  };
}

function normalizeHeadingLevels(markdown: string, stats: FormatStats): string {
  const sourceLines = markdown.split(/\r?\n/);
  const outputLines: string[] = [];
  let inCodeFence = false;
  let previousHeadingLevel: number | null = null;
  let latestNumberedHeadingLevel: number | null = null;
  let latestSecondLevelNumberedHeadingLevel: number | null = null;

  for (const rawLine of sourceLines) {
    if (FENCE_PATTERN.test(rawLine)) {
      inCodeFence = !inCodeFence;
      outputLines.push(rawLine);
      continue;
    }

    if (inCodeFence) {
      outputLines.push(rawLine);
      continue;
    }

    const headingMatch = rawLine.match(HEADING_PATTERN);
    if (!headingMatch) {
      outputLines.push(rawLine);
      continue;
    }

    const normalized = normalizeHeadingLine(
      rawLine,
      previousHeadingLevel,
      latestNumberedHeadingLevel,
      latestSecondLevelNumberedHeadingLevel
    );
    if (normalized.line !== rawLine) {
      stats.headingAdjustedCount += 1;
    }
    previousHeadingLevel = normalized.level;
    if (normalized.isNumbered) {
      latestNumberedHeadingLevel = normalized.level;
      if (normalized.arabicDepth === 1) {
        latestSecondLevelNumberedHeadingLevel = null;
      } else if (normalized.arabicDepth === 2) {
        latestSecondLevelNumberedHeadingLevel = 2;
      }
    }
    outputLines.push(normalized.line);
  }

  return outputLines.join("\n");
}

function normalizeBlankLines(markdown: string, stats: FormatStats): string {
  const sourceLines = markdown.split(/\r?\n/);
  const blocks: Block[] = [];
  let pendingBlankGap = false;

  let index = 0;
  while (index < sourceLines.length) {
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

    if (HEADING_PATTERN.test(trimmed)) {
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
        HEADING_PATTERN.test(nextTrimmed) ||
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

export function formatMarkdownWithStats(markdown: string): { text: string; stats: FormatStats } {
  const stats = createEmptyStats();
  const headingNormalized = normalizeHeadingLevels(markdown, stats);
  const listMarkerNormalized = normalizeUnorderedListMarkers(headingNormalized, stats);
  const mathDelimiterNormalized = normalizeMathBlockDelimiterIndent(listMarkerNormalized);
  const blankNormalized = normalizeBlankLines(mathDelimiterNormalized, stats);
  const text = normalizeImageCalloutGap(blankNormalized);
  return { text, stats };
}
