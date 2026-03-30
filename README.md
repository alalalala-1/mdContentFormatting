# MD Content Formatting

Obsidian 插件，用于自动整理 Markdown 结构，提升长文档在 Reading / Live Preview 下的一致性与可读性。

## 项目目标

- 统一标题层级，减少手工维护成本
- 规范空行与段落边界，降低渲染异常概率
- 优化图片与列表在 Obsidian 中的显示体验

## 主要功能

- 标题层级规范化
  - 支持递进编号标题（如 `4.1`、`4.1.1`）自动映射层级
  - 非递进前缀标题（如 `1.`、`A.`、纯文本）按规则归类
  - 支持“小节后特例三级标题”语义识别（模糊匹配）
- 标题快修与正文 tag 识别
  - 支持生成/回写标题快修表
  - 支持将“中文标签 + 英文 tag”正文定义行从误判标题中恢复，并规范 `#标签` 形式
- 空行规范化
  - 标题、列表、表格、callout、分割线前后空行统一
  - 处理表格前空行、图片与 callout 紧邻场景
- 公式规范化
  - `$$` 起始行强制左对齐（去除前导空白）
- 无编号列表可读性优化
  - 嵌套层级符号与显示增强
  - Live Preview 模式下可视区分优化
- 图片显示优化
  - 插图居中
  - 自适应宽度（保留手动宽度优先）

## 使用方式

安装插件后，在 Obsidian 命令面板执行：

- `Format current note (headings + content)`
- `Format current note (content only)`
- `Generate/refresh heading review table`
- `Apply heading review table to headings`

插件会对当前笔记执行格式化与显示优化。

## 兼容性

- `minAppVersion`: `1.5.0`
- 插件版本：`0.1.4`

## 开发

```bash
npm install
npm run test
npm run lint
npm run typecheck
npm run build
```

## 仓库与发布

- 仓库：https://github.com/alalalala-1/mdContentFormatting
- 最新发布：https://github.com/alalalala-1/mdContentFormatting/releases/tag/v0.1.4
