export type HeadingNormalizationKind =
  | "explicit_path"
  | "top_level_anchor"
  | "inferred_chinese_anchor"
  | "special_section"
  | "plain";

export type HeadingNormalizationInfo = {
  kind: HeadingNormalizationKind;
  rawText: string;
  sourceLevel: number;
  normalizedLevel: number;
  explicitArabicPath: number[] | null;
  arabicDepth: number | null;
  isNumbered: boolean;
  chinesePrefixNumber: number | null;
  singleNumericPrefix: number | null;
  inferredParentByChinese: boolean;
  prefixFamily: string;
  markerStrength: string;
  markerTerminator: string;
  alphaValue: string | null;
  hasExplicitMarker: boolean;
  hasStructuredMarker: boolean;
};

export type HeadingNumberedSource = "single" | "path";

export type HeadingState = {
  previousHeadingLevel: number | null;
  previousSourceHeadingLevel: number | null;
  previousPrefixFamily: string;
  previousMarkerStrength: string;
  latestNumberedHeadingLevel: number | null;
  latestSecondLevelNumberedHeadingLevel: number | null;
  numberedPathByLevel: Map<number, number[]>;
  numberedSourceByLevel: Map<number, HeadingNumberedSource>;
  familyByLevel: Map<number, string>;
  orderedSequenceByKey: Map<string, number>;
  outputPathBySourceLevel: Map<number, number[]>;
  syntheticSiblingCounterByParentPath: Map<string, number>;
};

export type ResolvedHeadingOutput = {
  outputLevel: number;
  outputPath: number[] | null;
  outputFamily: string;
  outputBody: string;
};

type HeadingNormalizationHelpers = {
  parseHeadingMarker: (text: string) => any;
  getHeadingMarkerFamily: (marker: any) => string;
  getHeadingMarkerStrength: (marker: any) => string;
  isStructuredHeadingMarker: (marker: any) => boolean;
  getAlphaSequenceValue: (marker: any) => number | null;
  formatAlphaSequenceValue: (family: any, value: number, terminator: any) => string;
  formatAlphaCompositeHeadingPath: (family: any, path: number[]) => string;
  parseArabicHeadingPath: (text: string) => number[] | null;
  parseSingleNumericHeadingPrefix: (text: string) => number | null;
  parseChineseHeadingPrefixNumber: (text: string) => number | null;
  isSpecialSectionHeading: (text: string) => boolean;
  clampHeadingLevel: (level: number) => number;
  stripChineseHeadingPrefix: (text: string) => string;
  stripAlphaHeadingPrefix: (text: string) => string;
  stripAlphaCompositeHeadingPrefix: (text: string) => string;
  normalizeExplicitArabicHeadingPath: (
    explicitPath: number[],
    level: number,
    numberedPathByLevel: Map<number, number[]>,
    siblingCounterByParentPath: Map<string, number>
  ) => number[];
  hasExplicitHeadingPrefix: (text: string) => boolean;
  stripArabicHeadingPrefix: (text: string) => string;
  getHeadingSequenceCounterKey: (parentPath: number[] | null, level: number) => string;
};

export function classifyHeadingNormalization(
  rawText: string,
  currentLevel: number,
  latestSecondLevelNumberedHeadingLevel: number | null,
  nextArabicPrimary: number | null,
  helpers: HeadingNormalizationHelpers
): HeadingNormalizationInfo {
  const marker = helpers.parseHeadingMarker(rawText);
  const explicitArabicPath =
    marker.kind === "alpha_compound_lower" || marker.kind === "alpha_compound_upper"
      ? marker.numericPath
      : helpers.parseArabicHeadingPath(rawText);
  const arabicDepth = explicitArabicPath !== null ? marker.logicalDepth ?? explicitArabicPath.length : null;
  const singleNumericPrefix = helpers.parseSingleNumericHeadingPrefix(rawText);
  const chinesePrefixNumber = helpers.parseChineseHeadingPrefixNumber(rawText);
  const prefixFamily = helpers.getHeadingMarkerFamily(marker);
  const markerStrength = helpers.getHeadingMarkerStrength(marker);
  const hasExplicitMarker = marker.kind !== "none";
  const hasStructuredMarker = helpers.isStructuredHeadingMarker(marker);
  const inferredParentByChinese =
    arabicDepth === null &&
    chinesePrefixNumber !== null &&
    nextArabicPrimary !== null &&
    chinesePrefixNumber === nextArabicPrimary;
  const isTopLevelAnchor = currentLevel === 1 && singleNumericPrefix !== null;
  const isSpecialSection =
    currentLevel > 1 &&
    arabicDepth === null &&
    singleNumericPrefix === null &&
    latestSecondLevelNumberedHeadingLevel === 2 &&
    helpers.isSpecialSectionHeading(rawText);

  if (isTopLevelAnchor) {
    return {
      kind: "top_level_anchor",
      rawText,
      sourceLevel: currentLevel,
      normalizedLevel: 1,
      explicitArabicPath: null,
      arabicDepth: 1,
      isNumbered: true,
      chinesePrefixNumber,
      singleNumericPrefix,
      inferredParentByChinese,
      prefixFamily,
      markerStrength,
      markerTerminator: marker.terminator,
      alphaValue: marker.alphaValue,
      hasExplicitMarker,
      hasStructuredMarker
    };
  }

  if (explicitArabicPath !== null) {
    return {
      kind: "explicit_path",
      rawText,
      sourceLevel: currentLevel,
      normalizedLevel: helpers.clampHeadingLevel(explicitArabicPath.length),
      explicitArabicPath,
      arabicDepth,
      isNumbered: true,
      chinesePrefixNumber,
      singleNumericPrefix,
      inferredParentByChinese,
      prefixFamily,
      markerStrength,
      markerTerminator: marker.terminator,
      alphaValue: marker.alphaValue,
      hasExplicitMarker,
      hasStructuredMarker
    };
  }

  if (inferredParentByChinese) {
    return {
      kind: "inferred_chinese_anchor",
      rawText,
      sourceLevel: currentLevel,
      normalizedLevel: 1,
      explicitArabicPath: null,
      arabicDepth: 1,
      isNumbered: true,
      chinesePrefixNumber,
      singleNumericPrefix,
      inferredParentByChinese,
      prefixFamily,
      markerStrength,
      markerTerminator: marker.terminator,
      alphaValue: marker.alphaValue,
      hasExplicitMarker,
      hasStructuredMarker
    };
  }

  if (isSpecialSection) {
    return {
      kind: "special_section",
      rawText,
      sourceLevel: currentLevel,
      normalizedLevel: 3,
      explicitArabicPath: null,
      arabicDepth: null,
      isNumbered: false,
      chinesePrefixNumber,
      singleNumericPrefix,
      inferredParentByChinese,
      prefixFamily,
      markerStrength,
      markerTerminator: marker.terminator,
      alphaValue: marker.alphaValue,
      hasExplicitMarker,
      hasStructuredMarker
    };
  }

  return {
    kind: "plain",
    rawText,
    sourceLevel: currentLevel,
    normalizedLevel: currentLevel,
    explicitArabicPath: null,
    arabicDepth: null,
    isNumbered: false,
    chinesePrefixNumber,
    singleNumericPrefix,
    inferredParentByChinese,
    prefixFamily,
    markerStrength,
    markerTerminator: marker.terminator,
    alphaValue: marker.alphaValue,
    hasExplicitMarker,
    hasStructuredMarker
  };
}

export function normalizeHeadingLine(
  rawText: string,
  currentLevel: number,
  previousHeadingLevel: number | null,
  previousPrefixFamily: string,
  previousMarkerStrength: string,
  latestNumberedHeadingLevel: number | null,
  latestSecondLevelNumberedHeadingLevel: number | null,
  nextArabicPrimary: number | null,
  helpers: HeadingNormalizationHelpers
): HeadingNormalizationInfo {
  const normalizedInfo = classifyHeadingNormalization(
    rawText,
    currentLevel,
    latestSecondLevelNumberedHeadingLevel,
    nextArabicPrimary,
    helpers
  );
  const fallbackLevelBase =
    currentLevel === 1 ? 1 : helpers.clampHeadingLevel((latestNumberedHeadingLevel ?? previousHeadingLevel ?? currentLevel - 1) + 1);
  const alphaOrderedSublevel =
    normalizedInfo.markerStrength === "ordered_explicit" &&
    normalizedInfo.prefixFamily === "alpha_lower" &&
    previousPrefixFamily === "alpha_upper" &&
    previousMarkerStrength === "ordered_explicit" &&
    previousHeadingLevel !== null &&
    currentLevel > previousHeadingLevel
      ? helpers.clampHeadingLevel(previousHeadingLevel + 1)
      : null;
  const alphaStructureExtensionLevel =
    (normalizedInfo.markerStrength === "none" || normalizedInfo.markerStrength === "weak_explicit") &&
    (previousPrefixFamily === "alpha_lower" || previousPrefixFamily === "alpha_upper") &&
    previousMarkerStrength === "ordered_explicit" &&
    previousHeadingLevel !== null &&
    currentLevel > previousHeadingLevel
    && currentLevel === previousHeadingLevel + 1
      ? helpers.clampHeadingLevel(previousHeadingLevel + 1)
      : null;
  const fallbackLevel =
    alphaOrderedSublevel ??
    alphaStructureExtensionLevel ??
    (currentLevel > 1 &&
    previousHeadingLevel !== null &&
    previousHeadingLevel > 1 &&
    (latestNumberedHeadingLevel === null || previousHeadingLevel > latestNumberedHeadingLevel) &&
    currentLevel > previousHeadingLevel
      ? previousHeadingLevel
      : fallbackLevelBase);
  return {
    ...normalizedInfo,
    normalizedLevel: normalizedInfo.kind === "plain" ? fallbackLevel : normalizedInfo.normalizedLevel
  };
}

export function createHeadingState(): HeadingState {
  return {
    previousHeadingLevel: null,
    previousSourceHeadingLevel: null,
    previousPrefixFamily: "none",
    previousMarkerStrength: "none",
    latestNumberedHeadingLevel: null,
    latestSecondLevelNumberedHeadingLevel: null,
    numberedPathByLevel: new Map<number, number[]>(),
    numberedSourceByLevel: new Map<number, HeadingNumberedSource>(),
    familyByLevel: new Map<number, string>(),
    orderedSequenceByKey: new Map<string, number>(),
    outputPathBySourceLevel: new Map<number, number[]>(),
    syntheticSiblingCounterByParentPath: new Map<string, number>()
  };
}

export function resolveHeadingOutput(
  normalized: HeadingNormalizationInfo,
  state: HeadingState,
  helpers: HeadingNormalizationHelpers
): ResolvedHeadingOutput {
  const explicitArabicPath =
    normalized.explicitArabicPath !== null
      ? normalized.explicitArabicPath
      : normalized.hasStructuredMarker &&
          normalized.alphaValue !== null &&
          (normalized.prefixFamily === "alpha_lower" || normalized.prefixFamily === "alpha_upper")
        ? helpers.parseHeadingMarker(normalized.rawText).numericPath
        : null;
  const explicitArabicDepth = explicitArabicPath?.length ?? null;
  const previousOutputPathAtSourceLevel =
    explicitArabicDepth !== null ? state.outputPathBySourceLevel.get(normalized.sourceLevel) ?? null : null;
  const hasImmediateParentContext =
    explicitArabicDepth !== null &&
    state.previousSourceHeadingLevel === normalized.sourceLevel - 1 &&
    (state.numberedPathByLevel.get(normalized.sourceLevel - 1)?.length ?? 0) >= explicitArabicDepth;
  const contextualParentPath =
    explicitArabicDepth !== null &&
    normalized.sourceLevel > explicitArabicDepth &&
    normalized.sourceLevel > 1 &&
    (hasImmediateParentContext ||
      (previousOutputPathAtSourceLevel !== null && previousOutputPathAtSourceLevel.length > explicitArabicDepth))
      ? state.numberedPathByLevel.get(normalized.sourceLevel - 1) ?? null
      : null;
  const outputLevel =
    explicitArabicPath !== null && contextualParentPath ? normalized.sourceLevel : normalized.normalizedLevel;
  let outputPath: number[] | null =
    explicitArabicPath !== null
      ? contextualParentPath
        ? [
            ...contextualParentPath,
            (state.syntheticSiblingCounterByParentPath.get(helpers.getHeadingSequenceCounterKey(contextualParentPath, outputLevel)) ?? 0) + 1
          ]
        : helpers.normalizeExplicitArabicHeadingPath(
            explicitArabicPath,
            outputLevel,
            state.numberedPathByLevel,
            state.syntheticSiblingCounterByParentPath
          )
      : null;
  let outputFamily = normalized.prefixFamily;
  let outputBody = normalized.rawText;

  if (normalized.kind === "inferred_chinese_anchor" && normalized.chinesePrefixNumber !== null) {
    const chineseBody = helpers.stripChineseHeadingPrefix(outputBody);
    outputBody = `${normalized.chinesePrefixNumber} ${chineseBody.length > 0 ? chineseBody : normalized.rawText}`.trim();
    outputPath = [normalized.chinesePrefixNumber];
    outputFamily = "chinese";
  } else if (normalized.kind === "top_level_anchor" && normalized.singleNumericPrefix !== null && outputLevel === 1) {
    outputPath = helpers.normalizeExplicitArabicHeadingPath(
      [normalized.singleNumericPrefix],
      1,
      state.numberedPathByLevel,
      state.syntheticSiblingCounterByParentPath
    );
    outputFamily = "arabic";
  } else if (outputPath === null && outputLevel > 1 && !normalized.hasExplicitMarker) {
    const parentPath = state.numberedPathByLevel.get(outputLevel - 1);
    const parentFamily = state.familyByLevel.get(outputLevel - 1);
    const isNestedUnderImmediateNumberedParent =
      normalized.sourceLevel > outputLevel &&
      state.latestNumberedHeadingLevel === outputLevel - 1 &&
      state.previousMarkerStrength === "structured" &&
      state.previousSourceHeadingLevel !== null &&
      state.previousHeadingLevel !== null &&
      normalized.sourceLevel >= state.previousSourceHeadingLevel &&
      normalized.sourceLevel <= state.previousSourceHeadingLevel + 1 &&
      state.previousSourceHeadingLevel > state.previousHeadingLevel;
    const isTopOrAlignedLevel =
      normalized.sourceLevel === 1 ||
      normalized.sourceLevel === outputLevel ||
      isNestedUnderImmediateNumberedParent ||
      (parentPath?.length === 1 &&
        state.numberedSourceByLevel.get(outputLevel - 1) === "single" &&
        normalized.sourceLevel > outputLevel);
    const shouldAutoNumberUnnumbered = Boolean(
      parentPath &&
        parentPath.length >= 1 &&
        isTopOrAlignedLevel &&
        (parentFamily === "arabic" || parentFamily === "chinese" || parentFamily === "alpha_lower" || parentFamily === "alpha_upper")
    );
    if (parentPath && shouldAutoNumberUnnumbered) {
      const counterKey = `${parentPath.join(".")}->${outputLevel}`;
      const nextCounter = (state.syntheticSiblingCounterByParentPath.get(counterKey) ?? 0) + 1;
      state.syntheticSiblingCounterByParentPath.set(counterKey, nextCounter);
      outputPath = [...parentPath, nextCounter];
      outputFamily = parentFamily ?? outputFamily;
      const stripped = helpers.stripArabicHeadingPrefix(outputBody);
      outputBody = stripped.length > 0 ? stripped : outputBody;
    }
  }

  if (
    outputPath === null &&
    normalized.markerStrength === "ordered_explicit" &&
    (normalized.prefixFamily === "alpha_lower" || normalized.prefixFamily === "alpha_upper") &&
    normalized.alphaValue !== null
  ) {
    const parentPath = state.numberedPathByLevel.get(outputLevel - 1) ?? null;
    const sequenceKey = `${helpers.getHeadingSequenceCounterKey(parentPath, outputLevel)}|${normalized.prefixFamily}`;
    const previous = state.orderedSequenceByKey.get(sequenceKey) ?? 0;
    const actualValue = helpers.getAlphaSequenceValue({
      alphaValue: normalized.alphaValue,
      kind: normalized.prefixFamily === "alpha_upper" ? "alpha_single_upper" : "alpha_single_lower"
    });
    const resolvedValue = actualValue === null ? null : previous === 0 ? actualValue : Math.min(26, previous + 1);
    if (resolvedValue !== null) {
      state.orderedSequenceByKey.set(sequenceKey, resolvedValue);
      if (actualValue !== resolvedValue) {
        const suffix = helpers.stripAlphaHeadingPrefix(normalized.rawText);
        const prefix = helpers.formatAlphaSequenceValue(normalized.prefixFamily, resolvedValue, normalized.markerTerminator);
        outputBody = suffix.length > 0 ? `${prefix} ${suffix}` : prefix;
      }
    }
  }

  if (outputPath !== null) {
    let suffix = "";
    if (normalized.kind === "inferred_chinese_anchor" && normalized.chinesePrefixNumber !== null) {
      suffix = helpers.stripChineseHeadingPrefix(normalized.rawText);
    } else if (normalized.kind === "top_level_anchor" && normalized.singleNumericPrefix !== null && outputLevel === 1) {
      suffix = normalized.rawText.replace(/^\s*\d+(?:[.)、])?\s+/, "").trim();
    } else if (
      normalized.alphaValue !== null &&
      (normalized.prefixFamily === "alpha_lower" || normalized.prefixFamily === "alpha_upper") &&
      normalized.hasStructuredMarker
    ) {
      suffix = helpers.stripAlphaCompositeHeadingPrefix(normalized.rawText);
    } else if (explicitArabicPath !== null) {
      suffix = helpers.stripArabicHeadingPrefix(normalized.rawText);
    } else {
      suffix = helpers.stripArabicHeadingPrefix(outputBody);
    }
    const prefix =
      outputFamily === "alpha_lower" || outputFamily === "alpha_upper"
        ? helpers.formatAlphaCompositeHeadingPath(outputFamily, outputPath)
        : outputPath.join(".");
    outputBody = suffix.length > 0 ? `${prefix} ${suffix}` : prefix;
  }

  return { outputLevel, outputPath, outputFamily, outputBody };
}

export function applyResolvedHeadingState(
  state: HeadingState,
  normalized: HeadingNormalizationInfo,
  resolved: ResolvedHeadingOutput,
  helpers: HeadingNormalizationHelpers
): void {
  for (const level of Array.from(state.numberedPathByLevel.keys())) {
    if (level > resolved.outputLevel) {
      state.numberedPathByLevel.delete(level);
      state.numberedSourceByLevel.delete(level);
      state.familyByLevel.delete(level);
    }
  }
  for (const level of Array.from(state.outputPathBySourceLevel.keys())) {
    if (level > normalized.sourceLevel) state.outputPathBySourceLevel.delete(level);
  }
  if (resolved.outputPath !== null) {
    state.numberedPathByLevel.set(resolved.outputLevel, resolved.outputPath);
    state.numberedSourceByLevel.set(resolved.outputLevel, normalized.kind === "top_level_anchor" ? "single" : "path");
    state.familyByLevel.set(resolved.outputLevel, resolved.outputFamily === "none" ? "arabic" : resolved.outputFamily);
    const parentPath = resolved.outputPath.length > 1 ? resolved.outputPath.slice(0, -1) : null;
    const counterKey = helpers.getHeadingSequenceCounterKey(parentPath, resolved.outputLevel);
    state.syntheticSiblingCounterByParentPath.set(counterKey, resolved.outputPath[resolved.outputPath.length - 1]);
    state.outputPathBySourceLevel.set(normalized.sourceLevel, resolved.outputPath);
  } else {
    state.numberedPathByLevel.delete(resolved.outputLevel);
    state.numberedSourceByLevel.delete(resolved.outputLevel);
    state.outputPathBySourceLevel.delete(normalized.sourceLevel);
    if (normalized.hasExplicitMarker) {
      state.familyByLevel.set(resolved.outputLevel, normalized.prefixFamily);
    } else {
      state.familyByLevel.delete(resolved.outputLevel);
    }
  }
  state.previousSourceHeadingLevel = normalized.sourceLevel;
  state.previousHeadingLevel = resolved.outputLevel;
  state.previousPrefixFamily = normalized.prefixFamily;
  state.previousMarkerStrength = normalized.markerStrength;
  if (normalized.isNumbered) {
    state.latestNumberedHeadingLevel = resolved.outputLevel;
    if (normalized.arabicDepth === 1) {
      state.latestSecondLevelNumberedHeadingLevel = null;
    } else if (normalized.arabicDepth === 2) {
      state.latestSecondLevelNumberedHeadingLevel = 2;
    }
  }
}
