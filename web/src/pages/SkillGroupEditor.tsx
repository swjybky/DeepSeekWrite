import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  SKILL_KIND_KEYS,
  type SkillLibraryGroup,
  listSkillLibraryGroups,
} from '../bridge'
import { SkillEditor } from './SkillEditor'

function orderedMemberIds(group: SkillLibraryGroup): string[] {
  const ids: string[] = []
  for (const kind of SKILL_KIND_KEYS) {
    const id = group.members[kind]
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

function firstMemberId(group: SkillLibraryGroup): string | null {
  return orderedMemberIds(group)[0] ?? null
}

export function SkillGroupEditor() {
  const { groupId } = useParams<{ groupId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [group, setGroup] = useState<SkillLibraryGroup | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const groups = await listSkillLibraryGroups()
        const found = groups.find((item) => item.id === groupId) ?? null
        if (!cancelled) {
          setGroup(found)
          if (!found) setError('未找到该技能分组')
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '加载技能分组失败')
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
  const activeSkillId = useMemo(() => {
    if (!group) return null
    if (libFromQuery && memberIds.includes(libFromQuery)) return libFromQuery
    return firstMemberId(group)
  }, [group, libFromQuery, memberIds])

  useEffect(() => {
    if (!group || !activeSkillId) return
    if (libFromQuery === activeSkillId) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('lib', activeSkillId)
        return next
      },
      { replace: true },
    )
  }, [activeSkillId, group, libFromQuery, setSearchParams])

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
        <p className="form-error">{error ?? '未找到该技能分组'}</p>
        <Link to="/">返回首页</Link>
      </div>
    )
  }

  if (!activeSkillId) {
    return (
      <div className="workspace-page">
        <p className="muted">该分组暂无技能库，请先在首页编辑分组成员。</p>
        <Link to="/">返回首页</Link>
      </div>
    )
  }

  return (
    <SkillEditor
      key={`${group.id}:${activeSkillId}`}
      skillId={activeSkillId}
      groupContext={{
        groupId: group.id,
        title: group.title,
        memberIdsOrdered: memberIds,
      }}
      onGroupSkillChange={(skillId) => {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev)
            next.set('lib', skillId)
            return next
          },
          { replace: true },
        )
      }}
    />
  )
}
