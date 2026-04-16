import { describe, expect, it } from "vitest";
import {
  applyHeadingReviewTable,
  buildHeadingReviewTable,
  formatMarkdown,
  formatMarkdownContentOnly,
  formatMarkdownWithStats
} from "../src/formatter";
import {
  getHeadingMarkerStrength,
  hasExplicitHeadingPrefix,
  parseArabicHeadingPath,
  parseChineseHeadingPrefixNumber,
  parseHeadingMarker,
  parseHeadingDepthByArabicNumber,
  parseSingleNumericHeadingPrefix
} from "../src/headingNormalizationShared";

type HeadingMatrixCase = {
  name: string;
  input: string[];
  expected: string[];
};

type HeadingMatrixGroup = {
  category: string;
  cases: HeadingMatrixCase[];
};

type HeadingMarkerCase = {
  label: string;
  text: string;
  kind: string;
  strength: string;
  depth: number | null;
  numericPath: number[] | null;
  numericValue: number | null;
  alphaValue: string | null;
};

describe("formatMarkdown", () => {
  const headingMatrixGroups: HeadingMatrixGroup[] = [
    {
      category: "章节锚点",
      cases: [
        {
          name: "顶层单段数字章节在深层子节之后仍保持 H1",
          input: ["## 30.3 上一节", "# 31 下一章", "## 31.1 第一节"],
          expected: ["## 30.3 上一节", "", "# 31 下一章", "", "## 31.1 第一节"]
        },
        {
          name: "带句点的顶层数字章节不会被 special-section 语义误降级",
          input: ["# 30 关键结论和知识点总结", "## 30.1 核心公式", "## 30.2 核心思想", "# 31. 学习主线回顾"],
          expected: ["# 30 关键结论和知识点总结", "", "## 30.1 核心公式", "", "## 30.2 核心思想", "", "# 31 学习主线回顾"]
        },
        {
          name: "纯文本 H1 在编号子节后仍保持顶层章节",
          input: ["# 30 关键结论和知识点总结", "## 30.1 核心公式", "# 学习主线回顾"],
          expected: ["# 30 关键结论和知识点总结", "", "## 30.1 核心公式", "", "# 学习主线回顾"]
        },
        {
          name: "顶层章节锚点下的无编号子标题会自动补成章节内顺序编号",
          input: ["# 7 从二次势能到高斯分布", "### 前置知识", "### 核心结论"],
          expected: ["# 7 从二次势能到高斯分布", "", "## 7.1 前置知识", "", "## 7.2 核心结论"]
        }
      ]
    },
    {
      category: "跨位数章节",
      cases: [
        {
          name: "跨十位数章节切换时不会把 10 误挂到 9.9 之下",
          input: ["## 9.9 最后一小节", "# 10 下一章", "## 10.1 第一节"],
          expected: ["## 9.9 最后一小节", "", "# 10 下一章", "", "## 10.1 第一节"]
        },
        {
          name: "带句点的顶层章节锚点在跨十位数时仍保持顶层",
          input: ["## 30.9 最后一小节", "# 31. 下一章", "## 31.1 第一节"],
          expected: ["## 30.9 最后一小节", "", "# 31 下一章", "", "## 31.1 第一节"]
        },
        {
          name: "跨百位数章节切换时不会把 100 误挂到 99.9 之下",
          input: ["## 99.9 最后一小节", "# 100. 下一章", "## 100.1 第一节"],
          expected: ["## 99.9 最后一小节", "", "# 100 下一章", "", "## 100.1 第一节"]
        }
      ]
    },
    {
      category: "语义特例与混排",
      cases: [
        {
          name: "编号小节内部的特殊语义标题仍收敛为摘要小节",
          input: ["## 30.3 核心关系", "#### 学习主线回顾", "#### 容易混淆的点"],
          expected: ["## 30.3 核心关系", "", "### 学习主线回顾", "", "### 容易混淆的点"]
        },
        {
          name: "中文序号章节锚点与后续阿拉伯编号家族能够正确对齐",
          input: ["#### 五、第三族：距离依赖曲线", "### 5.1 双曲线", "## 5.1.1 子节"],
          expected: ["# 5 第三族：距离依赖曲线", "", "## 5.1 双曲线", "", "### 5.1.1 子节"]
        },
        {
          name: "中文章节、阿拉伯子节、字母小点与无编号说明混排时保持家族边界",
          input: ["#### 五、总论", "### 5.1 背景", "##### a. 现象", "###### 无编号补充", "##### b) 解释"],
          expected: ["# 5 总论", "", "## 5.1 背景", "", "### a. 现象", "", "### 无编号补充", "", "### b) 解释"]
        },
        {
          name: "字母小点之后恢复阿拉伯路径时不会丢失编号家族上下文",
          input: ["# 3 章节", "## 3.1 概览", "### a. 字母小点", "#### 3.1.1 恢复阿拉伯子节", "##### 无编号补充"],
          expected: ["# 3 章节", "", "## 3.1 概览", "", "### a. 字母小点", "", "### 3.1.1 恢复阿拉伯子节", "", "#### 3.1.1.1 无编号补充"]
        },
        {
          name: "字母序列小点会按 sibling 顺序自动收敛为连续 A/B/C",
          input: ["## 5.1 小节", "### A. 第一步", "### C. 跳号第三步", "### D) 第四步"],
          expected: ["## 5.1 小节", "", "### A. 第一步", "", "### B. 跳号第三步", "", "### C) 第四步"]
        },
        {
          name: "小写字母序列允许普通标题继续向下结构化扩展",
          input: ["## 5.1 小节", "### a) 第一步", "#### 无编号说明", "### c. 第三步"],
          expected: ["## 5.1 小节", "", "### a) 第一步", "", "#### 无编号说明", "", "### b. 第三步"]
        },
        {
          name: "中文到 alpha 再回到阿拉伯时字母序列与后续路径都保持稳定",
          input: ["#### 五、总论", "##### A. 观察", "##### C. 解释", "###### 5.1 回到阿拉伯", "###### 无编号补充"],
          expected: ["# 5 总论", "", "## A. 观察", "", "## B. 解释", "", "## 5.1 回到阿拉伯", "", "### 5.1.1 无编号补充"]
        },
        {
          name: "中文锚点下的 upper-alpha 与 lower-alpha 可形成稳定的两层结构扩展",
          input: ["#### 五、总论", "### 5.1 基线", "##### A. 一级观察", "###### a) 次级现象"],
          expected: ["# 5 总论", "", "## 5.1 基线", "", "### A. 一级观察", "", "#### a) 次级现象"]
        },
        {
          name: "alpha 复合路径 A.1 / A.1.1 与无编号总结可形成稳定结构",
          input: ["# 总论", "### A.1 一级主题", "##### A.1.1 二级主题", "###### 无编号总结"],
          expected: ["# 总论", "", "## A.1 一级主题", "", "### A.1.1 二级主题", "", "#### A.1.1.1 无编号总结"]
        }
      ]
    }
  ];

  const headingMatrixCases = headingMatrixGroups.flatMap((group) =>
    group.cases.map((testCase) => ({ ...testCase, category: group.category }))
  );

  it.each(headingMatrixCases)("keeps heading normalization matrix invariant [$category]: $name", ({ input, expected }) => {
    expect(formatMarkdown(input.join("\n"))).toBe(expected.join("\n"));
  });

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

  it("repairs mismatched subsection numbering according to parent heading path", () => {
    const input = [
      "# 3 三层递进：一个不等式的三重含义",
      "## 3.1 第一层：f''(0) 存在",
      "### 2.1.1 什么是尖点？",
      "### 2.1.2 为什么尖点处的导数不存在？",
      "### 2.1.5 反过来看高斯函数"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "# 3 三层递进：一个不等式的三重含义",
        "",
        "## 3.1 第一层：f''(0) 存在",
        "",
        "### 3.1.1 什么是尖点？",
        "",
        "### 3.1.2 为什么尖点处的导数不存在？",
        "",
        "### 3.1.3 反过来看高斯函数"
      ].join("\n")
    );
  });

  it("repairs out-of-order sibling numbering to the next sequential value", () => {
    const input = ["# 1 第一章", "## 1.1 小节A", "## 1.3 小节B", "## 1.7 小节C"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["# 1 第一章", "", "## 1.1 小节A", "", "## 1.2 小节B", "", "## 1.3 小节C"].join("\n"));
  });

  it("keeps deeper source level when dotted numbering omits parent segments", () => {
    const input = [
      "## 1.1 前置知识",
      "### 1.1.1 势能与力的关系",
      "### 1.1.2 为什么势能的零点可以自由选取？",
      "### 1.1.3 什么是平衡点？",
      "### 1.1.4 什么是泰勒展开？",
      "#### 1.1.4.1 直觉：站在雾中猜地形",
      "#### 1.4.2 公式与阶乘的来源",
      "#### 1.4.3 具体数字验证"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "## 1.1 前置知识",
        "",
        "### 1.1.1 势能与力的关系",
        "",
        "### 1.1.2 为什么势能的零点可以自由选取？",
        "",
        "### 1.1.3 什么是平衡点？",
        "",
        "### 1.1.4 什么是泰勒展开？",
        "",
        "#### 1.1.4.1 直觉：站在雾中猜地形",
        "",
        "#### 1.1.4.2 公式与阶乘的来源",
        "",
        "#### 1.1.4.3 具体数字验证"
      ].join("\n")
    );
  });

  it("keeps top-level single-number headings as top-level and resets following subsections", () => {
    const input = [
      "# 1 这个问题为什么重要？",
      "## 1.1 前置知识",
      "### 1.1.1 势能与力的关系",
      "### 1.1.2 为什么势能的零点可以自由选取？",
      "### 1.1.3 什么是平衡点？",
      "### 1.1.4 什么是泰勒展开？",
      "#### 1.4.2 公式与阶乘的来源",
      "### 1.5 什么叫光滑？",
      "# 2 核心推导：平衡点附近，哪些项活下来？",
      "## 第 0 项：常数，令其为零",
      "## 第 1 项：因为平衡条件，消失！",
      "# 3 灵魂问题：为什么绝对值不会出现？",
      "## 3.1 直觉层：碗底 vs V 字槽"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "# 1 这个问题为什么重要？",
        "",
        "## 1.1 前置知识",
        "",
        "### 1.1.1 势能与力的关系",
        "",
        "### 1.1.2 为什么势能的零点可以自由选取？",
        "",
        "### 1.1.3 什么是平衡点？",
        "",
        "### 1.1.4 什么是泰勒展开？",
        "",
        "#### 1.1.4.1 公式与阶乘的来源",
        "",
        "### 1.1.5 什么叫光滑？",
        "",
        "# 2 核心推导：平衡点附近，哪些项活下来？",
        "",
        "## 2.1 第 0 项：常数，令其为零",
        "",
        "## 2.2 第 1 项：因为平衡条件，消失！",
        "",
        "# 3 灵魂问题：为什么绝对值不会出现？",
        "",
        "## 3.1 直觉层：碗底 vs V 字槽"
      ].join("\n")
    );
  });

  it("auto-numbers unnumbered child headings under top-level chapter anchor", () => {
    const input = [
      "# 2 核心推导：平衡点附近，哪些项活下来？",
      "### 第 0 项：$V(x_0)$ ——常数，令其为零",
      "### 第 1 项：$V'(x_0)\\cdot\\delta$ ——因为平衡条件，消失！",
      "### ⭐ 第 2 项：$\\frac{1}{2}V''(x_0)\\,\\delta^2$ ——第一个活下来的项！"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "# 2 核心推导：平衡点附近，哪些项活下来？",
        "",
        "## 2.1 第 0 项：$V(x_0)$ ——常数，令其为零",
        "",
        "## 2.2 第 1 项：$V'(x_0)\\cdot\\delta$ ——因为平衡条件，消失！",
        "",
        "## 2.3 ⭐ 第 2 项：$\\frac{1}{2}V''(x_0)\\,\\delta^2$ ——第一个活下来的项！"
      ].join("\n")
    );
  });

  it("keeps explicit 3.2/3.3 headings as siblings of 3.1 instead of nesting under it", () => {
    const input = [
      "# 3 灵魂问题：为什么绝对值不会出现？",
      "### 3.1 直觉层：碗底 vs V 字槽",
      "### 3.2 数学层：|x| 在原点不可微，泰勒展开产生不了它",
      "### 3.3 力的层面：阶跃力 vs 线性恢复力",
      "### 3.4 物理层：自然界为什么不产生尖角势能？"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "# 3 灵魂问题：为什么绝对值不会出现？",
        "",
        "## 3.1 直觉层：碗底 vs V 字槽",
        "",
        "## 3.2 数学层：|x| 在原点不可微，泰勒展开产生不了它",
        "",
        "## 3.3 力的层面：阶跃力 vs 线性恢复力",
        "",
        "## 3.4 物理层：自然界为什么不产生尖角势能？"
      ].join("\n")
    );
  });

  it("increments repeated top-level chapter number after an existing 3.x section family", () => {
    const input = [
      "# 3 三层递进：一个不等式的三重含义",
      "## 3.1 第一层",
      "## 3.2 第二层",
      "## 3.3 第三层",
      "## 3.4 判别法",
      "## 3.5 即时验证",
      "## 3.6 三层信息的汇总",
      "# 3 Taylor 展开：峰顶就是下开口抛物线",
      "## 3.7 Taylor 展开的基本思想"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "# 3 三层递进：一个不等式的三重含义",
        "",
        "## 3.1 第一层",
        "",
        "## 3.2 第二层",
        "",
        "## 3.3 第三层",
        "",
        "## 3.4 判别法",
        "",
        "## 3.5 即时验证",
        "",
        "## 3.6 三层信息的汇总",
        "",
        "# 4 Taylor 展开：峰顶就是下开口抛物线",
        "",
        "## 4.1 Taylor 展开的基本思想"
      ].join("\n")
    );
  });

  it("keeps # 31 as a new top-level chapter after ## 30.3 instead of nesting it under 30.3", () => {
    const input = ["## 30.3 上一节", "# 31 下一章", "## 31.1 第一节"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["## 30.3 上一节", "", "# 31 下一章", "", "## 31.1 第一节"].join("\n"));
  });

  it("does not downgrade numbered top-level special-section titles after 30.x subsections", () => {
    const input = [
      "# 30 关键结论和知识点总结",
      "## 30.1 核心公式",
      "## 30.2 核心思想",
      "## 30.3 核心关系",
      "# 31. 学习主线回顾",
      "# 32 容易混淆的点",
      "# 33 专业术语/关键词中英文对照并标注 tag",
      "# 34 附录：标准高斯积分为什么等于 $\\sqrt{2\\pi}$"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "# 30 关键结论和知识点总结",
        "",
        "## 30.1 核心公式",
        "",
        "## 30.2 核心思想",
        "",
        "## 30.3 核心关系",
        "",
        "# 31 学习主线回顾",
        "",
        "# 32 容易混淆的点",
        "",
        "# 33 专业术语/关键词中英文对照并标注 tag",
        "",
        "# 34 附录：标准高斯积分为什么等于 $\\sqrt{2\\pi}$"
      ].join("\n")
    );
  });

  it("still keeps non-numbered special-section headings as internal summaries under numbered subsections", () => {
    const input = ["## 30.3 核心关系", "#### 学习主线回顾", "#### 容易混淆的点", "#### 专业术语/关键词中英文对照并标注 tag"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      [
        "## 30.3 核心关系",
        "",
        "### 学习主线回顾",
        "",
        "### 容易混淆的点",
        "",
        "### 专业术语/关键词中英文对照并标注 tag"
      ].join("\n")
    );
  });

  it("keeps plain h1 headings as new top-level sections even after numbered subsections", () => {
    const input = ["# 30 关键结论和知识点总结", "## 30.1 核心公式", "## 30.2 核心思想", "# 学习主线回顾"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["# 30 关键结论和知识点总结", "", "## 30.1 核心公式", "", "## 30.2 核心思想", "", "# 学习主线回顾"].join("\n"));
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

  it("ignores headings inside leading frontmatter-like block", () => {
    const input = [
      "---",
      "## 阶段 1：诊断与评分",
      "### 1. 错误与遗漏",
      "---",
      "# 1 为什么要关心峰顶形状"
    ].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(
      ["---", "## 阶段 1：诊断与评分", "### 1. 错误与遗漏", "---", "", "# 1 为什么要关心峰顶形状"].join("\n")
    );
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

  it("keeps one blank line before table header row for android live preview parsing", () => {
    const input = ["正文内容", "| 列1 | 列2 |", "| --- | --- |", "| A | B |"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["正文内容", "", "| 列1 | 列2 |", "| --- | --- |", "| A | B |"].join("\n"));
  });

  it("inserts one blank line before table when previous text ends with colon for android live preview parsing", () => {
    const input = ["如下：", "| 列1 | 列2 |", "| --- | --- |", "| A | B |"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["如下：", "", "| 列1 | 列2 |", "| --- | --- |", "| A | B |"].join("\n"));
  });

  it("inserts one blank line before table when separator row uses alignment syntax for android live preview parsing", () => {
    const input = ["如下：", "| 列1 | 列2 |", "| :-- | :-- |", "| A | B |"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["如下：", "", "| 列1 | 列2 |", "| :-- | :-- |", "| A | B |"].join("\n"));
  });

  it("keeps exactly one blank line before table and normal spacing after table for android live preview", () => {
    const input = ["上一段正文", "", "", "| 列1 | 列2 |", "| --- | --- |", "| A | B |", "", "", "下一段正文"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["上一段正文", "", "| 列1 | 列2 |", "| --- | --- |", "| A | B |", "下一段正文"].join("\n"));
  });

  it("keeps exactly one blank line before table after heading for android live preview", () => {
    const input = ["# 标题", "| 列1 | 列2 |", "| --- | --- |", "| A | B |", "下一段正文"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["# 标题", "", "| 列1 | 列2 |", "| --- | --- |", "| A | B |", "下一段正文"].join("\n"));
  });

  it("keeps exactly one blank line before table after list for android live preview", () => {
    const input = ["- 要点A", "- 要点B", "| 列1 | 列2 |", "| --- | --- |", "| A | B |", "下一段正文"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["- 要点A", "- 要点B", "", "| 列1 | 列2 |", "| --- | --- |", "| A | B |", "下一段正文"].join("\n"));
  });

  it("keeps exactly one blank line before table after callout for android live preview", () => {
    const input = ["> [!note]", "> 说明内容", "| 列1 | 列2 |", "| --- | --- |", "| A | B |", "下一段正文"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["> [!note]", "> 说明内容", "", "| 列1 | 列2 |", "| --- | --- |", "| A | B |", "下一段正文"].join("\n"));
  });

  it("keeps normal spacing when heading follows table", () => {
    const input = ["正文内容", "| 列1 | 列2 |", "| --- | --- |", "| A | B |", "## 后续标题", "下一段正文"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["正文内容", "", "| 列1 | 列2 |", "| --- | --- |", "| A | B |", "", "## 后续标题", "", "下一段正文"].join("\n"));
  });

  it("keeps normal spacing when list follows table", () => {
    const input = ["正文内容", "| 列1 | 列2 |", "| --- | --- |", "| A | B |", "- 要点A", "- 要点B", "后续正文"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["正文内容", "", "| 列1 | 列2 |", "| --- | --- |", "| A | B |", "- 要点A", "- 要点B", "", "后续正文"].join("\n"));
  });

  it("keeps normal spacing when callout follows table", () => {
    const input = ["正文内容", "| 列1 | 列2 |", "| --- | --- |", "| A | B |", "> [!tip]", "> 后续说明", "下一段正文"].join("\n");
    const output = formatMarkdown(input);

    expect(output).toBe(["正文内容", "", "| 列1 | 列2 |", "| --- | --- |", "| A | B |", "> [!tip]", "> 后续说明", "", "下一段正文"].join("\n"));
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
    expect(first.text.includes("　　↳ ### 1.1 错层")).toBe(true);
  });

  it("excludes headings inside leading frontmatter-like block from heading review table", () => {
    const input = ["---", "## 阶段 1：诊断与评分", "### 1. 错误与遗漏", "---", "# 1 为什么要关心峰顶形状"].join("\n");
    const built = buildHeadingReviewTable(input);

    expect(built.itemCount).toBe(1);
    expect(built.text.includes("| ## 阶段 1：诊断与评分 |")).toBe(false);
    expect(built.text.includes("| # 1 为什么要关心峰顶形状 |")).toBe(true);
  });

  it("uses refined review flags for parent-path completion and sibling resequencing", () => {
    const input = [
      "## 1.1 前置知识",
      "### 1.1.4 什么是泰勒展开？",
      "#### 1.4.2 公式与阶乘的来源",
      "#### 1.4.3 具体数字验证"
    ].join("\n");
    const built = buildHeadingReviewTable(input);

    expect(/父路径补全|同级顺排/.test(built.text)).toBe(true);
  });

  it("uses refined review flags for top-level chapter anchor repair", () => {
    const input = ["## 1.1 前置知识", "###### 2. 核心推导：平衡点附近，哪些项活下来？"].join("\n");
    const built = buildHeadingReviewTable(input);

    expect(built.text.includes("2. 核心推导：平衡点附近，哪些项活下来？")).toBe(true);
  });

  it("applies edited heading review rows back to source headings", () => {
    const input = ["# 一章", "###1.1 错层", "正文"].join("\n");
    const built = buildHeadingReviewTable(input);
    const edited = built.text.replace("| 　　↳ ### 1.1 错层 | 　↳ ## 1.1 错层 |", "| 　　↳ ### 1.1 错层 | 　↳ ## 1.1 改后标题 |");
    const applied = applyHeadingReviewTable(edited);
    const contentOnly = applied.text.split("<!-- MD-FMT-HEADING-REVIEW:START -->")[0] ?? applied.text;

    expect(applied.hasReviewTable).toBe(true);
    expect(applied.appliedCount).toBeGreaterThan(0);
    expect(applied.text.includes("## 1.1 改后标题")).toBe(true);
    expect(contentOnly.includes("↳ ## 1.1 改后标题")).toBe(false);
  });

  it("remains stable after heading review apply and reformat for top-level anchors", () => {
    const input = ["# 30 总结", "## 30.1 核心公式", "# 31. 学习主线回顾", "# 32 容易混淆的点"].join("\n");
    const built = buildHeadingReviewTable(input);
    const applied = applyHeadingReviewTable(built.text);
    const reformatted = formatMarkdown(applied.text);

    expect(reformatted).toContain("# 31 学习主线回顾");
    expect(reformatted).toContain("# 32 容易混淆的点");
    expect(reformatted).not.toContain("### 31");
  });

  it("remains stable after heading review apply and reformat for chinese-alpha-arabic mixed headings", () => {
    const input = ["#### 五、总论", "### 5.1 背景", "##### a. 现象", "#### 5.1.1 回到阿拉伯路径", "##### 无编号补充"].join("\n");
    const built = buildHeadingReviewTable(input);
    const applied = applyHeadingReviewTable(built.text);
    const reformatted = formatMarkdown(applied.text);

    expect(reformatted).toContain("# 5 总论");
    expect(reformatted).toContain("### a. 现象");
    expect(reformatted).toContain("### 5.1.1 回到阿拉伯路径");
    expect(reformatted).toContain("#### 5.1.1.1 无编号补充");
  });

  it("remains stable after heading review apply and reformat for ordered alpha siblings", () => {
    const input = ["## 5.1 小节", "### A. 第一步", "### C. 跳号第三步", "### D) 第四步"].join("\n");
    const built = buildHeadingReviewTable(input);
    const applied = applyHeadingReviewTable(built.text);
    const reformatted = formatMarkdown(applied.text);

    expect(reformatted).toContain("### A. 第一步");
    expect(reformatted).toContain("### B. 跳号第三步");
    expect(reformatted).toContain("### C) 第四步");
  });

  it("remains stable after heading review apply and reformat for nested lower-alpha sequence with plain child", () => {
    const input = ["## 5.1 小节", "### a) 第一步", "#### 无编号说明", "### c. 第三步"].join("\n");
    const built = buildHeadingReviewTable(input);
    const applied = applyHeadingReviewTable(built.text);
    const reformatted = formatMarkdown(applied.text);

    expect(reformatted).toContain("### a) 第一步");
    expect(reformatted).toContain("#### 无编号说明");
    expect(reformatted).toContain("### b. 第三步");
  });

  it("remains stable after heading review apply and reformat for alpha composite paths", () => {
    const input = ["# 总论", "### A.1 一级主题", "##### A.1.1 二级主题", "###### 无编号总结"].join("\n");
    const built = buildHeadingReviewTable(input);
    const applied = applyHeadingReviewTable(built.text);
    const reformatted = formatMarkdown(applied.text);

    expect(reformatted).toContain("## A.1 一级主题");
    expect(reformatted).toContain("### A.1.1 二级主题");
    expect(reformatted).toContain("#### A.1.1.1 无编号总结");
  });

  it("preserves escaped pipe-like latex content when applying heading review rows", () => {
    const input = ["# 3. 灵魂问题：为什么绝对值 $\\|x-x_0\\|$ 不会出现？(Why Not $\\|x-x_0\\|$?)"].join("\n");
    const built = buildHeadingReviewTable(input);
    expect(built.text.includes("\\｜x-x_0\\｜")).toBe(true);
    const edited = built.text
      .split("\n")
      .map((line) =>
        line.trim().startsWith("| # 3. 灵魂问题：为什么绝对值")
          ? "| # 3. 灵魂问题：为什么绝对值 $\\｜x-x_0\\｜$ 不会出现？(Why Not $\\｜x-x_0\\｜$?) | # 3. 灵魂问题：为什么绝对值 $\\｜x-x_0\\｜$ 真的不会出现？(Why Not $\\｜x-x_0\\｜$?) | 编号/文本调整 |"
          : line
      )
      .join("\n");
    const applied = applyHeadingReviewTable(edited);

    expect(applied.text.includes("\\|x-x_0\\|")).toBe(true);
    expect(applied.text.includes("真的不会出现")).toBe(true);
  });

  it("keeps review table row alignment when some headings are restored to tag definition lines", () => {
    const input = [
      "### 3.3.2 数学公式 (Formula)",
      "#### 3.3.2.1 振幅 ( #Amplitude )：振荡的最大偏离量。",
      "### 3.3.3 关于角频率"
    ].join("\n");
    const built = buildHeadingReviewTable(input);
    const rowPattern = /\|\s*　　　↳\s*####\s*3\.3\.2\.1\s+振幅[\s\S]*?\|\s*#振幅\s*\(\s*#Amplitude\s*\)：振荡的最大偏离量。\s*\|/;

    expect(rowPattern.test(built.text)).toBe(true);
    expect(built.text.includes("| 　　↳ ### 3.3.3 关于角频率 | 　　↳ ### 3.3.3 关于角频率 |")).toBe(true);
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

    expect(applied.text.includes("6.1.2 物理来源")).toBe(true);
  });

  it("remains idempotent around standalone math expression lines", () => {
    const input = ["$\\theta_i\\approx90^\\circ$", "", "此时：", "$\\theta_r\\approx90^\\circ$", "光几乎贴着表面反射出去。"].join("\n");
    const first = formatMarkdownWithStats(input).text;
    const second = formatMarkdownWithStats(first).text;

    expect(second).toBe(first);
  });
});

describe("heading marker parser", () => {
  const markerCases: HeadingMarkerCase[] = [
    { label: "中文裸序号", text: "一 标题", kind: "chinese_numeric", strength: "structured", depth: 1, numericPath: [1], numericValue: 1, alphaValue: null },
    { label: "中文顿号序号", text: "一、 标题", kind: "chinese_numeric", strength: "structured", depth: 1, numericPath: [1], numericValue: 1, alphaValue: null },
    { label: "阿拉伯裸数字", text: "1 标题", kind: "arabic_single", strength: "structured", depth: 1, numericPath: [1], numericValue: 1, alphaValue: null },
    { label: "阿拉伯点号单段", text: "1. 标题", kind: "arabic_single", strength: "structured", depth: 1, numericPath: [1], numericValue: 1, alphaValue: null },
    { label: "阿拉伯路径", text: "1.1 标题", kind: "arabic_path", strength: "structured", depth: 2, numericPath: [1, 1], numericValue: 1, alphaValue: null },
    { label: "阿拉伯路径尾点", text: "1.1. 标题", kind: "arabic_path", strength: "structured", depth: 2, numericPath: [1, 1], numericValue: 1, alphaValue: null },
    { label: "阿拉伯三级路径", text: "1.1.1 标题", kind: "arabic_path", strength: "structured", depth: 3, numericPath: [1, 1, 1], numericValue: 1, alphaValue: null },
    { label: "upper alpha 复合路径", text: "A.1 标题", kind: "alpha_compound_upper", strength: "structured", depth: 2, numericPath: [1, 1], numericValue: 1, alphaValue: "A" },
    { label: "upper alpha 三级复合路径", text: "A.1.1 标题", kind: "alpha_compound_upper", strength: "structured", depth: 3, numericPath: [1, 1, 1], numericValue: 1, alphaValue: "A" },
    { label: "lower alpha 复合路径", text: "a.2 标题", kind: "alpha_compound_lower", strength: "structured", depth: 2, numericPath: [1, 2], numericValue: 1, alphaValue: "a" },
    { label: "小写裸字母", text: "a 标题", kind: "alpha_single_lower", strength: "weak_explicit", depth: 1, numericPath: null, numericValue: null, alphaValue: "a" },
    { label: "小写点号字母", text: "a. 标题", kind: "alpha_single_lower", strength: "ordered_explicit", depth: 1, numericPath: null, numericValue: null, alphaValue: "a" },
    { label: "小写右括号字母", text: "a) 标题", kind: "alpha_single_lower", strength: "ordered_explicit", depth: 1, numericPath: null, numericValue: null, alphaValue: "a" },
    { label: "小写右括号加点字母", text: "a). 标题", kind: "alpha_single_lower", strength: "ordered_explicit", depth: 1, numericPath: null, numericValue: null, alphaValue: "a" },
    { label: "大写裸字母", text: "A 标题", kind: "alpha_single_upper", strength: "weak_explicit", depth: 1, numericPath: null, numericValue: null, alphaValue: "A" },
    { label: "大写点号字母", text: "A. 标题", kind: "alpha_single_upper", strength: "ordered_explicit", depth: 1, numericPath: null, numericValue: null, alphaValue: "A" },
    { label: "大写右括号字母", text: "A) 标题", kind: "alpha_single_upper", strength: "ordered_explicit", depth: 1, numericPath: null, numericValue: null, alphaValue: "A" },
    { label: "大写右括号加点字母", text: "A). 标题", kind: "alpha_single_upper", strength: "ordered_explicit", depth: 1, numericPath: null, numericValue: null, alphaValue: "A" }
  ];

  it.each(markerCases)("parses heading marker: $label", ({ text, kind, strength, depth, numericPath, numericValue, alphaValue }) => {
    const marker = parseHeadingMarker(text);

    expect(marker.kind).toBe(kind);
    expect(getHeadingMarkerStrength(marker)).toBe(strength);
    expect(marker.logicalDepth).toBe(depth);
    expect(marker.numericPath).toEqual(numericPath);
    expect(marker.numericValue).toBe(numericValue);
    expect(marker.alphaValue).toBe(alphaValue);
    expect(hasExplicitHeadingPrefix(text)).toBe(true);
  });

  it("keeps legacy parser outputs aligned with unified heading marker", () => {
    expect(parseChineseHeadingPrefixNumber("一、 标题")).toBe(1);
    expect(parseSingleNumericHeadingPrefix("1. 标题")).toBe(1);
    expect(parseHeadingDepthByArabicNumber("1.1. 标题")).toBe(2);
    expect(parseArabicHeadingPath("1.1.1 标题")).toEqual([1, 1, 1]);
    expect(hasExplicitHeadingPrefix("A). 标题")).toBe(true);
  });
});
