import { describe, expect, it } from "vitest";
import {
  applyHeadingReviewTable,
  buildHeadingReviewTable,
  formatMarkdown,
  formatMarkdownContentOnly,
  formatMarkdownWithStats
} from "../src/formatter";

describe("formatMarkdown", () => {
  it("fixes heading levels by arabic numbering depth", () => {
    const input = ["# 4", "## 4.1", "###4.1.1", "## 4.1.1.1", "# 4.1.1.1.1"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      ["# 4", "", "## 4.1", "", "### 4.1.1", "", "#### 4.1.1.1", "", "##### 4.1.1.1.1"].join("\n")
    );
  });

  it("formats content without changing heading levels in content-only mode", () => {
    const input = ["# 4", "###4.1.1", "正文内容", "| 列1 | 列2 |", "| --- | --- |", "| A | B |"].join("\n");
    const output = formatMarkdownContentOnly(input);

    expect(output).toBe(["# 4", "", "###4.1.1", "", "正文内容", "", "| 列1 | 列2 |", "| --- | --- |", "| A | B |"].join("\n"));
  });

  it("downgrades non-numeric sub-headings relative to parent heading", () => {
    const input = ["# 4", "### 子标题A", "##### 子标题B"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["# 4", "", "## 子标题A", "", "## 子标题B"].join("\n"));
  });

  it("keeps non-numbered sibling headings at same level under numbered heading", () => {
    const input = ["#### 4.9.3.7 正经标题", "##### 标准解释", "###### 这意味着什么？"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["#### 4.9.3.7 正经标题", "", "##### 4.9.3.7.1 标准解释", "", "##### 这意味着什么？"].join("\n"));
  });

  it("treats non-progressive prefixed headings as non-numbered under numbered heading", () => {
    const input = ["## 5.1 小节", "### 1. 关键结论", "#### A. 补充说明", "##### 纯文字标题"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["## 5.1 小节", "", "### 1. 关键结论", "", "### A. 补充说明", "", "### 纯文字标题"].join("\n"));
  });

  it("forces special section headings to level 3 under level-2 numbered section even after deep headings", () => {
    const input = [
      "## 8.7 小节",
      "#### 8.7.1 深层标题",
      "###### 更深层",
      "##### 关键结论和知识点总结 (Key Conclusions and Knowledge Summary)",
      "#### 专业术语中英文对照并标注 tag",
      "#### 本节小结（Summary of This Section）",
      "#### 容易混淆的点",
      "#### 学习主线回顾",
      "#### 典型错误与纠正"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "## 8.7 小节",
        "",
        "### 8.7.1 深层标题",
        "",
        "#### 更深层",
        "",
        "### 关键结论和知识点总结 (Key Conclusions and Knowledge Summary)",
        "",
        "### 专业术语中英文对照并标注 tag",
        "",
        "### 本节小结（Summary of This Section）",
        "",
        "### 容易混淆的点",
        "",
        "### 学习主线回顾",
        "",
        "### 典型错误与纠正"
      ].join("\n")
    );
  });

  it("infers chinese numeral heading as parent when followed by matching 5.1/5.1.1 family", () => {
    const input = [
      "#### 五、第三族：距离依赖曲线 (Distance-Dependent Curves)",
      "### 5.1 双曲线 / 反比例 (Hyperbola / Inverse Proportion)",
      "## 5.1.1 子节"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "# 5 第三族：距离依赖曲线 (Distance-Dependent Curves)",
        "",
        "## 5.1 双曲线 / 反比例 (Hyperbola / Inverse Proportion)",
        "",
        "### 5.1.1 子节"
      ].join("\n")
    );
  });

  it("numbers unnumbered child headings under numbered parent sequence", () => {
    const input = [
      "### 6.1.3 三种阻尼情况",
      "#### 欠阻尼：阻尼较小，系统会振荡但振幅逐渐衰减。",
      "#### 临界阻尼：阻尼恰到好处，系统以最快速度回到平衡而不振荡。",
      "#### 过阻尼：阻尼太大，系统缓慢回到平衡，完全不振荡。"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "### 6.1.3 三种阻尼情况",
        "",
        "#### 6.1.3.1 欠阻尼：阻尼较小，系统会振荡但振幅逐渐衰减。",
        "",
        "#### 6.1.3.2 临界阻尼：阻尼恰到好处，系统以最快速度回到平衡而不振荡。",
        "",
        "#### 6.1.3.3 过阻尼：阻尼太大，系统缓慢回到平衡，完全不振荡。"
      ].join("\n")
    );
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

    expect(output).toBe(["# 1", "", "第一段", "第二段", "", "## 1.1", "", "正文", "$$", "a=b", "$$", "", "### 1.1.1 无编号小节"].join("\n"));
  });

  it("numbers unnumbered h3 topics under 1.3 parent", () => {
    const input = [
      "## 1.3 变化有多快",
      "### 什么是变化率？",
      "### 导数：把一小段变成一瞬间",
      "### 二阶导数：变化率的变化率",
      "### 另一种导数符号：点号"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "## 1.3 变化有多快",
        "",
        "### 1.3.1 什么是变化率？",
        "",
        "### 1.3.2 导数：把一小段变成一瞬间",
        "",
        "### 1.3.3 二阶导数：变化率的变化率",
        "",
        "### 1.3.4 另一种导数符号：点号"
      ].join("\n")
    );
  });

  it("does not rewrite heading-like text inside code fence", () => {
    const input = ["# 1", "```md", "###4.1.1", "", "## title", "```"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["# 1", "", "```md", "###4.1.1", "", "## title", "```"].join("\n"));
  });

  it("does not treat hashtag glossary definition lines as headings", () => {
    const input = [
      "## 1.3 斜率与截距",
      "#截距 ( #Intercept )：截距就是直线与 y 轴的交点值，即 x=0 时 y 的值。",
      "后续正文"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "## 1.3 斜率与截距",
        "",
        "#截距 ( #Intercept )：截距就是直线与 y 轴的交点值，即 x=0 时 y 的值。",
        "后续正文"
      ].join("\n")
    );
  });

  it("restores previously misclassified hashtag definition headings back to plain tag definition lines", () => {
    const input = [
      "## 1.3 斜率与截距",
      "#### 截距 ( #Intercept )：截距就是直线与 y 轴的交点值，即 x=0 时 y 的值。",
      "后续正文"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "## 1.3 斜率与截距",
        "",
        "#截距 ( #Intercept )：截距就是直线与 y 轴的交点值，即 x=0 时 y 的值。",
        "后续正文"
      ].join("\n")
    );
  });

  it("restores numbered hashtag definition headings back to plain tag definition lines", () => {
    const input = [
      "### 3.3.2 数学公式 (Formula)",
      "#### 3.3.2.1 振幅 ( #Amplitude )：振荡的最大偏离量。",
      "### 3.3.3 关于角频率"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "### 3.3.2 数学公式 (Formula)",
        "",
        "#振幅 ( #Amplitude )：振荡的最大偏离量。",
        "",
        "### 3.3.3 关于角频率"
      ].join("\n")
    );
  });

  it("restores hashtag definition headings even under h1 context", () => {
    const input = [
      "# 1 一元一次函数",
      "### 截距 ( #Intercept )：当 x=0 时 y 的值。",
      "后续内容"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["# 1 一元一次函数", "", "#截距 ( #Intercept )：当 x=0 时 y 的值。", "后续内容"].join("\n"));
  });

  it("restores tag-definition headings without colon when sentence has definition verbs", () => {
    const input = [
      "### 6.1.1 阻尼振荡",
      "#### 6.1.1.1 阻尼振荡 ( #Damped-Oscillation ) 描述的是一边振荡一边衰减的运动。",
      "#### 6.1.1.2 椭圆 ( #Ellipse ) 可以理解为被压扁或拉长的圆。",
      "### 6.1.2 半对数坐标 ( #Semi-Log-Plot )"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "### 6.1.1 阻尼振荡",
        "",
        "#阻尼振荡 ( #Damped-Oscillation ) 描述的是一边振荡一边衰减的运动。",
        "#椭圆 ( #Ellipse ) 可以理解为被压扁或拉长的圆。",
        "#半对数坐标 ( #Semi-Log-Plot )"
      ].join("\n")
    );
  });

  it("treats single-hash lines with english tag as plain text even when hash has trailing space", () => {
    const input = ["## 2.1 小节", "# 半对数坐标 ( #Semi-Log-Plot )", "后续正文"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["## 2.1 小节", "", "#半对数坐标 ( #Semi-Log-Plot )", "后续正文"].join("\n"));
  });

  it("does not convert english-only tagged headings when there is no chinese label before tag", () => {
    const input = ["## 2.1 Section", "### Semi-Log Plot ( #Semi-Log-Plot )", "正文"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["## 2.1 Section", "", "### 2.1.1 Semi-Log Plot ( #Semi-Log-Plot )", "", "正文"].join("\n"));
  });

  it("keeps source blank normalization without forcing blank after multi-line paragraph", () => {
    const input = ["# 1", "第一行", "第二行", "", "", "下一段单行"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["# 1", "", "第一行", "第二行", "下一段单行"].join("\n"));
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

  it("inserts one blank line between adjacent callouts", () => {
    const input = ["> [!info] 第一块", "> 说明 A", "> [!warning] 第二块", "> 说明 B"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["> [!info] 第一块", "> 说明 A", "", "> [!warning] 第二块", "> 说明 B"].join("\n"));
  });

  it("keeps one blank line between adjacent callouts when source has many blank lines", () => {
    const input = ["> [!info] 第一块", "> 说明 A", "", "", "", "> [!warning] 第二块", "> 说明 B"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["> [!info] 第一块", "> 说明 A", "", "> [!warning] 第二块", "> 说明 B"].join("\n"));
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

  it("does not treat image line as paragraph tail before callout", () => {
    const input = ["前文说明行", "![300](4-Optics/images/img-12.jpeg.png)", "> Figure caption"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["前文说明行", "![300](4-Optics/images/img-12.jpeg.png)", "> Figure caption"].join("\n"));
  });

  it("does not add blank line before callout when source has no blank line", () => {
    const input = ["# 1", "普通段落", "> [!note]", "> 说明文字"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["# 1", "", "普通段落", "> [!note]", "> 说明文字"].join("\n"));
  });

  it("removes blank line between paragraph and list, and between adjacent list levels", () => {
    const input = ["# 1", "正文段落", "", "", "1. 一级", "", "   - 二级", "2. 另一个一级"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["# 1", "", "正文段落", "1. 一级", "   - 二级", "2. 另一个一级"].join("\n"));
  });

  it("does not add blank line before list when source has no blank line", () => {
    const input = ["# 1", "第一行段落", "第二行段落", "1. 列表项"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["# 1", "", "第一行段落", "第二行段落", "1. 列表项"].join("\n"));
  });

  it("does not add blank line between paragraphs when source has no blank line (english)", () => {
    const input = [
      "The cruiser Aurora played a key role in the Revolution.",
      "Where the water is still, the reflection is specular.",
      "Next paragraph starts here."
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(input);
  });

  it("does not add blank line between paragraphs when source has no blank line (chinese)", () => {
    const input = ["第一行中文段落。", "第二行中文段落。", "下一段开始。"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(input);
  });

  it("does not split long wrapped paragraph without punctuation", () => {
    const input = [
      "This is a long wrapped line that does not end with punctuation but should be considered content flow",
      "Another long wrapped line that still belongs to the same paragraph for formatting behavior checks",
      "Next paragraph starts here with a capital letter"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(input);
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

  it("removes blank line between continuation-like chinese paragraph lines without sentence stop", () => {
    const input = [
      "那么，这些气体分子与光是如何相互作用的呢？它们表现得像一个个微小的振子。当入射光（电磁波）到来时，其交变的电场会驱动分子",
      "",
      "这个振动的电子云本身就构成了一个振荡的电偶极子，它会立即向外辐射电磁波。"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "那么，这些气体分子与光是如何相互作用的呢？它们表现得像一个个微小的振子。当入射光（电磁波）到来时，其交变的电场会驱动分子",
        "这个振动的电子云本身就构成了一个振荡的电偶极子，它会立即向外辐射电磁波。"
      ].join("\n")
    );
  });

  it("merges short formula fragments back into flowing paragraph lines", () => {
    const input = [
      "Why does light appear to travel at a speed other than",
      "$c$",
      "when photons can exist only at",
      "$c$",
      "?"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe("Why does light appear to travel at a speed other than $c$ when photons can exist only at $c$?");
  });

  it("merges short symbolic fragments back into flowing paragraph lines", () => {
    const input = [
      "where the subtraction of",
      "εP",
      "corresponds to a phase lag. An observer at",
      "P",
      "will have to wait longer.",
      "1.7×10^5",
      "light-years away was seen to explode."
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "where the subtraction of εP corresponds to a phase lag. An observer at P will have to wait longer.",
        "1.7×10^5 light-years away was seen to explode."
      ].join("\n")
    );
  });

  it("converts short display math blocks into inline math in flowing paragraph", () => {
    const input = ["Why does light appear to travel at a speed other than", "$$", "c", "$$", "when photons can exist only at", "$$", "c", "$$", "?"].join(
      "\n"
    );
    const output = formatMarkdown(input);

    expect(output).toBe("Why does light appear to travel at a speed other than $c$ when photons can exist only at $c$?");
  });

  it("keeps one blank line before table header row", () => {
    const input = ["正文内容", "| 列1 | 列2 |", "| --- | --- |", "| A | B |"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["正文内容", "", "| 列1 | 列2 |", "| --- | --- |", "| A | B |"].join("\n"));
  });

  it("moves $$ to line start by removing leading spaces", () => {
    const input = ["上一行文本", "   $$", "E=mc^2", "$$"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["上一行文本", "$$", "E=mc^2", "$$"].join("\n"));
  });

  it("uses different unordered markers for nested levels", () => {
    const input = ["- 一级", "  - 二级", "    - 三级"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["- 一级", "  + 二级", "    * 三级"].join("\n"));
  });

  it("uses different unordered markers when nested indent is one space", () => {
    const input = ["- 一级", " - 二级", "  - 三级"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["- 一级", " + 二级", "  * 三级"].join("\n"));
  });

  it("uses different unordered markers inside blockquote lines", () => {
    const input = ["> - 一级", ">   - 二级", ">     - 三级"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["> - 一级", ">   + 二级", ">     * 三级"].join("\n"));
  });

  it("builds one heading review table and replaces existing table when rerun", () => {
    const input = ["# 一章", "###1.1 错层", "正文"].join("\n");
    const first = buildHeadingReviewTable(input);
    const second = buildHeadingReviewTable(first.text);

    expect(first.itemCount).toBe(2);
    expect(second.replacedExisting).toBe(true);
    expect((second.text.match(/MD-FMT-HEADING-REVIEW:START/g) ?? []).length).toBe(1);
  });

  it("applies edited heading review rows back to source headings", () => {
    const input = ["# 一章", "###1.1 错层", "正文"].join("\n");
    const built = buildHeadingReviewTable(input);
    const edited = built.text.replace("| ### 1.1 错层 | ## 1.1 错层 |", "| ### 1.1 错层 | ## 1.1 改后标题 |");
    const applied = applyHeadingReviewTable(edited);

    expect(applied.hasReviewTable).toBe(true);
    expect(applied.appliedCount).toBeGreaterThan(0);
    expect(applied.text.includes("## 1.1 改后标题")).toBe(true);
  });

  it("keeps review table row alignment when some headings are restored to tag definition lines", () => {
    const input = [
      "### 3.3.2 数学公式 (Formula)",
      "#### 3.3.2.1 振幅 ( #Amplitude )：振荡的最大偏离量。",
      "### 3.3.3 关于角频率"
    ].join("\n");
    const built = buildHeadingReviewTable(input);
    const rowPattern = /\|\s*####\s*3\.3\.2\.1\s+振幅[\s\S]*?\|\s*#振幅\s*\(\s*#Amplitude\s*\)：振荡的最大偏离量。\s*\|/;

    expect(rowPattern.test(built.text)).toBe(true);
    expect(built.text.includes("| ### 3.3.3 关于角频率 | ### 3.3.3 关于角频率 |")).toBe(true);
    expect(built.text.includes("恢复术语定义行")).toBe(true);
  });

  it("applies restored tag-definition suggestion back to source line", () => {
    const input = ["### 3.3.2 数学公式 (Formula)", "#### 3.3.2.1 振幅 ( #Amplitude )：振荡的最大偏离量。", "后续正文"].join("\n");
    const built = buildHeadingReviewTable(input);
    const applied = applyHeadingReviewTable(built.text);

    expect(applied.appliedCount).toBeGreaterThan(0);
    expect(applied.text.includes("#振幅 ( #Amplitude )：振荡的最大偏离量。")).toBe(true);
  });

  it("keeps restored tag-definition line separated from following heading after apply", () => {
    const input = [
      "### 6.1.1 这条曲线在说什么 (What It Says)",
      "#### 6.1.1.1 阻尼振荡 ( #Damped-Oscillation ) 描述的是一边振荡一边衰减的运动。",
      "### 6.1.2 物理来源——从牛顿第二定律到阻尼振荡方程（完整推导链） (Complete Derivation)"
    ].join("\n");
    const built = buildHeadingReviewTable(input);
    const applied = applyHeadingReviewTable(built.text);

    expect(applied.text.includes("#阻尼振荡 ( #Damped-Oscillation ) 描述的是一边振荡一边衰减的运动。\n\n### 6.1.2 物理来源")).toBe(true);
  });

  it("remains idempotent around standalone math expression lines", () => {
    const input = ["$\\theta_i\\approx90^\\circ$", "", "此时：", "$\\theta_r\\approx90^\\circ$", "光几乎贴着表面反射出去。"].join("\n");
    const first = formatMarkdownWithStats(input).text;
    const second = formatMarkdownWithStats(first).text;

    expect(second).toBe(first);
  });
});
