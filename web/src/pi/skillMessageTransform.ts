/**
 * 技能加载消息转换模块。
 *
 * 修改 load_skill 工具返回内容在消息列表中的角色：
 * - 原机制：技能内容作为 toolResult 传给大模型
 * - 新机制：技能内容作为 user 消息传给大模型
 *
 * 批量工具调用时，先放全部 toolResult（load_skill 用简短占位），
 * 然后在该批次结束后插入技能内容的 user 消息。
 */
import type {
  Message,
  ImageContent,
  TextContent,
  ToolResultMessage,
  UserMessage,
} from '@earendil-works/pi-ai'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  convertAttachments,
  isArtifactMessage,
  isUserMessageWithAttachments,
} from '@earendil-works/pi-web-ui'

const LOAD_SKILL_TOOL_NAME = 'load_skill'
const ATTACHMENT_ONLY_FALLBACK_PROMPT =
  '请阅读我上传的附件，并根据附件内容回复。'

function flushPendingSkillUserMessages(
  result: Message[],
  pendingSkillUserMessages: UserMessage[],
) {
  if (pendingSkillUserMessages.length === 0) return
  result.push(...pendingSkillUserMessages)
  pendingSkillUserMessages.length = 0
}

/**
 * 自定义 convertToLlm：将 load_skill 工具返回的技能内容从 toolResult
 * 角色转为 user 角色传给大模型。
 *
 * 流程：
 * 1. 遇到 load_skill 的 toolResult 时，生成一条简短 toolResult（满足 API 协议）
 * 2. 将技能正文收集为 user 消息，延迟到同一批次 toolResult 全部输出后再插入
 * 3. 批量工具调用时顺序：所有 toolResult → 技能 user 消息 → 下一条 assistant
 */
export function convertToLlmWithSkillAsUser(messages: AgentMessage[]): Message[] {
  const result: Message[] = []
  const pendingSkillUserMessages: UserMessage[] = []

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object' || !('role' in msg)) continue
    if (isArtifactMessage(msg)) continue
    if (isUserMessageWithAttachments(msg)) {
      flushPendingSkillUserMessages(result, pendingSkillUserMessages)
      const content: (TextContent | ImageContent)[] =
        typeof msg.content === 'string'
          ? [
              {
                type: 'text',
                text:
                  msg.content.trim() ||
                  (msg.attachments?.length
                    ? ATTACHMENT_ONLY_FALLBACK_PROMPT
                    : ''),
              },
            ]
          : [...msg.content]

      if (msg.attachments?.length) {
        content.push(...convertAttachments(msg.attachments))
      }

      result.push({
        role: 'user',
        content,
        timestamp: msg.timestamp,
      })
      continue
    }

    const m = msg as Message

    if (m.role === 'toolResult') {
      const toolMsg = m as ToolResultMessage
      if (toolMsg.toolName === LOAD_SKILL_TOOL_NAME && !toolMsg.isError) {
        const skillText = toolMsg.content
          .filter((c): c is TextContent => c.type === 'text')
          .map((c) => c.text)
          .join('\n')
          .trim()

        result.push({
          role: 'toolResult',
          toolCallId: toolMsg.toolCallId,
          toolName: toolMsg.toolName,
          content: [{ type: 'text', text: '技能内容已加载，详见下方。' }],
          isError: false,
          timestamp: toolMsg.timestamp,
        })

        if (skillText) {
          pendingSkillUserMessages.push({
            role: 'user',
            content: [{ type: 'text', text: `【已加载技能内容】\n\n${skillText}` }],
            timestamp: toolMsg.timestamp,
          })
        }
      } else {
        result.push(m)
      }
    } else if (m.role === 'user' || m.role === 'assistant') {
      flushPendingSkillUserMessages(result, pendingSkillUserMessages)
      result.push(m)
    }
  }

  flushPendingSkillUserMessages(result, pendingSkillUserMessages)

  return result
}
