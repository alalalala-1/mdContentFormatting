import { describe, expect, it } from "vitest";
import { formatMarkdown } from "../src/formatter";

describe("formatMarkdown", () => {
  it("fixes heading levels by arabic numbering depth", () => {
    const input = ["# 4", "## 4.1", "###4.1.1", "## 4.1.1.1", "# 4.1.1.1.1"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      ["# 4", "", "## 4.1", "", "### 4.1.1", "", "#### 4.1.1.1", "", "##### 4.1.1.1.1"].join("\n")
    );
  });

  it("downgrades non-numeric sub-headings relative to parent heading", () => {
    const input = ["# 4", "### 子标题A", "##### 子标题B"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["# 4", "", "## 子标题A", "", "## 子标题B"].join("\n"));
  });

  it("keeps non-numbered sibling headings at same level under numbered heading", () => {
    const input = ["#### 4.9.3.7 正经标题", "##### 标准解释", "###### 这意味着什么？"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["#### 4.9.3.7 正经标题", "", "##### 标准解释", "", "##### 这意味着什么？"].join("\n"));
  });

  it("removes redundant blank lines and keeps one blank line before heading when previous line is content", () => {
    const input = [
      "# 1",
      "",
      "第一段",
      "",
      "",
      "第二段",
      "",
      "   ",
      "## 1.1",
      "",
      "正文",
      "",
      "$$",
      "a=b",
      "$$",
      "",
      "",
      "### 无编号小节"
    ].join("\n");

    const output = formatMarkdown(input);

    expect(output).toBe(
      ["# 1", "", "第一段", "", "第二段", "", "## 1.1", "", "正文", "$$", "a=b", "$$", "", "### 无编号小节"].join("\n")
    );
  });

  it("does not rewrite heading-like text inside code fence", () => {
    const input = ["# 1", "```md", "###4.1.1", "", "## title", "```"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["# 1", "", "```md", "###4.1.1", "", "## title", "```"].join("\n"));
  });

  it("keeps one blank line after paragraph with at least two lines", () => {
    const input = ["# 1", "第一行", "第二行", "", "", "下一段单行"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["# 1", "", "第一行", "第二行", "", "下一段单行"].join("\n"));
  });

  it("keeps one blank line after list blocks", () => {
    const input = [
      "# 1",
      "1. 反射",
      "2. 折射",
      "3. 吸收",
      "这是一行正文",
      "* 要点A",
      "* 要点B",
      "后续正文"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "# 1",
        "",
        "1. 反射",
        "2. 折射",
        "3. 吸收",
        "",
        "这是一行正文",
        "* 要点A",
        "* 要点B",
        "",
        "后续正文"
      ].join(
        "\n"
      )
    );
  });

  it("keeps one blank line before single line ---", () => {
    const input = ["# 1", "正文内容", "  ---  ", "分隔线后内容"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["# 1", "", "正文内容", "", "---", "分隔线后内容"].join("\n"));
  });

  it("removes blank lines before math block", () => {
    const input = ["# 1", "第一行", "第二行", "", "", "   $$", "a=b", "$$", "后续内容"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["# 1", "", "第一行", "第二行", "$$", "a=b", "$$", "后续内容"].join("\n"));
  });

  it("keeps one blank line after callout block", () => {
    const input = ["# 1", "> [!note]", "> callout 内容", "", "", "后续正文"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["# 1", "", "> [!note]", "> callout 内容", "", "后续正文"].join("\n"));
  });

  it("keeps one blank line after headings", () => {
    const input = ["# 标题", "正文", "## 次级标题", "下一段"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["# 标题", "", "正文", "", "## 次级标题", "", "下一段"].join("\n"));
  });

  it("does not keep blank line between image and callout", () => {
    const input = ["# 1", "![img](a.png)", "", "", "> [!note]", "> 说明", "后续内容"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["# 1", "", "![img](a.png)", "> [!note]", "> 说明", "", "后续内容"].join("\n"));
  });

  it("does not keep blank line between markdown image and indented blockquote line", () => {
    const input = ["![400](4-Optics/images/img-5.jpeg.png)", " ", " > Figure 4.4 Consider a plane wave entering"].join(
      "\n"
    );
    const output = formatMarkdown(input);

    expect(output).toBe(["![400](4-Optics/images/img-5.jpeg.png)", " > Figure 4.4 Consider a plane wave entering"].join("\n"));
  });

  it("does not keep blank line between markdown image and long indented figure blockquote", () => {
    const input = [
      "![400](4-Optics/images/img-10.jpeg.png)",
      " ",
      " > Figure 4.8 A downward plane wave incident on an ordered array of atoms. Wavelets scatter in all directions and overlap to form an ongoing secondary plane wave traveling downward. (E.H.)"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "![400](4-Optics/images/img-10.jpeg.png)",
        " > Figure 4.8 A downward plane wave incident on an ordered array of atoms. Wavelets scatter in all directions and overlap to form an ongoing secondary plane wave traveling downward. (E.H.)"
      ].join("\n")
    );
  });

  it("keeps one blank line before callout when previous block is not image", () => {
    const input = ["# 1", "普通段落", "> [!note]", "> 说明文字"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["# 1", "", "普通段落", "", "> [!note]", "> 说明文字"].join("\n"));
  });

  it("removes blank line between paragraph and list, and between adjacent list levels", () => {
    const input = ["# 1", "正文段落", "", "", "1. 一级", "", "   - 二级", "2. 另一个一级"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["# 1", "", "正文段落", "1. 一级", "   - 二级", "2. 另一个一级"].join("\n"));
  });

  it("keeps blank line before list when previous paragraph has at least two lines", () => {
    const input = ["# 1", "第一行段落", "第二行段落", "1. 列表项"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["# 1", "", "第一行段落", "第二行段落", "", "1. 列表项"].join("\n"));
  });

  it("keeps one blank line after english paragraph with at least two lines", () => {
    const input = [
      "The cruiser Aurora played a key role in the Revolution.",
      "Where the water is still, the reflection is specular.",
      "Next paragraph starts here."
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "The cruiser Aurora played a key role in the Revolution.",
        "Where the water is still, the reflection is specular.",
        "",
        "Next paragraph starts here."
      ].join("\n")
    );
  });

  it("keeps one blank line after chinese paragraph with at least two lines", () => {
    const input = ["第一行中文段落。", "第二行中文段落。", "下一段开始。"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["第一行中文段落。", "第二行中文段落。", "", "下一段开始。"].join("\n"));
  });

  it("splits long wrapped paragraph without punctuation and keeps one blank line", () => {
    const input = [
      "This is a long wrapped line that does not end with punctuation but should be considered content flow",
      "Another long wrapped line that still belongs to the same paragraph for formatting behavior checks",
      "Next paragraph starts here with a capital letter"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "This is a long wrapped line that does not end with punctuation but should be considered content flow",
        "Another long wrapped line that still belongs to the same paragraph for formatting behavior checks",
        "",
        "Next paragraph starts here with a capital letter"
      ].join("\n")
    );
  });

  it("keeps existing blank line between long single-line paragraphs", () => {
    const input = [
      "## 4.1 Introduction",
      "",
      "Our present concern is with the basic phenomena of transmission, reflection, and refraction described in classical optics.",
      "",
      "Most students have already studied these phenomena but such treatments can be misleadingly superficial at macroscopic scales."
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(input);
  });

  it("keeps one blank line between chinese single-line paragraphs when source has multiple blank lines", () => {
    const input = ["现在，我们来探讨一个核心问题：为什么散射的主要是蓝光？", "", "", "这与我们前面提到的振子模型和共振概念密切相关。"].join(
      "\n"
    );
    const output = formatMarkdown(input);

    expect(output).toBe(["现在，我们来探讨一个核心问题：为什么散射的主要是蓝光？", "", "这与我们前面提到的振子模型和共振概念密切相关。"].join("\n"));
  });
});
