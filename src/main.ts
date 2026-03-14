import { MarkdownView, Notice, Plugin } from "obsidian";
import { formatMarkdownWithStats } from "./formatter";

export default class MdContentFormattingPlugin extends Plugin {
  async onload(): Promise<void> {
    this.addCommand({
      id: "format-current-note",
      name: "Format current note",
      callback: () => {
        this.formatCurrentNote();
      }
    });
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
    const sourceLineCount = source.split(/\r?\n/).length;
    const formattedLineCount = formatted.split(/\r?\n/).length;
    const afterLongParagraphInserted = stats.insertedBlankCountByReason.afterLongParagraph;
    console.log("[md-content-formatting] format-current-note", {
      changed: formatted !== source,
      sourceLineCount,
      formattedLineCount,
      headingAdjustedCount: stats.headingAdjustedCount,
      paragraphSegmentSplitCount: stats.paragraphSegmentSplitCount,
      multiLineParagraphCount: stats.multiLineParagraphCount,
      afterLongParagraphInserted,
      blockedAfterLongParagraphByNextType: stats.blockedAfterLongParagraphByNextType,
      insertedAfterLongParagraphByNextType: stats.insertedAfterLongParagraphByNextType,
      paragraphDecisionSamples: stats.paragraphDecisionSamples,
      blockCountByType: stats.blockCountByType,
      insertedBlankCountByReason: stats.insertedBlankCountByReason,
      skippedBlankCountByReason: stats.skippedBlankCountByReason
    });
    console.log(
      "[md-content-formatting] summary",
      JSON.stringify({
        changed: formatted !== source,
        headingAdjustedCount: stats.headingAdjustedCount,
        multiLineParagraphCount: stats.multiLineParagraphCount,
        afterLongParagraphInserted,
        paragraphSegmentSplitCount: stats.paragraphSegmentSplitCount,
        blockedAfterLongParagraphByNextType: stats.blockedAfterLongParagraphByNextType,
        insertedAfterLongParagraphByNextType: stats.insertedAfterLongParagraphByNextType
      })
    );
    if (formatted === source) {
      new Notice("No formatting changes needed.");
      return;
    }

    editor.setValue(formatted);
    new Notice("Markdown formatted.");
  }
}
