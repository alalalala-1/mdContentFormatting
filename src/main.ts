import { MarkdownView, Notice, Platform, Plugin } from "obsidian";
import { formatMarkdownWithStats } from "./formatter";

type ImageSizingMetrics = {
  noImageRootSkipCount: number;
  imageCount: number;
  manualWidthCount: number;
  updatedWidthCount: number;
  unchangedWidthCount: number;
  pendingLoadCount: number;
  centeredStyleChangedCount: number;
  embedStyleChangedCount: number;
  skippedNodeCount: number;
  skippedNodeSamples: string[];
  sampleUpdates: Array<{ src: string; targetWidth: number; previousWidth: string }>;
};

type InlineStyleKey = "display" | "marginLeft" | "marginRight" | "height" | "maxWidth" | "width";

export default class MdContentFormattingPlugin extends Plugin {
  private readonly enableDebugLog = false;
  private pendingImageRoots = new Set<HTMLElement>();
  private pendingImageTriggers = new Set<string>();
  private imageSizingFrameId: number | null = null;
  private imageSizingSeq = 0;
  private imageSizingLastFlushAt = 0;
  private lastWindowResizeScheduleAt = 0;
  private lastBroadTriggerScheduleAt = 0;
  private lastResizeWidthByRoot = new WeakMap<HTMLElement, number>();

  async onload(): Promise<void> {
    this.addCommand({
      id: "format-current-note",
      name: "Format current note",
      callback: () => {
        this.formatCurrentNote();
      }
    });

    this.registerMarkdownPostProcessor((element) => {
      if (!this.shouldHandlePostProcessorElement(element)) return;
      this.scheduleImageSizing(element, "markdown-post-processor");
    });

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.scheduleImageSizingForActiveView("active-leaf-change");
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        this.scheduleImageSizingForActiveView("file-open");
      })
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.scheduleImageSizingForActiveView("layout-change");
      })
    );
    this.registerDomEvent(window, "resize", () => {
      this.scheduleImageSizingForActiveView("window-resize");
    });

    this.scheduleImageSizingForActiveView("onload");
  }

  onunload(): void {
    if (this.imageSizingFrameId !== null) {
      window.cancelAnimationFrame(this.imageSizingFrameId);
      this.imageSizingFrameId = null;
    }
    this.pendingImageRoots.clear();
  }

  private formatCurrentNote(): void {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView) {
      new Notice("No active markdown file.");
      return;
    }

    const editor = markdownView.editor;
    const source = editor.getValue();
    const { text: formatted, stats } = formatMarkdownWithStats(source);
    const secondPass = formatMarkdownWithStats(formatted);
    const idempotenceChanged = secondPass.text !== formatted;
    const idempotenceFirstDiff = idempotenceChanged ? this.findFirstDiff(formatted, secondPass.text) : null;
    const sourceLineCount = source.split(/\r?\n/).length;
    const formattedLineCount = formatted.split(/\r?\n/).length;
    const afterLongParagraphInserted = stats.insertedBlankCountByReason.afterLongParagraph;
    if (this.enableDebugLog) {
      console.log("[md-content-formatting] format-current-note", {
        changed: formatted !== source,
        idempotenceChanged,
        idempotenceFirstDiff,
        sourceLineCount,
        formattedLineCount,
        headingAdjustedCount: stats.headingAdjustedCount,
        listMarkerAdjustedCount: stats.listMarkerAdjustedCount,
        paragraphSegmentSplitCount: stats.paragraphSegmentSplitCount,
        multiLineParagraphCount: stats.multiLineParagraphCount,
        afterLongParagraphInserted,
        blockedAfterLongParagraphByNextType: stats.blockedAfterLongParagraphByNextType,
        insertedAfterLongParagraphByNextType: stats.insertedAfterLongParagraphByNextType,
        paragraphDecisionSamples: stats.paragraphDecisionSamples,
        blankDecisionDetails: stats.blankDecisionDetails,
        blockCountByType: stats.blockCountByType,
        insertedBlankCountByReason: stats.insertedBlankCountByReason,
        preservedBlankCountByReason: stats.preservedBlankCountByReason,
        skippedBlankCountByReason: stats.skippedBlankCountByReason
      });
      console.log(
        "[md-content-formatting] summary",
        JSON.stringify({
          changed: formatted !== source,
          headingAdjustedCount: stats.headingAdjustedCount,
          listMarkerAdjustedCount: stats.listMarkerAdjustedCount,
          multiLineParagraphCount: stats.multiLineParagraphCount,
          afterLongParagraphInserted,
          paragraphSegmentSplitCount: stats.paragraphSegmentSplitCount,
          idempotenceChanged,
          idempotenceFirstDiff,
          insertedBlankCountByReason: stats.insertedBlankCountByReason,
          preservedBlankCountByReason: stats.preservedBlankCountByReason,
          blockedAfterLongParagraphByNextType: stats.blockedAfterLongParagraphByNextType,
          insertedAfterLongParagraphByNextType: stats.insertedAfterLongParagraphByNextType
        })
      );
    }
    if (formatted === source) {
      new Notice("No formatting changes needed.");
      return;
    }

    editor.setValue(formatted);
    new Notice("Markdown formatted.");
  }

  private scheduleImageSizingForActiveView(trigger: string): void {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView) return;
    const root = this.getImageSizingRoot(markdownView.containerEl);
    if (!root) {
      this.debugImageSizing("schedule-skip", { trigger, reason: "no-reading-root" });
      return;
    }
    this.scheduleImageSizing(root, trigger);
  }

  private scheduleImageSizing(root: HTMLElement, trigger: string): void {
    const isBroadTrigger =
      trigger === "markdown-post-processor" ||
      trigger === "active-leaf-change" ||
      trigger === "file-open" ||
      trigger === "layout-change" ||
      trigger === "window-resize" ||
      trigger === "onload";
    if (isBroadTrigger) {
      const now = Date.now();
      if (now - this.lastBroadTriggerScheduleAt < 380) return;
      this.lastBroadTriggerScheduleAt = now;
    }
    if (isBroadTrigger && root.querySelector("img:not(.cm-widgetBuffer)") === null) {
      return;
    }
    if (
      (trigger === "markdown-post-processor" ||
        trigger === "active-leaf-change" ||
        trigger === "layout-change" ||
        trigger === "window-resize" ||
        trigger === "onload") &&
      !this.nodeContainsImage(root)
    ) {
      return;
    }
    if (trigger === "window-resize") {
      const now = Date.now();
      if (now - this.lastWindowResizeScheduleAt < 1200) return;
      this.lastWindowResizeScheduleAt = now;
      const currentWidth = root.clientWidth;
      const previousWidth = this.lastResizeWidthByRoot.get(root);
      this.lastResizeWidthByRoot.set(root, currentWidth);
      if (previousWidth !== undefined && Math.abs(currentWidth - previousWidth) < 8) return;
    }
    this.pendingImageRoots.add(root);
    this.pendingImageTriggers.add(trigger);
    if (this.imageSizingFrameId !== null) return;
    this.imageSizingFrameId = window.requestAnimationFrame(() => {
      const roots = Array.from(this.pendingImageRoots);
      const triggers = Array.from(this.pendingImageTriggers);
      this.pendingImageRoots.clear();
      this.pendingImageTriggers.clear();
      this.imageSizingFrameId = null;
      const startedAt = performance.now();
      const metrics = this.createEmptyImageSizingMetrics();
      for (const item of roots) {
        this.applyImageSizingInRoot(item, metrics);
      }
      const hasAnyImageWork =
        metrics.imageCount > 0 ||
        metrics.pendingLoadCount > 0 ||
        metrics.updatedWidthCount > 0 ||
        metrics.unchangedWidthCount > 0 ||
        metrics.centeredStyleChangedCount > 0 ||
        metrics.embedStyleChangedCount > 0;
      if (!hasAnyImageWork) {
        return;
      }
      const now = Date.now();
      const msSinceLastFlush = this.imageSizingLastFlushAt > 0 ? now - this.imageSizingLastFlushAt : null;
      this.imageSizingLastFlushAt = now;
      this.debugImageSizing("flush", {
        trigger,
        triggers,
        rootCount: roots.length,
        roots: roots.map((item) => this.describeElement(item)),
        flushCostMs: Number((performance.now() - startedAt).toFixed(2)),
        msSinceLastFlush,
        metrics
      });
    });
  }

  private shouldHandlePostProcessorElement(element: HTMLElement): boolean {
    if (element.closest(".message-segment")) return false;
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView) return false;
    if (!markdownView.containerEl.contains(element)) return false;
    if (!element.closest(".markdown-preview-view, .markdown-rendered, .markdown-source-view.mod-cm6")) return false;
    if (!this.nodeContainsImage(element)) return false;
    return true;
  }

  private applyImageSizingInRoot(root: HTMLElement, metrics: ImageSizingMetrics): void {
    if (!root.querySelector("img, .image-embed")) {
      metrics.noImageRootSkipCount += 1;
      return;
    }
    const imageElements = root.querySelectorAll<HTMLImageElement>(
      ".markdown-preview-view img, .markdown-rendered img, .image-embed img, img"
    );
    imageElements.forEach((imageElement) => {
      const skipReason = this.getImageSkipReason(imageElement);
      if (skipReason) {
        metrics.skippedNodeCount += 1;
        if (metrics.skippedNodeSamples.length < 6) {
          metrics.skippedNodeSamples.push(`${skipReason}:${this.describeElement(imageElement)}`);
        }
        return;
      }
      this.applyImageSizingToElement(imageElement, metrics);
    });
  }

  private applyImageSizingToElement(imageElement: HTMLImageElement, metrics: ImageSizingMetrics): void {
    metrics.imageCount += 1;
    metrics.centeredStyleChangedCount += this.setStyleIfDifferent(imageElement, "display", "block");
    metrics.centeredStyleChangedCount += this.setStyleIfDifferent(imageElement, "marginLeft", "auto");
    metrics.centeredStyleChangedCount += this.setStyleIfDifferent(imageElement, "marginRight", "auto");
    metrics.centeredStyleChangedCount += this.setStyleIfDifferent(imageElement, "height", "auto");

    const imageEmbed = imageElement.closest<HTMLElement>(".image-embed");
    if (imageEmbed) {
      metrics.embedStyleChangedCount += this.setStyleIfDifferent(imageEmbed, "display", "table");
      metrics.embedStyleChangedCount += this.setStyleIfDifferent(imageEmbed, "marginLeft", "auto");
      metrics.embedStyleChangedCount += this.setStyleIfDifferent(imageEmbed, "marginRight", "auto");
      metrics.embedStyleChangedCount += this.setStyleIfDifferent(imageEmbed, "maxWidth", "100%");
    }

    if (this.hasManualWidth(imageElement, imageEmbed)) {
      metrics.manualWidthCount += 1;
      this.setStyleIfDifferent(imageElement, "maxWidth", "100%");
      return;
    }

    const applySize = (): void => {
      const containerWidth = this.getImageContainerWidth(imageElement);
      const safeContainerWidth = Math.max(220, containerWidth - 8);
      const deviceLimit = Platform.isMobile ? 460 : 820;
      const naturalWidth = imageElement.naturalWidth > 0 ? imageElement.naturalWidth : safeContainerWidth;
      const targetWidth = Math.max(220, Math.min(naturalWidth, safeContainerWidth, deviceLimit));
      const previousWidth = imageElement.style.width;
      const widthChanged = this.setStyleIfDifferent(imageElement, "width", `${targetWidth}px`);
      this.setStyleIfDifferent(imageElement, "maxWidth", "100%");
      if (widthChanged > 0) {
        metrics.updatedWidthCount += 1;
        if (metrics.sampleUpdates.length < 6) {
          metrics.sampleUpdates.push({
            src: this.describeImageSource(imageElement),
            targetWidth,
            previousWidth
          });
        }
      } else {
        metrics.unchangedWidthCount += 1;
      }
    };

    if (imageElement.complete) {
      applySize();
      return;
    }

    metrics.pendingLoadCount += 1;
    imageElement.addEventListener(
      "load",
      () => {
        applySize();
      },
      { once: true }
    );
  }

  private hasManualWidth(imageElement: HTMLImageElement, imageEmbed: HTMLElement | null): boolean {
    const widthAttr = imageElement.getAttribute("width");
    if (widthAttr && widthAttr.trim().length > 0) return true;
    const styleWidth = imageElement.style.width;
    if (styleWidth && styleWidth.trim().length > 0 && styleWidth !== "auto" && !styleWidth.includes("%")) return true;
    if (!imageEmbed) return false;
    const embedWidth = imageEmbed.style.width;
    if (embedWidth && embedWidth.trim().length > 0) return true;
    const inlineStyle = imageEmbed.getAttribute("style") ?? "";
    if (/width\s*:/i.test(inlineStyle)) return true;
    return false;
  }

  private getImageContainerWidth(imageElement: HTMLImageElement): number {
    const container =
      imageElement.closest<HTMLElement>(".markdown-preview-sizer") ??
      imageElement.closest<HTMLElement>(".markdown-preview-view") ??
      imageElement.closest<HTMLElement>(".markdown-rendered") ??
      imageElement.parentElement;
    return container?.clientWidth ?? imageElement.clientWidth ?? 0;
  }

  private getImageSizingRoot(container: HTMLElement): HTMLElement | null {
    return (
      container.querySelector<HTMLElement>(".markdown-preview-view") ??
      container.querySelector<HTMLElement>(".markdown-rendered") ??
      null
    );
  }

  private getImageSkipReason(imageElement: HTMLImageElement): string | null {
    if (imageElement.classList.contains("cm-widgetBuffer")) return "cm-widgetBuffer";
    const inSourceEditor = imageElement.closest(".markdown-source-view.mod-cm6, .cm-editor, .cm-content");
    const inImageEmbed = imageElement.closest(".image-embed");
    if (inSourceEditor && !inImageEmbed) return "source-view-non-image-embed";
    if (!imageElement.closest(".markdown-preview-view, .markdown-rendered, .image-embed")) return "outside-preview";
    return null;
  }

  private nodeContainsImage(node: Node): boolean {
    if (!(node instanceof HTMLElement)) return false;
    if (node.matches("img:not(.cm-widgetBuffer), .image-embed")) return true;
    return node.querySelector("img:not(.cm-widgetBuffer), .image-embed") !== null;
  }

  private setStyleIfDifferent(element: HTMLElement, key: InlineStyleKey, value: string): number {
    const current = String(element.style[key] ?? "");
    if (current === value) return 0;
    element.style[key] = value;
    return 1;
  }

  private createEmptyImageSizingMetrics(): ImageSizingMetrics {
    return {
      noImageRootSkipCount: 0,
      imageCount: 0,
      manualWidthCount: 0,
      updatedWidthCount: 0,
      unchangedWidthCount: 0,
      pendingLoadCount: 0,
      centeredStyleChangedCount: 0,
      embedStyleChangedCount: 0,
      skippedNodeCount: 0,
      skippedNodeSamples: [],
      sampleUpdates: []
    };
  }

  private describeElement(element: HTMLElement | null): string {
    if (!element) return "null";
    const tag = element.tagName.toLowerCase();
    const classes = Array.from(element.classList).slice(0, 3).join(".");
    const dataPath = element.getAttribute("data-path");
    return `${tag}${classes.length > 0 ? `.${classes}` : ""}${dataPath ? `#${dataPath}` : ""}`;
  }

  private describeImageSource(imageElement: HTMLImageElement): string {
    const source = imageElement.getAttribute("src") ?? "";
    if (source.length <= 120) return source;
    return `${source.slice(0, 117)}...`;
  }

  private debugImageSizing(event: string, payload: Record<string, unknown>): void {
    if (!this.enableDebugLog) return;
    this.imageSizingSeq += 1;
    console.log("[md-content-formatting:image-sizing]", { seq: this.imageSizingSeq, event, ...payload });
  }

  private findFirstDiff(before: string, after: string): { line: number; before: string; after: string } | null {
    const beforeLines = before.split(/\r?\n/);
    const afterLines = after.split(/\r?\n/);
    const maxLineCount = Math.max(beforeLines.length, afterLines.length);
    for (let lineIndex = 0; lineIndex < maxLineCount; lineIndex += 1) {
      const beforeLine = beforeLines[lineIndex] ?? "";
      const afterLine = afterLines[lineIndex] ?? "";
      if (beforeLine !== afterLine) {
        return {
          line: lineIndex + 1,
          before: beforeLine.slice(0, 120),
          after: afterLine.slice(0, 120)
        };
      }
    }
    return null;
  }
}
