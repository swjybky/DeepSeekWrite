import type { AgentMessage } from '@mariozechner/pi-agent-core'
import {
  type AssistantMessage,
  type Model,
  streamSimple,
  type UserMessage,
} from '@mariozechner/pi-ai'

import { resolveWorkspaceProviderApiKey } from './resolveWorkspaceChatModel'
import type { ApplyToStageEditorPayload } from './workspaceStageAgents'

const EXTRACT_SYSTEM = `你是抽取器，不是作者：只做筛选与输出，禁止改写。

结合用户给出的「当前阶段」与「编辑区节选」，从「助手完整回复」里找出与该阶段直接相关，可写入小说编辑区的相关内容片段，参考【提示】，**逐字原样输出**，不得换词、不得合并或拆句、不得润色、不得补写或删减正文内部的字句。

只删除两类内容，其余与阶段相关的正文必须保持与原文完全一致：① 模型的思考、推理、自我说明、解题步骤、对任务的元评论等；② 面向用户的额外说明或操作提示（如「以下是……」「你可以……」等），以及与当前阶段正文无关的引导语。

提示：
1. 导语设计，抽取导语内容；
2. 正文编写，抽取正文内容；
3. 正文审阅，抽取审阅修改后的正文内容；
4. 剧情设计，抽取剧情设计内容；
5. 剧情细化，抽取剧情细化内容；
6. 大纲设计，抽取大纲设计内容+导语（有的话）；
7. 格式转换，抽取格式转换后的导语和正文；


输出格式：
流式输出，保留所有格式与标点；
若没有可原样抽取的相关阶段内容，只输出一行：（无）`

/** 从 Agent 转录中的助手消息取出可向模型传递的纯文本（忽略 toolCall / thinking）。 */
export function assistantAgentMessageToPlainText(m: AgentMessage): string | null {
  if (m.role !== 'assistant') return null
  const am = m as AssistantMessage
  const parts: string[] = []
  for (const c of am.content) {
    if (c.type === 'text' && c.text.trim()) parts.push(c.text.trim())
  }
  return parts.length ? parts.join('\n\n') : null
}

function clipExcerpt(body: string, maxChars: number): string {
  const t = body.trim()
  if (t.length <= maxChars) return t
  return `${t.slice(0, maxChars)}\n\n…（已截断）`
}

export type RunStageAssistantExtractStreamOptions = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pi-ai Model 与 provider 绑定
  flashModel: Model<any>
  stageId: string
  stageBody: string
  assistantPlainText: string
  applyToStageEditor: (payload: ApplyToStageEditorPayload) => void
  signal?: AbortSignal
  onError?: (message: string) => void
  /** 为 true 时不清空编辑区，以 append_token 模式追加到现有内容后；为 false 或未设置时保持默认行为（先清空再写入） */
  appendMode?: boolean
}

/**
 * 用快速模型流式抽取「与当前阶段相关的正文」：
 * - 默认行为（appendMode=false/undefined）：首个流式片段到达时先清空当前阶段编辑区，再以 append_token 写入（整段重写、不追加在旧文后）；若最终未抽到有效正文则恢复原编辑区内容。
 * - 追加模式（appendMode=true）：不清空编辑区，直接将抽取内容以 append_token 模式追加到现有内容后；若未抽到有效正文则不进行任何操作。
 */
export async function runStageAssistantExtractStream(
  opts: RunStageAssistantExtractStreamOptions,
): Promise<void> {
  const {
    flashModel,
    stageId,
    stageBody,
    assistantPlainText,
    applyToStageEditor,
    signal,
    onError,
    appendMode,
  } = opts

  const excerpt = clipExcerpt(stageBody, 10_000)
  const now = Date.now()
  const extractUser: UserMessage = {
    role: 'user',
    timestamp: now,
    content: `当前阶段：${stageId}

编辑区已有内容节选：
${excerpt}

以下为侧栏助手本条回复全文。请只原样拷贝与上述阶段相关、可写入编辑区正文的段落；删去思考过程与用户提示类套话，不要对正文做任何改写：
${assistantPlainText}`,
  }
  console.log('flashModel', flashModel)
  const apiKey = await resolveWorkspaceProviderApiKey(flashModel.provider)
  if (!apiKey) {
    onError?.(
      '缺少当前模型的 API Key。侧栏发一条消息后若已填写密钥仍无法写入，请检查 app/.env 的 model_source 是否与所选厂商一致。',
    )
    return
  }

  let eventStream
  try {
    eventStream = streamSimple(
      flashModel,
      { systemPrompt: EXTRACT_SYSTEM, messages: [extractUser] },
      { signal, apiKey },
    )
  } catch (e) {
    onError?.(e instanceof Error ? e.message : '流式请求失败')
    return
  }

  let accumulated = ''
  let clearedEditorForThisStream = false

  let streamErrored = false
  try {
    for await (const ev of eventStream) {
      if (ev.type === 'text_delta' && ev.delta) {
        const d = ev.delta
        if (!appendMode && !clearedEditorForThisStream) {
          clearedEditorForThisStream = true
          applyToStageEditor({ text: '', mode: 'replace' })
        }
        // 追加模式下，编辑区已有内容时，首个 token 前先添加换行分隔
        if (appendMode && !clearedEditorForThisStream) {
          clearedEditorForThisStream = true
          const hasContent = stageBody.trim().length > 0
          if (hasContent) {
            const sep = stageBody.endsWith('\n') ? '\n' : '\n\n'
            applyToStageEditor({ text: sep, mode: 'append_token' })
          }
        }
        accumulated += d
        applyToStageEditor({ text: d, mode: 'append_token' })
      }
      if (ev.type === 'error') {
        streamErrored = true
        const errText =
          ev.error?.errorMessage?.trim() ||
          (ev.reason === 'aborted' ? '已取消' : '流式生成失败')
        onError?.(errText)
        break
      }
    }
  } catch (e) {
    if (signal?.aborted) return
    onError?.(e instanceof Error ? e.message : '流式输出失败')
    return
  }

  if (streamErrored) return

  // 发送流式结束标记，通知编辑器可以解除只读状态
  applyToStageEditor({ text: '', mode: 'streaming_end' })

  const trimmed = accumulated.trim()
  if (!trimmed || trimmed === '（无）') {
    // 仅在非追加模式且已清空编辑区时恢复原内容
    if (!appendMode && clearedEditorForThisStream) {
      applyToStageEditor({ text: stageBody, mode: 'replace' })
    }
    onError?.('未抽取到可写入正文的内容')
  }
}
