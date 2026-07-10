/**
 * 智能体读取范围的共享类型定义。
 * 短篇与剧本的阶段键不同，但读取范围配置的结构相同，因此使用 string[] 避免类型冲突。
 */
export type WorkspaceAgentReadAccessEntry = {
  workspace: string[]
  material: string[]
  /** 当前智能体允许从已绑定技能库中加载的技能分类。 */
  skill?: string[]
}

export type WorkspaceAgentReadAccessConfig = Record<
  string,
  WorkspaceAgentReadAccessEntry
>
