import { useCallback, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  getMaterial,
  getSkill,
  listMaterials,
  listSkills,
  MATERIAL_KIND_KEYS,
  materialMatchesKind,
  normalizeLinkedMaterialIdsByKind,
  saveBook,
  type Book,
  type Material,
  type MaterialKind,
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
  setLinkedMaterialsByKind: Dispatch<
    SetStateAction<Partial<Record<MaterialKind, Material[]>>>
  >
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
  setLinkedMaterialsByKind,
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

  const resolveLinkedMaterials = useCallback(async (nextBook: Book) => {
    const idsByKind = normalizeLinkedMaterialIdsByKind(
      nextBook.linked_material_ids_by_kind,
      nextBook.linked_material_id,
    )
    const ids = [
      ...new Set(MATERIAL_KIND_KEYS.flatMap((kind) => idsByKind[kind] ?? [])),
    ]
    const materials = (
      await Promise.all(ids.map((materialId) => getMaterial(materialId)))
    ).filter((material): material is Material => Boolean(material))
    const byId = new Map(materials.map((material) => [material.id, material]))
    const linkedMaterialsByKind: Partial<Record<MaterialKind, Material[]>> = {}
    for (const kind of MATERIAL_KIND_KEYS) {
      linkedMaterialsByKind[kind] = (idsByKind[kind] ?? [])
        .map((materialId) => byId.get(materialId) ?? null)
        .filter(
          (material): material is Material =>
            material !== null &&
            material.material_type === nextBook.book_type &&
            materialMatchesKind(material, kind),
        )
    }
    return {
      linkedMaterial: MATERIAL_KIND_KEYS.flatMap(
        (kind) => linkedMaterialsByKind[kind] ?? [],
      )[0] ?? null,
      linkedMaterialsByKind,
    }
  }, [])

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

  const saveLinkedMaterial = useCallback(async (
    linkedMaterialIdsByKind: Partial<Record<MaterialKind, string[]>>,
  ) => {
    if (!book) return
    setMaterialSelectorSaving(true)
    setError(null)
    try {
      const next = await saveBook(book.id, {
        linked_material_ids_by_kind: linkedMaterialIdsByKind,
      })
      if (!next) {
        setError('关联素材库失败：书籍不存在')
        return
      }
      const { linkedMaterial, linkedMaterialsByKind } =
        await resolveLinkedMaterials(next)
      const currentSession = workspaceSessionsRef.current[next.id]
      if (currentSession) {
        storeWorkspaceSession(
          {
            ...currentSession,
            book: next,
            linkedMaterial,
            linkedMaterialsByKind,
          },
          bookRef.current?.id === next.id,
        )
      } else {
        setBook(next)
        setLinkedMaterial(linkedMaterial)
        setLinkedMaterialsByKind(linkedMaterialsByKind)
      }
      syncWorkspaceBookSummary(next)
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
    setLinkedMaterialsByKind,
    resolveLinkedMaterials,
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
