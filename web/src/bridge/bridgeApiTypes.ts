import type {
  Book,
  BookStatus,
  BookSummary,
  ExpertDraft,
} from '../domain/workspaceCore'
import type {
  AiModelDefaults,
  AiModelSettings,
  AppearanceStyle,
} from './aiModelConfig'
import type {
  CommonSkill,
  LoadCommonSkillsResult,
  Material,
  MaterialSummary,
  Skill,
  SkillSummary,
} from './libraryDomain'

declare global {
  interface Window {
    /** API 在 pywebviewready 之后才可用 */
    pywebview?: {
      api?: {
        list_books(): Promise<BookSummary[]>
        pick_folder(): Promise<string | null>
        create_book(
          title: string,
          book_type: string,
          categories: string[],
          workspace_root?: string | null,
          linked_skill_id?: string | null,
          linked_material_id?: string | null,
        ): Promise<Book>
        get_book(book_id: string): Promise<Book | null>
        save_book(
          book_id: string,
          content?: string | null,
          stages?: Record<string, string> | null,
          linked_material_id?: string | null,
          expert_draft?: ExpertDraft | null,
          title?: string | null,
          status?: BookStatus | null,
          linked_skill_id?: string | null,
        ): Promise<Book | null>
        delete_book(book_id: string): Promise<boolean>
        list_ai_chat_sessions(
          scope: Record<string, string>,
        ): Promise<Record<string, unknown>[]>
        get_ai_chat_session(
          session_id: string,
        ): Promise<Record<string, unknown> | null>
        save_ai_chat_session(
          session: Record<string, unknown>,
        ): Promise<Record<string, unknown> | null>
        delete_ai_chat_session(session_id: string): Promise<boolean>
        delete_ai_chat_sessions_for_owner(
          owner_type: string,
          owner_id: string,
        ): Promise<number>
        /** 上次选定的工作文件夹（持久化在用户数据 .data/preferences.json） */
        get_workspace_root(): Promise<string | null>
        set_workspace_root(path: string | null): Promise<void>
        /** 全软件外观风格（持久化在用户数据 .data/preferences.json） */
        get_appearance_style(): Promise<AppearanceStyle | string>
        set_appearance_style(style: AppearanceStyle): Promise<AppearanceStyle | string>
        /** 创作空间、素材库、技能库的文字显示方式 */
        get_text_display_mode(): Promise<string>
        set_text_display_mode(mode: string): Promise<string>
        /** 检查远程版本配置并返回当前平台的可用更新。 */
        check_for_update(): Promise<{
          success: boolean
          error: string | null
          current_version: string
          latest_version: string | null
          update_available: boolean
          platform_key: string | null
          file_name: string | null
          release_notes: string[]
        }>
        /** 下载最新安装包到当前用户的 Downloads 目录。 */
        download_latest_update(): Promise<{
          success: boolean
          error: string | null
          up_to_date: boolean
          current_version: string
          latest_version: string | null
          path: string | null
          browser_opened: boolean
          file_name: string | null
          release_notes: string[]
        }>
        /** 全局创作空间智能体可读配置 */
        get_workspace_agent_read_access(): Promise<Record<string, unknown>>
        get_workspace_agent_read_access(
          workspace_type: string,
        ): Promise<Record<string, unknown>>
        set_workspace_agent_read_access(
          config: Record<string, unknown>,
        ): Promise<void>
        set_workspace_agent_read_access(
          config: Record<string, unknown>,
          workspace_type: string,
        ): Promise<void>
        sync_workspace_agent_read_access_defaults(
          workspace_type?: string,
        ): Promise<Record<string, unknown>>
        get_default_workspace_agent_read_access(
          workspace_type?: string,
        ): Promise<Record<string, unknown>>
        /** 本地配置中的默认文字模型与 Key；未配置完整时返回 null */
        get_ai_defaults(): Promise<AiModelDefaults | null>
        /** 本地模型配置，首次为空时由 Python 从旧 .env 导入。 */
        get_ai_model_config(): Promise<AiModelSettings>
        save_ai_model_config(config: AiModelSettings): Promise<AiModelSettings>

        /** 渲染工作台系统提示词（磁盘默认 + 用户数据 `.data/prompt_overrides`，占位符服务端替换）。 */
        get_workspace_system_prompt(
          stage_id: string,
          context_json: string,
          workspace_type?: string | null,
        ): Promise<string>
        /** 读取当前生效的共享创作空间智能体模板原文。 */
        read_workspace_agent_prompt_template(
          agent_id: string,
          workspace_type?: string | null,
        ): Promise<string>
        save_workspace_agent_prompt_override(
          agent_id: string,
          body: string,
          workspace_type?: string | null,
        ): Promise<void>
        reset_workspace_agent_prompt_override(
          agent_id: string,
          workspace_type?: string | null,
        ): Promise<boolean>

        // ==================== 素材库 API ====================
        list_materials(): Promise<MaterialSummary[]>
        get_material(material_id: string): Promise<Material | null>
        create_material(
          title: string,
          material_type: string,
          parent_genre?: string | null,
          sub_genre?: string | null,
          workspace_root?: string | null,
        ): Promise<Material>
        save_material(
          material_id: string,
          stages?: Record<string, string> | null,
          title?: string | null,
        ): Promise<Material | null>
        delete_material(material_id: string): Promise<boolean>
        get_material_genres(): Promise<Record<string, string[]>>

        // ==================== 技能库 API ====================
        list_skills(): Promise<SkillSummary[]>
        get_skill(skill_id: string): Promise<Skill | null>
        create_skill(
          title: string,
          skill_type?: string | null,
          workspace_root?: string | null,
          load_common_skills?: boolean,
        ): Promise<Skill>
        save_skill(
          skill_id: string,
          payload?: Record<string, unknown> | null,
        ): Promise<Skill | null>
        delete_skill(skill_id: string): Promise<boolean>
        read_common_skills(): Promise<CommonSkill[]>
        save_common_skills(skills: CommonSkill[]): Promise<CommonSkill[]>
        load_common_skills_to_skill(
          skill_id: string,
        ): Promise<LoadCommonSkillsResult | null>

        // ==================== 素材库提示词 API ====================
        get_material_system_prompt(
          material_kind: string,
          stage_id: string,
          context_json: string,
          material_type?: string | null,
        ): Promise<string>
        read_material_prompt_template(
          material_kind: string,
          stage_id: string,
        ): Promise<string>
        save_material_prompt_override(
          material_kind: string,
          stage_id: string,
          body: string,
        ): Promise<void>
        reset_material_prompt_override(
          material_kind: string,
          stage_id: string,
        ): Promise<boolean>
        read_material_agent_prompt_template(material_type?: string | null): Promise<string>
        save_material_agent_prompt_override(
          body: string,
          material_type?: string | null,
        ): Promise<void>
        reset_material_agent_prompt_override(material_type?: string | null): Promise<boolean>

        // ==================== 技能库提示词 API ====================
        get_skill_system_prompt(
          stage_id: string,
          context_json: string,
          skill_type?: string | null,
        ): Promise<string>
        read_skill_agent_prompt_template(skill_type?: string | null): Promise<string>
        save_skill_agent_prompt_override(
          body: string,
          skill_type?: string | null,
        ): Promise<void>
        reset_skill_agent_prompt_override(skill_type?: string | null): Promise<boolean>

        // ==================== 学习仿写提示词 API ====================
        get_learning_imitation_system_prompt(
          stage_id: string,
          context_json: string,
        ): Promise<string>
        read_learning_imitation_prompt_template(stage_id: string): Promise<string>
        save_learning_imitation_prompt_override(
          stage_id: string,
          body: string,
        ): Promise<void>
        reset_learning_imitation_prompt_override(stage_id: string): Promise<boolean>

        // ==================== 封面 API ====================
        get_book_cover(book_id: string): Promise<{ cover_data: string | null }>
        get_book_covers?(
          book_ids: string[],
        ): Promise<{ covers: Record<string, string | null> }>
        generate_book_cover(
          book_id: string,
          prompt: string,
        ): Promise<{ cover_path: string | null; success: boolean; error: string | null }>

        // ==================== 素材/技能导入导出 API ====================
        export_library(
          library_type: string,
          item_id: string,
        ): Promise<{ success: boolean; error: string | null; path: string | null }>
        import_library(
          library_type: string,
          workspace_root: string | null,
        ): Promise<{ success: boolean; error: string | null; item: Record<string, unknown> | null }>

        // ==================== 导出 API ====================
        export_docx(
          book_id: string,
          stage_id: string,
          folder_path: string,
          content: string,
          cover_data: string | null,
        ): Promise<{ success: boolean; error: string | null; path: string | null }>
      }
    }
  }
}

export {}
