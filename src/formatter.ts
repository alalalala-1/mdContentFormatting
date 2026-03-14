const HEADING_PATTERN = /^\s{0,3}(#{1,6})\s*(.*)$/;
const FENCE_PATTERN = /^\s*```/;
const MATH_BLOCK_PATTERN = /^\s*\$\$\s*$/;
const MATH_BLOCK_START_PATTERN = /^\s*\$\$/;
const ARABIC_DEPTH_PATTERN = /^(\d+(?:\.\d+)*)\b/;
const THEMATIC_BREAK_PATTERN = /^\s*---\s*$/;
const CALLOUT_LINE_PATTERN = /^\s*>/;
const PARAGRAPH_START_PATTERN = /^[A-Za-z0-9\u4e00-\u9fff\u3040-\u30ff\u0400-\u04ff"'“”‘’(\[（【《「『]/;
const MARKDOWN_IMAGE_PATTERN = /^\s*!\[[^\]]*]\([^)]+\)\s*$/;
const OBSIDIAN_IMAGE_PATTERN = /^\s*!\[\[[^\]]+]]\s*$/;
const LIST_ITEM_PATTERN =
  /^\s{0,3}(?:[-+*]|(?:\d+|[a-zA-Z]+|[ivxlcdmIVXLCDM]+)[.)]|(?:\d+|[a-zA-Z]+)[、]|[(（](?:\d+|[a-zA-Z]+)[)）])\s+/;
const LIST_CONTINUATION_PATTERN = /^\s{2,}\S/;

type BlockType = "heading" | "paragraph" | "list" | "math" | "code" | "thematicBreak" | "callout" | "image";

type Block = {
  type: BlockType;
  lines: string[];
  paragraphLineCount?: number;
  leadingBlank?: boolean;
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
  | "beforeThematicBreak"
  | "afterHeading"
  | "afterList"
  | "afterLongParagraph"
  | "afterCallout"
  | "beforeCallout";

type BlankSkipReason = "imageBeforeCallout" | "paragraphOrListBeforeList";

export type FormatStats = {
  headingAdjustedCount: number;
  blockCountByType: Record<BlockType, number>;
  insertedBlankCountByReason: Record<BlankInsertReason, number>;
  skippedBlankCountByReason: Record<BlankSkipReason, number>;
  paragraphSegmentSplitCount: number;
  multiLineParagraphCount: number;
  blockedAfterLongParagraphByNextType: Record<BlockType, number>;
  insertedAfterLongParagraphByNextType: Record<BlockType, number>;
  paragraphDecisionSamples: string[];
};

function createEmptyStats(): FormatStats {
  return {
    headingAdjustedCount: 0,
    blockCountByType: {
      heading: 0,
      paragraph: 0,
      list: 0,
      math: 0,
      code: 0,
      thematicBreak: 0,
      callout: 0,
      image: 0
    },
    insertedBlankCountByReason: {
      beforeHeading: 0,
      beforeThematicBreak: 0,
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
      image: 0
    },
    insertedAfterLongParagraphByNextType: {
      heading: 0,
      paragraph: 0,
      list: 0,
      math: 0,
      code: 0,
      thematicBreak: 0,
      callout: 0,
      image: 0
    },
    paragraphDecisionSamples: []
  };
}

function clampHeadingLevel(level: number): number {
  if (level < 1) return 1;
  if (level > 6) return 6;
  return level;
}

function parseHeadingDepthByArabicNumber(text: string): number | null {
  const match = text.match(ARABIC_DEPTH_PATTERN);
  if (!match) return null;
  return match[1].split(".").length;
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
    const shouldSplit = currentSegment.length >= 2 && PARAGRAPH_START_PATTERN.test(nextTrimmed);
    if (shouldSplit) {
      segments.push(currentSegment);
      currentSegment = [];
    }
  }

  if (segments.length === 0) return [lines];
  return segments;
}

function normalizeHeadingLine(
  line: string,
  previousHeadingLevel: number | null,
  latestNumberedHeadingLevel: number | null
): { line: string; level: number; isNumbered: boolean } {
  const match = line.match(HEADING_PATTERN);
  if (!match) {
    return { line, level: previousHeadingLevel ?? 1, isNumbered: false };
  }

  const rawText = match[2].trim();
  const currentLevel = clampHeadingLevel(match[1].length);
  const arabicDepth = parseHeadingDepthByArabicNumber(rawText);
  const normalizedLevel =
    arabicDepth !== null
      ? clampHeadingLevel(arabicDepth)
      : clampHeadingLevel((latestNumberedHeadingLevel ?? previousHeadingLevel ?? currentLevel - 1) + 1);

  return {
    line: `${"#".repeat(normalizedLevel)} ${rawText}`,
    level: normalizedLevel,
    isNumbered: arabicDepth !== null
  };
}

function normalizeHeadingLevels(markdown: string, stats: FormatStats): string {
  const sourceLines = markdown.split(/\r?\n/);
  const outputLines: string[] = [];
  let inCodeFence = false;
  let previousHeadingLevel: number | null = null;
  let latestNumberedHeadingLevel: number | null = null;

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

    const normalized = normalizeHeadingLine(rawLine, previousHeadingLevel, latestNumberedHeadingLevel);
    if (normalized.line !== rawLine) {
      stats.headingAdjustedCount += 1;
    }
    previousHeadingLevel = normalized.level;
    if (normalized.isNumbered) {
      latestNumberedHeadingLevel = normalized.level;
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
      blocks.push({ type: "code", lines, leadingBlank: currentLeadingBlank });
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
      blocks.push({ type: "math", lines, leadingBlank: currentLeadingBlank });
      stats.blockCountByType.math += 1;
      continue;
    }

    if (HEADING_PATTERN.test(trimmed)) {
      blocks.push({ type: "heading", lines: [trimmed], leadingBlank: currentLeadingBlank });
      stats.blockCountByType.heading += 1;
      index += 1;
      continue;
    }

    if (THEMATIC_BREAK_PATTERN.test(trimmed)) {
      blocks.push({ type: "thematicBreak", lines: ["---"], leadingBlank: currentLeadingBlank });
      stats.blockCountByType.thematicBreak += 1;
      index += 1;
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
        if (CALLOUT_LINE_PATTERN.test(nextTrimmed)) {
          lines.push(nextLine);
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: "callout", lines, leadingBlank: currentLeadingBlank });
      stats.blockCountByType.callout += 1;
      continue;
    }

    if (MARKDOWN_IMAGE_PATTERN.test(trimmed) || OBSIDIAN_IMAGE_PATTERN.test(trimmed)) {
      blocks.push({ type: "image", lines: [trimmed], leadingBlank: currentLeadingBlank });
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
      blocks.push({ type: "list", lines, leadingBlank: currentLeadingBlank });
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
        LIST_ITEM_PATTERN.test(nextTrimmed)
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
    for (let segmentIndex = 0; segmentIndex < paragraphSegments.length; segmentIndex += 1) {
      const segment = paragraphSegments[segmentIndex];
      blocks.push({
        type: "paragraph",
        lines: segment,
        paragraphLineCount: segment.length,
        leadingBlank: segmentIndex === 0 ? currentLeadingBlank : false
      });
      stats.blockCountByType.paragraph += 1;
      if (segment.length >= 2) {
        stats.multiLineParagraphCount += 1;
      }
    }
  }

  const outputLines: string[] = [];
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];
    const previous = blockIndex > 0 ? blocks[blockIndex - 1] : null;
    const previousIsImageLike = previous !== null && (previous.type === "image" || isImageLikeSingleLine(previous.lines));
    const needBlankBeforeHeading = block.type === "heading" && previous !== null && previous.type !== "heading";
    const needBlankBeforeThematicBreak = block.type === "thematicBreak" && previous !== null;
    const needBlankAfterHeading = previous !== null && previous.type === "heading";
    const needBlankAfterList =
      previous !== null &&
      previous.type === "list" &&
      block.type !== "heading" &&
      block.type !== "list" &&
      block.type !== "math";
    const needBlankAfterLongParagraph =
      previous !== null &&
      previous.type === "paragraph" &&
      (previous.paragraphLineCount ?? 0) >= 2 &&
      block.type !== "heading" &&
      block.type !== "math" &&
      block.type !== "thematicBreak";
    const isBlockedAfterLongParagraph =
      previous !== null &&
      previous.type === "paragraph" &&
      (previous.paragraphLineCount ?? 0) >= 2 &&
      (block.type === "heading" || block.type === "list" || block.type === "math" || block.type === "thematicBreak");
    const needBlankAfterCallout = previous !== null && previous.type === "callout" && block.type !== "callout";
    const needBlankBeforeCallout = block.type === "callout" && previous !== null && !previousIsImageLike;
    const needNoBlankBetweenImageAndCallout = block.type === "callout" && previous !== null && previousIsImageLike;
    const needNoBlankBeforeListWhenPreviousIsParagraphOrList =
      block.type === "list" &&
      previous !== null &&
      (previous.type === "list" || (previous.type === "paragraph" && (previous.paragraphLineCount ?? 0) < 2));
    const keepOriginalBlankBetweenParagraphs =
      block.leadingBlank === true && previous !== null && previous.type === "paragraph" && block.type === "paragraph";
    const shouldInsertBlank =
      needBlankBeforeHeading ||
      needBlankBeforeThematicBreak ||
      needBlankAfterHeading ||
      needBlankAfterList ||
      needBlankAfterLongParagraph ||
      needBlankAfterCallout ||
      needBlankBeforeCallout ||
      keepOriginalBlankBetweenParagraphs;

    if (
      outputLines.length > 0 &&
      outputLines[outputLines.length - 1].trim().length > 0 &&
      !needNoBlankBetweenImageAndCallout &&
      !needNoBlankBeforeListWhenPreviousIsParagraphOrList &&
      shouldInsertBlank
    ) {
      if (needBlankBeforeHeading) stats.insertedBlankCountByReason.beforeHeading += 1;
      if (needBlankBeforeThematicBreak) stats.insertedBlankCountByReason.beforeThematicBreak += 1;
      if (needBlankAfterHeading) stats.insertedBlankCountByReason.afterHeading += 1;
      if (needBlankAfterList) stats.insertedBlankCountByReason.afterList += 1;
      if (needBlankAfterLongParagraph) stats.insertedBlankCountByReason.afterLongParagraph += 1;
      if (needBlankAfterLongParagraph) stats.insertedAfterLongParagraphByNextType[block.type] += 1;
      if (needBlankAfterCallout) stats.insertedBlankCountByReason.afterCallout += 1;
      if (needBlankBeforeCallout) stats.insertedBlankCountByReason.beforeCallout += 1;
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
      if (isBlockedAfterLongParagraph) {
        stats.blockedAfterLongParagraphByNextType[block.type] += 1;
        if (stats.paragraphDecisionSamples.length < 20) {
          const previousLast = previous?.lines[previous.lines.length - 1] ?? "";
          const currentFirst = block.lines[0] ?? "";
          stats.paragraphDecisionSamples.push(
            `blocked next=${block.type} prevLines=${previous?.paragraphLineCount ?? 0} prevLast=${previousLast.slice(0, 60)} nextFirst=${currentFirst.slice(0, 60)}`
          );
        }
      }
    }

    outputLines.push(...block.lines);
  }

  return outputLines.join("\n");
}

export function formatMarkdown(markdown: string): string {
  return formatMarkdownWithStats(markdown).text;
}

export function formatMarkdownWithStats(markdown: string): { text: string; stats: FormatStats } {
  const stats = createEmptyStats();
  const headingNormalized = normalizeHeadingLevels(markdown, stats);
  const blankNormalized = normalizeBlankLines(headingNormalized, stats);
  const text = normalizeImageCalloutGap(blankNormalized);
  return { text, stats };
}
