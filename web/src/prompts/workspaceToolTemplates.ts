/**
 * 工作区 Pi 附加工具返回给模型的 Markdown 模版（叙事骨架、追问卡、度量报告等）。
 */

export const NARRATIVE_TEMPLATE_BLOCKS: Record<
  '三幕结构骨架' | '七步故事线' | '人物目标-阻碍-转变',
  string
> = {
  三幕结构骨架: [
    '### 三幕结构（填空）',
    '- **常态世界**：',
    '- **诱发事件**：',
    '- **第一转折点（进入对抗）**：',
    '- **中点（伪胜利/伪失败）**：',
    '- **一切倾覆**：',
    '- **高潮**：',
    '- **新常态**：',
  ].join('\n'),
  七步故事线: [
    '### 七步故事线（填空）',
    '1. **弱点/缺失**：',
    '2. **诱惑**：',
    '3. **新世界**：',
    '4. **问题深化**：',
    '5. **一切尽失**：',
    '6. **灵魂黑夜**：',
    '7. **兑现**：',
  ].join('\n'),
  '人物目标-阻碍-转变': [
    '### 人物三角（每场适用）',
    '- **外在目标**：',
    '- **内在需求**：',
    '- **对立力量（人/制度/环境）**：',
    '- **赌注（失败会失去什么）**：',
    '- **转变（本章结束后的心态变化）**：',
  ].join('\n'),
}

export function buildLoglineExpansionMarkdown(logline: string): string {
  return [
    '### 围绕这句话继续追问（请逐条作答或挑选有用部分）',
    `梗概：**${logline.trim()}**`,
    '',
    '- 主角**最具体**的外在目标是什么？成功的客观标准？',
    '- 对立面**为什么**此刻挡路？（利益/信念/信息差）',
    '- 核心秘密或误导：**读者知道但角色不知道**的是什么？',
    '- **时钟/时限**：何时到期？到期后果？',
    '- 若主角失败，**最坏且可信**的结局是什么？',
  ].join('\n')
}

export function buildSceneBeatHintReport(
  paraCount: number,
  dialogueHeavy: number,
): string {
  return [
    '### 场次结构速描（启发式）',
    `- 估算段落块：${paraCount}`,
    `- 含引号/对白标记片段估计：较多${dialogueHeavy > 8 ? '（偏对白向）' : ''}`,
    '- 建议检查清单：',
    '  - 本场上半场是否交代**目标**与**障碍**？',
    '  - 中场是否有**新信息**改变人物策略？',
    '  - 收束是否有**情绪余波**或**悬念钩子**？',
  ].join('\n')
}

export const CAUSALITY_CHEATSHEET_MARKDOWN = [
  '### 场次因果追问卡',
  '- **因为**上一场结束后，人物知道了什么？',
  '- **所以**他此刻采取的行动是合理且唯一合理的吗？',
  '- **但是**新的意外是什么？谁受益、谁受损？',
  '- **因此**下一场的最低信息增量是什么？',
].join('\n')

export function buildOutlineHierarchyScanMarkdown(
  counts: { h1: number; h2: number; h3: number; h4: number },
  total: number,
): string {
  return [
    '### 大纲层级扫描',
    `- #：${counts.h1}  ·  ##：${counts.h2}  ·  ###：${counts.h3}  ·  ####：${counts.h4}`,
    `- 标题节点合计：${total}`,
    total === 0
      ? '未发现 Markdown 标题，若使用纯列表也成立；可考虑用 # / ## 区分卷与章。'
      : '若 ## 过多而 # 过少，可能卷层缺失；若 ### 暴涨，可能章节内小节过碎。',
  ].join('\n')
}

export function buildChapterStubGridMarkdown(
  chapterCount: number,
  workingTitleHint?: string,
): string {
  const rows: string[] = [
    '### 分章占位（可改）',
    workingTitleHint ? `提示：${workingTitleHint.trim()}` : '',
    '',
    '| 章 | 标题（一句情节） | 视点/时间 | 备注 |',
    '|---|---|---|---|',
  ].filter(Boolean)
  for (let i = 1; i <= chapterCount; i++) {
    rows.push(`| ${i} |  |  |  |`)
  }
  return rows.join('\n')
}

export function buildManuscriptMetricsMarkdown(
  charCount: number,
  paraCount: number,
  quoteLines: number,
  longLines: number,
): string {
  return [
    '### 稿件度量（近似）',
    `- 字符数（含标点的粗略计数）：${charCount}`,
    `- 段落块：${paraCount}`,
    `- 疑似对白行（含弯引号类字符）：${quoteLines}`,
    `- 超长行（>120 字）：${longLines}（可考虑拆句或分段）`,
  ].join('\n')
}

const REVIEW_RUBRIC_BASE = [
  '### 通用审稿维度',
  '- 开场是否**迅速建立目标与阻碍**？',
  '- **信息释放**是否可控（读者是否比人物知道得恰到好处）？',
  '- 人物选择是否符合**已建立的性格与经历**？',
  '- 场景是否存在**可合并或删去**的重复功能？',
]

const REVIEW_RUBRIC_EXTRA: Record<
  'full' | 'pacing' | 'character' | 'style',
  string[]
> = {
  full: [],
  pacing: [
    '### 节奏专项',
    '- 相邻两场情绪起落是否过于平缓或过于密集？',
    '- 中段是否有「事务性」章节可并入主线推进？',
  ],
  character: [
    '### 人设专项',
    '- 语言习惯是否区分主要角色？',
    '- 人物欲望在中后段是否发生有机转变？',
  ],
  style: [
    '### 文笔专项',
    '- 是否存在同义反复与空洞形容词堆叠？',
    '- 描写是否服务叙事焦点（可删的环境句）？',
  ],
}

export function buildEditorialRubricMarkdown(
  focus: 'full' | 'pacing' | 'character' | 'style',
): string {
  return [...REVIEW_RUBRIC_BASE, ...(REVIEW_RUBRIC_EXTRA[focus] ?? [])].join(
    '\n',
  )
}

export function buildLineNoiseScanMarkdown(
  doublePunct: number,
  shortParas: number,
  longSent: number,
): string {
  return [
    '### 快扫提示（启发式，需人工复核）',
    `- 连续句末标点堆叠疑似：${doublePunct} 处`,
    `- 极短段（<12 字）：${shortParas} 段（可核对是否为风格或误断句）`,
    `- 超长意群（粗略按句号估算 >80 字）：${longSent} 处`,
  ].join('\n')
}
