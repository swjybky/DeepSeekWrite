# Impeccable

你不知道自己需要的词汇体系：1 套 Skill、20 条指令，以及为无可挑剔的前端设计整理的「反模式」清单。

> **快速上手：** 访问 [impeccable.style](https://impeccable.style) 下载即用合集。

## 为什么是 Impeccable？

Anthropic 发布了 [frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design)，用于引导 Claude 做出更好的 UI 设计。Impeccable 在此基础上深化专业能力并增强可控性。

大模型往往沿用同质化模板。若没有指引，你会反复遇到预期之中的问题：Inter 字体、紫色渐变、卡片套卡片、彩色背景上的灰色文字。

Impeccable 通过以下方式对抗这种偏好：
- **扩展后的 Skill**，内含 7 份领域参考文档（[查看源码](source/skills/frontend-design/)）
- **20 条导向指令**，用于审计、评审、润色、提纯、动效等
- **精选反模式**，明确告诉 AI **不要做**什么

## 包含内容

### Skill：frontend-design

一套全面的设计 Skill，附 7 份领域参考（[查看 SKILL](source/skills/frontend-design/SKILL.md)）：

| 参考文档 | 涵盖内容 |
|-----------|--------|
| [typography](source/skills/frontend-design/reference/typography.md) | 排版体系、字体搭配、模块化字号、OpenType |
| [color-and-contrast](source/skills/frontend-design/reference/color-and-contrast.md) | OKLCH、带色相的中性色、深色模式、无障碍 |
| [spatial-design](source/skills/frontend-design/reference/spatial-design.md) | 间距体系、栅格、视觉层级 |
| [motion-design](source/skills/frontend-design/reference/motion-design.md) | 缓动曲线、错位编排、减少动态偏好 |
| [interaction-design](source/skills/frontend-design/reference/interaction-design.md) | 表单、焦点态、加载模式 |
| [responsive-design](source/skills/frontend-design/reference/responsive-design.md) | Mobile-first、流体布局、容器查询 |
| [ux-writing](source/skills/frontend-design/reference/ux-writing.md) | 按钮文案、错误信息、空状态文案 |

### 20 条指令

| 指令 | 作用 |
|---------|--------------|
| `/teach-impeccable` | 一次性设置：收集设计上下文并写入配置 |
| `/audit` | 运行技术质量检查（无障碍、性能、响应式等） |
| `/critique` | UX 设计评审：层级、清晰度、情感共鸣 |
| `/normalize` | 与设计系统规范对齐 |
| `/polish` | 上线前最后一遍打磨 |
| `/distill` | 删繁就简，保留本质 |
| `/clarify` | 优化含糊的 UX 文案 |
| `/optimize` | 性能优化 |
| `/harden` | 错误处理、国际化、边界情况 |
| `/animate` | 加入有目的的动效 |
| `/colorize` | 策略性增加色彩 |
| `/bolder` | 让平淡设计更有张力 |
| `/quieter` | 减弱过于抢眼的风格 |
| `/delight` | 增加小惊喜与愉悦感 |
| `/extract` | 抽离为可复用组件 |
| `/adapt` | 适配不同设备与场景 |
| `/onboard` | 设计引导与入门流程 |
| `/typeset` | 修正字体、层级、字号 |
| `/arrange` | 调整布局、间距、视觉节奏 |
| `/overdrive` | 加入技术上更「出格」的效果 |

#### 使用示例

**`/audit`** — 运行质量检查，生成报告（不直接改代码）
```
/audit blog              # 审计博客聚合页与文章页
/audit dashboard         # 检查仪表盘组件
/audit checkout flow     # 聚焦结账流程 UX
```
*适用时机：* 在动手修改之前，先了解需要修什么。

**`/normalize`** — 与设计系统对齐
```
/normalize blog          # 应用设计 token、修正间距
/normalize buttons       # 统一按钮样式
```
*适用时机：* 审计之后，用来消除不一致。

**`/critique`** — UX 设计评审
```
/critique landing page   # 评审落地页 UX
/critique onboarding     # 检查引导流程
```
*适用时机：* 需要设计反馈，而非单纯技术修复时。

**`/polish`** — 上线前最后一遍
```
/polish feature modal    # 发布前整理弹窗
/polish settings page    # 设置页 UI 终检
```
*适用时机：* 部署到生产环境前的最后一步。

**组合使用：**
```
/audit /normalize /polish blog    # 完整流程：审计 → 修正 → 润色
/critique /harden checkout        # UX 评审 + 补充错误处理
```

### 反模式

Skill 中会明确说明应避免的做法：

- 不要使用过滥字体（Arial、Inter、系统默认栈）
- 不要在彩色背景上使用灰色正文
- 不要使用纯黑/纯灰（应带色相微调）
- 不要把所有内容都包进卡片，或卡片嵌套卡片
- 不要使用弹跳/弹性缓动（容易显得过时）

## 实际效果

访问 [impeccable.style](https://impeccable.style#casestudies) 查看真实项目在 Impeccable 指令前后的案例对比。

## 安装

### 方式一：从网站下载（推荐）

访问 [impeccable.style](https://impeccable.style)，按你的工具下载 ZIP 并解压到项目中。

### 方式二：从仓库复制

**Cursor：**
```bash
cp -r dist/cursor/.cursor your-project/
```

> **说明：** Cursor 中的 Skills 需要额外设置：
> 1. 在 Cursor 设置 → Beta 中切换到 Nightly 通道
> 2. 在 Cursor 设置 → Rules 中启用 Agent Skills
>
> [进一步了解 Cursor Skills](https://cursor.com/docs/context/skills)

**Claude Code：**
```bash
# 仅当前项目
cp -r dist/claude-code/.claude your-project/

# 或全局（作用于所有项目）
cp -r dist/claude-code/.claude/* ~/.claude/
```

**OpenCode：**
```bash
cp -r dist/opencode/.opencode your-project/
```

**Pi：**
```bash
cp -r dist/pi/.pi your-project/
```

**Gemini CLI：**
```bash
cp -r dist/gemini/.gemini your-project/
```

> **说明：** Gemini CLI 的 Skills 需要设置：
> 1. 安装预览版：`npm i -g @google/gemini-cli@preview`
> 2. 运行 `/settings` 并启用「Skills」
> 3. 运行 `/skills list` 验证安装
>
> [进一步了解 Gemini CLI Skills](https://geminicli.com/docs/cli/skills/)

**Codex CLI：**
```bash
cp -r dist/codex/.codex/* ~/.codex/
```

**Trae：**
```bash
# Trae 中国（国内版）
cp -r dist/trae/.trae-cn/skills/* ~/.trae-cn/skills/

# Trae 国际版
cp -r dist/trae/.trae/skills/* ~/.trae/skills/
```

> **说明：** Trae 有两个版本，配置目录不同：
> - **Trae 中国**：`~/.trae-cn/skills/`
> - **Trae 国际版**：`~/.trae/skills/`
>
> 复制完成后请重启 Trae IDE 以激活 Skills。

**Rovo Dev：**
```bash
# 仅当前项目
cp -r dist/rovo-dev/.rovodev your-project/

# 或全局（作用于所有项目）
cp -r dist/rovo-dev/.rovodev/skills/* ~/.rovodev/skills/
```

## 使用

安装完成后，在你的 AI 工作流中使用指令：

```
/audit           # 发现问题
/normalize       # 修正不一致
/polish          # 最终整理
/distill         # 去掉复杂度
```

多数指令可接受可选参数，用于聚焦某一区域：

```
/audit header
/polish checkout-form
```

**说明：** Codex CLI 使用不同语法：`/prompts:audit`、`/prompts:polish` 等。

## 支持的工具

- [Cursor](https://cursor.com)
- [Claude Code](https://claude.ai/code)
- [OpenCode](https://opencode.ai)
- [Pi](https://pi.dev)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- [Codex CLI](https://github.com/openai/codex)
- [VS Code Copilot](https://code.visualstudio.com)
- [Kiro](https://kiro.dev)
- [Trae](https://trae.ai)
- [Rovo Dev](https://www.atlassian.com/software/rovo)

## 贡献

贡献指南与构建说明见 [DEVELOP.md](DEVELOP.md)。

## 许可

Apache 2.0，详见 [LICENSE](LICENSE)。

frontend-design Skill 基于 [Anthropic 原版](https://github.com/anthropics/skills/tree/main/skills/frontend-design)。署名说明见 [NOTICE.md](NOTICE.md)。

---

由 [Paul Bakaus](https://www.paulbakaus.com) 创建
