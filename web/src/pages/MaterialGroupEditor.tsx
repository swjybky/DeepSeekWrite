import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  MATERIAL_KIND_KEYS,
  type MaterialLibraryGroup,
  listMaterialLibraryGroups,
} from '../bridge'
import { MaterialEditor } from './MaterialEditor'

function orderedMemberIds(group: MaterialLibraryGroup): string[] {
  const ids: string[] = []
  for (const kind of MATERIAL_KIND_KEYS) {
    const id = group.members[kind]
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

function firstMemberId(group: MaterialLibraryGroup): string | null {
  return orderedMemberIds(group)[0] ?? null
}

export function MaterialGroupEditor() {
  const { groupId } = useParams<{ groupId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [group, setGroup] = useState<MaterialLibraryGroup | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const groups = await listMaterialLibraryGroups()
        const found = groups.find((item) => item.id === groupId) ?? null
        if (!cancelled) {
          setGroup(found)
          if (!found) setError('未找到该素材分组')
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '加载素材分组失败')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [groupId])

  const memberIds = useMemo(
    () => (group ? orderedMemberIds(group) : []),
    [group],
  )

  const libFromQuery = searchParams.get('lib')?.trim() || ''
  const activeMaterialId = useMemo(() => {
    if (!group) return null
    if (libFromQuery && memberIds.includes(libFromQuery)) return libFromQuery
    return firstMemberId(group)
  }, [group, libFromQuery, memberIds])

  useEffect(() => {
    if (!group || !activeMaterialId) return
    if (libFromQuery === activeMaterialId) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('lib', activeMaterialId)
        return next
      },
      { replace: true },
    )
  }, [activeMaterialId, group, libFromQuery, setSearchParams])

  if (loading) {
    return (
      <div className="workspace-page">
        <p className="muted">加载分组中…</p>
        <Link to="/">返回首页</Link>
      </div>
    )
  }

  if (error || !group) {
    return (
      <div className="workspace-page">
        <p className="form-error">{error ?? '未找到该素材分组'}</p>
        <Link to="/">返回首页</Link>
      </div>
    )
  }

  if (!activeMaterialId) {
    return (
      <div className="workspace-page">
        <p className="muted">该分组暂无素材库，请先在首页编辑分组成员。</p>
        <Link to="/">返回首页</Link>
      </div>
    )
  }

  return (
    <MaterialEditor
      key={`${group.id}:${activeMaterialId}`}
      materialId={activeMaterialId}
      groupContext={{
        groupId: group.id,
        title: group.title,
        memberIdsOrdered: memberIds,
      }}
      onGroupMaterialChange={(materialId) => {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev)
            next.set('lib', materialId)
            return next
          },
          { replace: true },
        )
      }}
    />
  )
}
