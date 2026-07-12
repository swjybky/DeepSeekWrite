import { useState, type ReactNode } from 'react'
import {
  addLongArc,
  addLongChapterCard,
  addLongVolume,
  bumpLongWorkspace,
  commitLongChapter,
  longCharacterGroupId,
  longWorldbuildingCategoryId,
  newLongWorkspaceId,
  normalizeLongWorkspace,
  orderedLongArcs,
  orderedLongChapterCards,
  orderedLongVolumes,
  removeLongArc,
  removeLongChapterCard,
  removeLongVolume,
  type LongCharacter,
  type LongCharacterGroupId,
  type LongForeshadowing,
  type LongLedgerEntry,
  type LongWorkspace,
  type LongWorldbuildingCategory,
} from './longWorkspace'
import './LongWorkspaceEditor.css'

type Props = {
  workspace: LongWorkspace
  activeStage: string
  onChange: (workspace: LongWorkspace) => void
  onCommitChapter?: (stageId: string) => Promise<boolean>
  layoutControls?: ReactNode
}

type CharacterTab = 'core_profile' | 'relationships' | 'current_state' | 'history'
type DraftTab = 'body' | 'character_state' | 'handoff'

const CHARACTER_TABS: Array<{ id: CharacterTab; label: string }> = [
  { id: 'core_profile', label: '核心人设' },
  { id: 'relationships', label: '人物关系' },
  { id: 'current_state', label: '当前状态' },
  { id: 'history', label: '历史状态变化' },
]

const DRAFT_TABS: Array<{ id: DraftTab; label: string }> = [
  { id: 'body', label: '正文' },
  { id: 'character_state', label: '人物状态' },
  { id: 'handoff', label: '交接注意文档' },
]

function textCount(text: string) {
  return text.replace(/\p{White_Space}/gu, '').length
}

function EditorHeading({
  title,
  subtitle,
  text,
  warning,
  actions,
  layoutControls,
}: {
  title: string
  subtitle?: string
  text?: string
  warning?: string
  actions?: ReactNode
  layoutControls?: ReactNode
}) {
  return (
    <header className="long-editor-heading">
      <div className="long-editor-heading-copy">
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className="long-editor-heading-actions">
        {actions}
        {warning ? <span className="long-editor-warning">{warning}</span> : null}
        {text != null ? <span className="workspace-char-count muted">{textCount(text).toLocaleString('zh-CN')} 字</span> : null}
        {layoutControls}
      </div>
    </header>
  )
}

function Field({
  label,
  value,
  onChange,
  rows = 5,
  placeholder,
  disabled = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  rows?: number
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <label className="long-field">
      <span>{label}</span>
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="long-editor-empty">{children}</div>
}

export function LongWorkspaceEditor({
  workspace,
  activeStage,
  onChange,
  onCommitChapter,
  layoutControls,
}: Props) {
  const [selectedWorldItem, setSelectedWorldItem] = useState<Record<string, string>>({})
  const [selectedCharacter, setSelectedCharacter] = useState<Record<string, string>>({})
  const [characterTab, setCharacterTab] = useState<CharacterTab>('core_profile')
  const [selectedVolumeId, setSelectedVolumeId] = useState('')
  const [selectedArcId, setSelectedArcId] = useState('')
  const [selectedCardId, setSelectedCardId] = useState('')
  const [selectedForeshadowId, setSelectedForeshadowId] = useState('')
  const [draftTab, setDraftTab] = useState<DraftTab>('body')
  const [commitFeedback, setCommitFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  const edit = (mutator: (next: LongWorkspace) => void) => {
    const next = normalizeLongWorkspace(workspace)
    mutator(next)
    onChange(bumpLongWorkspace(next))
  }

  const worldCategoryId = longWorldbuildingCategoryId(activeStage)
  if (worldCategoryId) {
    const category = workspace.worldbuilding.categories.find(
      (item) => item.id === worldCategoryId,
    )
    if (!category) {
      return <Empty>该世界观分类已被删除，请在左侧选择其他分类。</Empty>
    }
    const selectedId = selectedWorldItem[category.id]
    const selected = category.items.find((item) => item.id === selectedId) ?? category.items[0]
    const updateCategory = (patch: Partial<LongWorldbuildingCategory>) => {
      edit((next) => {
        const index = next.worldbuilding.categories.findIndex((item) => item.id === category.id)
        if (index >= 0) next.worldbuilding.categories[index] = {
          ...next.worldbuilding.categories[index]!,
          ...patch,
        }
      })
    }
    const addItem = () => {
      const id = newLongWorkspaceId(`${category.id}-item`)
      edit((next) => {
        const target = next.worldbuilding.categories.find((item) => item.id === category.id)
        target?.items.push({ id, name: '新建条目', description: '', detail: '' })
      })
      setSelectedWorldItem((current) => ({ ...current, [category.id]: id }))
    }
    const deleteItem = () => {
      if (!selected || !window.confirm(`删除「${selected.name}」？`)) return
      edit((next) => {
        const target = next.worldbuilding.categories.find((item) => item.id === category.id)
        if (target) target.items = target.items.filter((item) => item.id !== selected.id)
      })
      setSelectedWorldItem((current) => ({ ...current, [category.id]: '' }))
    }
    if (category.format === 'text') {
      const count = textCount(category.text)
      return (
        <div className="long-editor-view">
          <EditorHeading
            title={category.name}
            subtitle="文本格式 · 世界观"
            text={category.text}
            warning={count > 30000 ? '字数过多，请转成列表格式，提高智能体性能。' : undefined}
            layoutControls={layoutControls}
          />
          <textarea
            className="long-full-textarea"
            value={category.text}
            placeholder={`在此编辑全部${category.name}信息…`}
            spellCheck={false}
            onChange={(event) => updateCategory({ text: event.target.value })}
          />
        </div>
      )
    }
    return (
      <div className="long-editor-view">
        <EditorHeading
          title={category.name}
          subtitle="列表格式 · 世界观"
          actions={<button className="long-primary-action" type="button" onClick={addItem}>新增{category.name}条目</button>}
          layoutControls={layoutControls}
        />
        <Field
          label={`所有${category.name}列表概述`}
          value={category.overview}
          rows={3}
          onChange={(overview) => updateCategory({ overview })}
        />
        <div className="long-structured-split">
          <aside className="long-record-list">
            {category.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={selected?.id === item.id ? 'is-active' : ''}
                onClick={() => setSelectedWorldItem((current) => ({ ...current, [category.id]: item.id }))}
              >
                <strong>{item.name || '未命名条目'}</strong>
                <span>{item.description || '暂无描述'}</span>
              </button>
            ))}
          </aside>
          <section className="long-record-detail">
            {selected ? (
              <>
                <div className="long-inline-head">
                  <input
                    value={selected.name}
                    aria-label={`${category.name}名称`}
                    onChange={(event) => edit((next) => {
                      const target = next.worldbuilding.categories.find((item) => item.id === category.id)
                      const row = target?.items.find((item) => item.id === selected.id)
                      if (row) row.name = event.target.value
                    })}
                  />
                  <button type="button" className="long-danger-action" onClick={deleteItem}>删除</button>
                </div>
                <Field label={`${category.name}描述`} value={selected.description} onChange={(description) => edit((next) => {
                  const row = next.worldbuilding.categories.find((item) => item.id === category.id)?.items.find((item) => item.id === selected.id)
                  if (row) row.description = description
                })} />
                <Field label={`${category.name}介绍`} value={selected.detail} rows={10} onChange={(detail) => edit((next) => {
                  const row = next.worldbuilding.categories.find((item) => item.id === category.id)?.items.find((item) => item.id === selected.id)
                  if (row) row.detail = detail
                })} />
              </>
            ) : <Empty>暂无条目，请新增。</Empty>}
          </section>
        </div>
      </div>
    )
  }

  const groupId = longCharacterGroupId(activeStage)
  if (groupId) {
    return renderCharacterEditor({
      workspace,
      groupId,
      selectedCharacter,
      setSelectedCharacter,
      characterTab,
      setCharacterTab,
      edit,
      layoutControls,
    })
  }

  if (activeStage.startsWith('plot_design.')) {
    return renderPlotEditor({
      workspace,
      activeStage,
      edit,
      onChange,
      selectedVolumeId,
      setSelectedVolumeId,
      selectedArcId,
      setSelectedArcId,
      selectedCardId,
      setSelectedCardId,
      selectedForeshadowId,
      setSelectedForeshadowId,
      layoutControls,
    })
  }

  if (activeStage.startsWith('draft.')) {
    const card = workspace.plot.chapter_cards.find((item) => item.stage_id === activeStage)
    const chapter = card ? workspace.chapters[card.stage_id] : undefined
    if (!card || !chapter) return <Empty>未找到对应章卡，请先在“剧情 → 章卡”中创建。</Empty>
    const volume = workspace.plot.volumes.find((item) => item.id === card.volume_id)
    const arc = workspace.plot.arcs.find((item) => item.id === card.arc_id)
    const activeText = chapter[draftTab]
    const updateChapter = (field: DraftTab, value: string) => edit((next) => {
      const target = next.chapters[card.stage_id]
      if (target) target[field] = value
    })
    const land = async () => {
      if (onCommitChapter) {
        const ok = await onCommitChapter(card.stage_id)
        setCommitFeedback({
          ok,
          text: ok
            ? `《${card.title}》已落盘，人物与状态账本已更新。`
            : '本章未能落盘，请根据页面提示检查三个区块和前置章节。',
        })
        return
      }
      const result = commitLongChapter(workspace, card.stage_id)
      if (!result.ok) {
        setCommitFeedback({ ok: false, text: result.error || '落盘失败' })
        return
      }
      onChange(result.workspace)
      setCommitFeedback({ ok: true, text: `《${card.title}》已落盘，状态账本已更新。` })
    }
    return (
      <div className="long-editor-view">
        <EditorHeading
          title={card.title}
          subtitle={`${volume?.name || '未分卷'} / ${arc?.name || '未分剧情弧'} · 正文`}
          text={activeText}
          actions={
            <button
              type="button"
              className={chapter.committed ? 'long-commit-action is-committed' : 'long-commit-action'}
              disabled={chapter.committed}
              onClick={() => void land()}
            >
              {chapter.committed ? '已落盘' : '落盘'}
            </button>
          }
          layoutControls={layoutControls}
        />
        <div className="long-tabs" role="tablist">
          {DRAFT_TABS.map((tab) => (
            <button key={tab.id} type="button" className={draftTab === tab.id ? 'is-active' : ''} onClick={() => setDraftTab(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>
        {commitFeedback ? (
          <p className={commitFeedback.ok ? 'long-feedback is-ok' : 'long-feedback is-error'}>{commitFeedback.text}</p>
        ) : null}
        {chapter.committed ? (
          <p className="long-feedback is-ok">本章已落盘并锁定，人物与状态账本以该版本为准。</p>
        ) : null}
        <textarea
          className="long-full-textarea"
          value={activeText}
          readOnly={chapter.committed}
          title={chapter.committed ? '已落盘章节已锁定，避免账本状态与正文不一致。' : undefined}
          placeholder={draftTab === 'body' ? '在此编写正文…' : draftTab === 'character_state' ? '记录本章结束时的人物状态与关系变化…' : '记录下一章续写必须遵守的交接注意事项…'}
          spellCheck={false}
          onChange={(event) => updateChapter(draftTab, event.target.value)}
        />
      </div>
    )
  }

  if (activeStage.startsWith('continuity_ledger.')) {
    return renderLedger(workspace, activeStage, layoutControls)
  }

  return <Empty>请从左侧选择一个长篇工作台节点。</Empty>
}

function renderCharacterEditor(input: {
  workspace: LongWorkspace
  groupId: LongCharacterGroupId
  selectedCharacter: Record<string, string>
  setSelectedCharacter: React.Dispatch<React.SetStateAction<Record<string, string>>>
  characterTab: CharacterTab
  setCharacterTab: (tab: CharacterTab) => void
  edit: (mutator: (next: LongWorkspace) => void) => void
  layoutControls?: ReactNode
}) {
  const { workspace, groupId, edit } = input
  const groupLabel = ({ protagonists: '主角', major_supporting: '主要配角', minor_supporting: '次要配角', passersby: '路人' } as const)[groupId]
  const entries = workspace.characters[groupId].entries
  const selected = entries.find((item) => item.id === input.selectedCharacter[groupId]) ?? entries[0]
  const add = () => {
    const id = newLongWorkspaceId(`character-${groupId}`)
    edit((next) => next.characters[groupId].entries.push({
      id,
      name: '新建人物',
      core_profile: '',
      relationships: '',
      current_state: '',
      history: '',
    }))
    input.setSelectedCharacter((current) => ({ ...current, [groupId]: id }))
  }
  const remove = () => {
    if (!selected || !window.confirm(`删除人物「${selected.name}」？`)) return
    edit((next) => {
      next.characters[groupId].entries = next.characters[groupId].entries.filter((item) => item.id !== selected.id)
    })
    input.setSelectedCharacter((current) => ({ ...current, [groupId]: '' }))
  }
  const patch = (value: Partial<LongCharacter>) => edit((next) => {
    const row = next.characters[groupId].entries.find((item) => item.id === selected?.id)
    if (row) Object.assign(row, value)
  })
  return (
    <div className="long-editor-view">
      <EditorHeading title={groupLabel} subtitle="人物管理" actions={<button type="button" className="long-primary-action" onClick={add}>新增人物</button>} layoutControls={input.layoutControls} />
      <div className="long-structured-split">
        <aside className="long-record-list">
          {entries.map((item) => (
            <button key={item.id} type="button" className={selected?.id === item.id ? 'is-active' : ''} onClick={() => input.setSelectedCharacter((current) => ({ ...current, [groupId]: item.id }))}>
              <strong>{item.name || '未命名人物'}</strong>
              <span>{item.current_state || '暂无当前状态'}</span>
            </button>
          ))}
        </aside>
        <section className="long-record-detail">
          {selected ? (
            <>
              <div className="long-inline-head">
                <input value={selected.name} aria-label="人物名称" onChange={(event) => patch({ name: event.target.value })} />
                <button type="button" className="long-danger-action" onClick={remove}>删除</button>
              </div>
              <div className="long-tabs" role="tablist">
                {CHARACTER_TABS.map((tab) => <button key={tab.id} type="button" className={input.characterTab === tab.id ? 'is-active' : ''} onClick={() => input.setCharacterTab(tab.id)}>{tab.label}</button>)}
              </div>
              <textarea className="long-detail-textarea" value={selected[input.characterTab]} spellCheck={false} onChange={(event) => patch({ [input.characterTab]: event.target.value })} />
            </>
          ) : <Empty>暂无人物，请新增。</Empty>}
        </section>
      </div>
    </div>
  )
}

function renderPlotEditor(input: {
  workspace: LongWorkspace
  activeStage: string
  edit: (mutator: (next: LongWorkspace) => void) => void
  onChange: (workspace: LongWorkspace) => void
  selectedVolumeId: string
  setSelectedVolumeId: (id: string) => void
  selectedArcId: string
  setSelectedArcId: (id: string) => void
  selectedCardId: string
  setSelectedCardId: (id: string) => void
  selectedForeshadowId: string
  setSelectedForeshadowId: (id: string) => void
  layoutControls?: ReactNode
}) {
  const { workspace, edit } = input
  if (input.activeStage === 'plot_design.book_line') {
    return <div className="long-editor-view"><EditorHeading title="全书线（总纲）" text={workspace.plot.book_line} layoutControls={input.layoutControls} /><textarea className="long-full-textarea" value={workspace.plot.book_line} spellCheck={false} placeholder="在此编写整本书的总纲…" onChange={(event) => edit((next) => { next.plot.book_line = event.target.value })} /></div>
  }
  const volumes = orderedLongVolumes(workspace)
  const volume = volumes.find((item) => item.id === input.selectedVolumeId) ?? volumes[0]
  if (input.activeStage === 'plot_design.volumes') {
    const add = () => { const result = addLongVolume(workspace); input.onChange(result.workspace); input.setSelectedVolumeId(result.volumeId) }
    const remove = () => {
      if (!volume) return
      const committed = workspace.plot.chapter_cards.find(
        (item) => item.volume_id === volume.id && workspace.chapters[item.stage_id]?.committed,
      )
      if (committed) {
        window.alert(`「${volume.name}」包含已落盘章节「${committed.title}」，禁止删除。`)
        return
      }
      if (!window.confirm(`删除「${volume.name}」及其剧情弧、章卡和未落盘正文？`)) return
      input.onChange(removeLongVolume(workspace, volume.id))
      input.setSelectedVolumeId('')
    }
    return <div className="long-editor-view"><EditorHeading title="分卷（卷纲）" actions={<button type="button" className="long-primary-action" onClick={add}>新建卷</button>} layoutControls={input.layoutControls} /><div className="long-structured-split"><aside className="long-record-list">{volumes.map((item) => <button key={item.id} type="button" className={volume?.id === item.id ? 'is-active' : ''} onClick={() => input.setSelectedVolumeId(item.id)}><strong>{item.name}</strong><span>{item.outline || '暂无卷纲'}</span></button>)}</aside><section className="long-record-detail">{volume ? <><div className="long-inline-head"><input value={volume.name} onChange={(event) => edit((next) => { const row = next.plot.volumes.find((item) => item.id === volume.id); if (row) row.name = event.target.value })} /><button type="button" className="long-danger-action" onClick={remove}>删除本卷</button></div><Field label="卷纲" value={volume.outline} rows={14} onChange={(outline) => edit((next) => { const row = next.plot.volumes.find((item) => item.id === volume.id); if (row) row.outline = outline })} /></> : <Empty>暂无分卷。</Empty>}</section></div></div>
  }
  const arcs = volume ? orderedLongArcs(workspace, volume.id) : []
  const arc = arcs.find((item) => item.id === input.selectedArcId) ?? arcs[0]
  if (input.activeStage === 'plot_design.story_arcs') {
    const add = () => { if (!volume) return; const result = addLongArc(workspace, volume.id); input.onChange(result.workspace); input.setSelectedArcId(result.arcId) }
    const remove = () => {
      if (!arc) return
      const committed = workspace.plot.chapter_cards.find(
        (item) => item.arc_id === arc.id && workspace.chapters[item.stage_id]?.committed,
      )
      if (committed) {
        window.alert(`「${arc.name}」包含已落盘章节「${committed.title}」，禁止删除。`)
        return
      }
      if (!window.confirm(`删除「${arc.name}」及其章卡和未落盘正文？`)) return
      input.onChange(removeLongArc(workspace, arc.id))
      input.setSelectedArcId('')
    }
    return <div className="long-editor-view"><EditorHeading title="剧情弧" actions={<button type="button" className="long-primary-action" disabled={!volume} onClick={add}>新建剧情弧</button>} layoutControls={input.layoutControls} /><div className="long-hierarchy-columns"><HierarchyList title="分卷" rows={volumes} selectedId={volume?.id} onSelect={input.setSelectedVolumeId} /><HierarchyList title="卷内剧情弧" rows={arcs} selectedId={arc?.id} onSelect={input.setSelectedArcId} /></div>{arc ? <section className="long-record-detail long-record-detail--below"><div className="long-inline-head"><input value={arc.name} onChange={(event) => edit((next) => { const row = next.plot.arcs.find((item) => item.id === arc.id); if (row) row.name = event.target.value })} /><button type="button" className="long-danger-action" onClick={remove}>删除剧情弧</button></div><Field label="剧情弧时间线安排" value={arc.timeline} rows={12} onChange={(timeline) => edit((next) => { const row = next.plot.arcs.find((item) => item.id === arc.id); if (row) row.timeline = timeline })} /></section> : <Empty>请先选择分卷并新建剧情弧。</Empty>}</div>
  }
  const cards = arc ? orderedLongChapterCards(workspace, arc.id) : []
  const card = cards.find((item) => item.id === input.selectedCardId) ?? cards[0]
  if (input.activeStage === 'plot_design.chapter_cards') {
    const cardCommitted = card
      ? Boolean(workspace.chapters[card.stage_id]?.committed)
      : false
    const add = () => { if (!volume || !arc) return; const result = addLongChapterCard(workspace, volume.id, arc.id); input.onChange(result.workspace); input.setSelectedCardId(result.cardId) }
    const remove = () => {
      if (!card) return
      if (workspace.chapters[card.stage_id]?.committed) {
        window.alert(`章卡「${card.title}」对应章节已经落盘，禁止删除。`)
        return
      }
      if (!window.confirm(`删除章卡「${card.title}」及对应未落盘正文？`)) return
      input.onChange(removeLongChapterCard(workspace, card.id))
      input.setSelectedCardId('')
    }
    return (
      <div className="long-editor-view">
        <EditorHeading
          title="章卡"
          subtitle="正式写文前必须先创建章卡"
          actions={<button type="button" className="long-primary-action" disabled={!arc} onClick={add}>新建章卡</button>}
          layoutControls={input.layoutControls}
        />
        <div className="long-hierarchy-columns long-hierarchy-columns--three">
          <HierarchyList title="分卷" rows={volumes} selectedId={volume?.id} onSelect={input.setSelectedVolumeId} />
          <HierarchyList title="剧情弧" rows={arcs} selectedId={arc?.id} onSelect={input.setSelectedArcId} />
          <HierarchyList title="章卡" rows={cards.map((item) => ({ ...item, name: item.title }))} selectedId={card?.id} onSelect={input.setSelectedCardId} />
        </div>
        {card ? (
          <section className="long-record-detail long-record-detail--below">
            {cardCommitted ? (
              <p className="long-feedback is-ok">对应章节已落盘，章卡设定已锁定。</p>
            ) : null}
            <div className="long-inline-head">
              <input
                value={card.title}
                readOnly={cardCommitted}
                onChange={(event) => edit((next) => {
                  const row = next.plot.chapter_cards.find((item) => item.id === card.id)
                  if (row) row.title = event.target.value
                  const chapter = next.chapters[card.stage_id]
                  if (chapter) chapter.title = event.target.value
                })}
              />
              <button type="button" className="long-danger-action" disabled={cardCommitted} onClick={remove}>删除章卡</button>
            </div>
            <div className="long-field-grid">
              <Field label="章纲" value={card.outline} rows={8} disabled={cardCommitted} onChange={(outline) => patchCard(edit, card.id, { outline })} />
              <Field label="世界观带来的强约束" value={card.world_constraints} rows={8} disabled={cardCommitted} onChange={(world_constraints) => patchCard(edit, card.id, { world_constraints })} />
            </div>
            <Field
              label="出场人物（用顿号、逗号或换行分隔）"
              value={card.characters.join('、')}
              rows={3}
              disabled={cardCommitted}
              onChange={(value) => patchCard(edit, card.id, {
                characters: value.split(/[\n,，、]+/).map((item) => item.trim()).filter(Boolean),
              })}
            />
          </section>
        ) : <Empty>请先选择剧情弧并新建章卡。</Empty>}
      </div>
    )
  }
  const rows = workspace.plot.foreshadowing
  const selected = rows.find((item) => item.id === input.selectedForeshadowId) ?? rows[0]
  const add = () => { const id = newLongWorkspaceId('foreshadowing'); edit((next) => next.plot.foreshadowing.push({ id, name: '新建伏笔', description: '', content: '', status: 'open' })); input.setSelectedForeshadowId(id) }
  const remove = () => { if (!selected || !window.confirm(`删除伏笔「${selected.name}」？`)) return; edit((next) => { next.plot.foreshadowing = next.plot.foreshadowing.filter((item) => item.id !== selected.id) }); input.setSelectedForeshadowId('') }
  const patch = (value: Partial<LongForeshadowing>) => edit((next) => { const row = next.plot.foreshadowing.find((item) => item.id === selected?.id); if (row) Object.assign(row, value) })
  return <div className="long-editor-view"><EditorHeading title="伏笔" actions={<button type="button" className="long-primary-action" onClick={add}>新增伏笔</button>} layoutControls={input.layoutControls} /><div className="long-structured-split"><aside className="long-record-list">{rows.map((item) => <button key={item.id} type="button" className={selected?.id === item.id ? 'is-active' : ''} onClick={() => input.setSelectedForeshadowId(item.id)}><strong>{item.name}</strong><span>{item.description || '暂无概述'}</span></button>)}</aside><section className="long-record-detail">{selected ? <><div className="long-inline-head"><input value={selected.name} onChange={(event) => patch({ name: event.target.value })} /><button type="button" className="long-danger-action" onClick={remove}>删除</button></div><Field label="伏笔描述" value={selected.description} onChange={(description) => patch({ description })} /><Field label="伏笔内容" value={selected.content} rows={10} onChange={(content) => patch({ content })} /><label className="long-field"><span>状态</span><select value={selected.status} onChange={(event) => patch({ status: event.target.value })}><option value="open">未回收</option><option value="progressing">推进中</option><option value="resolved">已回收</option></select></label></> : <Empty>暂无伏笔。</Empty>}</section></div></div>
}

function HierarchyList({ title, rows, selectedId, onSelect }: { title: string; rows: Array<{ id: string; name: string }>; selectedId?: string; onSelect: (id: string) => void }) {
  return <section className="long-hierarchy-list"><h3>{title}</h3><div>{rows.map((row) => <button key={row.id} type="button" className={row.id === selectedId ? 'is-active' : ''} onClick={() => onSelect(row.id)}>{row.name}</button>)}</div></section>
}

function patchCard(edit: (mutator: (next: LongWorkspace) => void) => void, cardId: string, patch: Partial<{ outline: string; world_constraints: string; characters: string[] }>) {
  edit((next) => { const card = next.plot.chapter_cards.find((item) => item.id === cardId); if (card) Object.assign(card, patch) })
}

function LedgerEntries({ rows }: { rows: LongLedgerEntry[] }) {
  if (rows.length === 0) return <Empty>暂无已落盘记录。</Empty>
  return <div className="long-ledger-list">{rows.map((row) => <article key={row.id}><header><strong>{row.chapter_title || row.chapter_stage_id || '未标记章节'}</strong><time>{row.created_at ? row.created_at.replace('T', ' ').replace('Z', '') : ''}</time></header><p>{row.content}</p></article>)}</div>
}

function renderLedger(workspace: LongWorkspace, activeStage: string, layoutControls?: ReactNode) {
  const cards = orderedLongChapterCards(workspace)
  const committed = cards.filter((card) => workspace.chapters[card.stage_id]?.committed)
  const through = cards.find((card) => card.stage_id === workspace.ledger.committed_through)
  let title: string
  let content: ReactNode
  if (activeStage === 'continuity_ledger.timeline') {
    title = '章节时间线'
    content = <LedgerEntries rows={workspace.ledger.timeline} />
  } else if (activeStage === 'continuity_ledger.character_states') {
    title = '人物实时状态'
    const people = Object.values(workspace.characters).flatMap((group) => group.entries)
    content = people.length ? <div className="long-ledger-list">{people.map((person) => <article key={person.id}><header><strong>{person.name}</strong></header><p>{person.current_state || '暂无当前状态'}</p>{person.relationships ? <p><b>人物关系：</b>{person.relationships}</p> : null}{person.history ? <p><b>历史变化：</b>{person.history}</p> : null}</article>)}</div> : <Empty>暂无人物状态。</Empty>
  } else if (activeStage === 'continuity_ledger.faction_states') {
    title = '势力实时变化'; content = <LedgerEntries rows={workspace.ledger.faction_states} />
  } else if (activeStage === 'continuity_ledger.realm_states') {
    title = '境界实时变化'; content = <LedgerEntries rows={workspace.ledger.realm_states} />
  } else if (activeStage === 'continuity_ledger.open_foreshadowing') {
    title = '伏笔状态'; content = <><LedgerEntries rows={workspace.ledger.foreshadowing_states} />{workspace.plot.foreshadowing.length ? <div className="long-ledger-list">{workspace.plot.foreshadowing.map((item) => <article key={item.id}><header><strong>{item.name}</strong><span>{item.status}</span></header><p>{item.description || item.content}</p></article>)}</div> : null}</>
  } else {
    title = '连续性记录'; content = <LedgerEntries rows={workspace.ledger.continuity_notes} />
  }
  return <div className="long-editor-view"><EditorHeading title={title} subtitle={`已落盘 ${committed.length}/${cards.length} 章${through ? ` · 当前写到《${through.title}》` : ''}`} layoutControls={layoutControls} /><div className="long-ledger-progress"><span style={{ width: `${cards.length ? committed.length / cards.length * 100 : 0}%` }} /></div>{content}</div>
}
