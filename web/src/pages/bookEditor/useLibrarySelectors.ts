import { useCallback, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  getMaterial,
  getSkill,
  listMaterials,
  listSkills,
  saveBook,
  type Book,
  type Material,
  type MaterialSummary,
  type Skill,
  type SkillSummary,
} from '../../bridge'
import type { BookWorkspaceSessionState } from '../../stores/workspaceStore'

type UseLibrarySelectorsInput = {
  book: Book | null
  bookRef: MutableRefObject<Book | null>
  workspaceSessionsRef: MutableRefObject<Record<string, BookWorkspaceSessionState>>
  setBook: Dispatch<SetStateAction<Book | null>>
  setLinkedMaterial: Dispatch<SetStateAction<Material | null>>
  setLinkedSkill: Dispatch<SetStateAction<Skill | null>>
  setError: Dispatch<SetStateAction<string | null>>
  storeWorkspaceSession: (
    session: BookWorkspaceSessionState,
    makeActive: boolean,
  ) => void
  syncWorkspaceBookSummary: (book: Book) => void
}

export function useLibrarySelectors({
  book,
  bookRef,
  workspaceSessionsRef,
  setBook,
  setLinkedMaterial,
  setLinkedSkill,
  setError,
  storeWorkspaceSession,
  syncWorkspaceBookSummary,
}: UseLibrarySelectorsInput) {
  const [materialSelectorOpen, setMaterialSelectorOpen] = useState(false)
  const [materialSummaries, setMaterialSummaries] = useState<MaterialSummary[]>([])
  const [materialSelectorLoading, setMaterialSelectorLoading] = useState(false)
  const [materialSelectorSaving, setMaterialSelectorSaving] = useState(false)
  const [skillSelectorOpen, setSkillSelectorOpen] = useState(false)
  const [skillSummaries, setSkillSummaries] = useState<SkillSummary[]>([])
  const [skillSelectorLoading, setSkillSelectorLoading] = useState(false)
  const [skillSelectorSaving, setSkillSelectorSaving] = useState(false)

  const openMaterialSelector = useCallback(async () => {
    setMaterialSelectorOpen(true)
    setMaterialSelectorLoading(true)
    setError(null)
    try {
      setMaterialSummaries(await listMaterials())
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法加载素材库列表')
    } finally {
      setMaterialSelectorLoading(false)
    }
  }, [setError])

  const saveLinkedMaterial = useCallback(async (materialId: string | null) => {
    if (!book) return
    setMaterialSelectorSaving(true)
    setError(null)
    try {
      const next = await saveBook(book.id, { linked_material_id: materialId ?? '' })
      if (!next) {
        setError('关联素材库失败：书籍不存在')
        return
      }
      const material = next.linked_material_id
        ? await getMaterial(next.linked_material_id)
        : null
      const currentSession = workspaceSessionsRef.current[next.id]
      if (currentSession) {
        storeWorkspaceSession(
          {
            ...currentSession,
            book: next,
            linkedMaterial: material,
          },
          bookRef.current?.id === next.id,
        )
      } else {
        setBook(next)
        setLinkedMaterial(material)
      }
      syncWorkspaceBookSummary(next)
      setMaterialSelectorOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '关联素材库失败')
    } finally {
      setMaterialSelectorSaving(false)
    }
  }, [
    book,
    bookRef,
    setBook,
    setError,
    setLinkedMaterial,
    storeWorkspaceSession,
    syncWorkspaceBookSummary,
    workspaceSessionsRef,
  ])

  const openSkillSelector = useCallback(async () => {
    setSkillSelectorOpen(true)
    setSkillSelectorLoading(true)
    setError(null)
    try {
      setSkillSummaries(await listSkills())
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法加载技能库列表')
    } finally {
      setSkillSelectorLoading(false)
    }
  }, [setError])

  const saveLinkedSkill = useCallback(async (skillId: string | null) => {
    if (!book) return
    setSkillSelectorSaving(true)
    setError(null)
    try {
      const next = await saveBook(book.id, { linked_skill_id: skillId ?? '' })
      if (!next) {
        setError('绑定技能库失败：书籍不存在')
        return
      }
      const skill = next.linked_skill_id ? await getSkill(next.linked_skill_id) : null
      const currentSession = workspaceSessionsRef.current[next.id]
      if (currentSession) {
        storeWorkspaceSession(
          {
            ...currentSession,
            book: next,
            linkedSkill: skill,
          },
          bookRef.current?.id === next.id,
        )
      } else {
        setBook(next)
        setLinkedSkill(skill)
      }
      syncWorkspaceBookSummary(next)
      setSkillSelectorOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '绑定技能库失败')
    } finally {
      setSkillSelectorSaving(false)
    }
  }, [
    book,
    bookRef,
    setBook,
    setError,
    setLinkedSkill,
    storeWorkspaceSession,
    syncWorkspaceBookSummary,
    workspaceSessionsRef,
  ])

  return {
    materialSelectorOpen,
    setMaterialSelectorOpen,
    materialSummaries,
    materialSelectorLoading,
    materialSelectorSaving,
    openMaterialSelector,
    saveLinkedMaterial,
    skillSelectorOpen,
    setSkillSelectorOpen,
    skillSummaries,
    skillSelectorLoading,
    skillSelectorSaving,
    openSkillSelector,
    saveLinkedSkill,
  }
}
