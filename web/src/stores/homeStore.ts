import { create } from 'zustand'
import type {
  AiModelSettings,
  BookSummary,
  MaterialSummary,
  SkillLibraryGroup,
  SkillSummary,
} from '../bridge'

type HomeStoreState = {
  books: BookSummary[]
  materials: MaterialSummary[]
  skills: SkillSummary[]
  skillGroups: SkillLibraryGroup[]
  bookCovers: Record<string, string>
  workspaceRoot: string | null
  aiSettings: AiModelSettings | null
  hasBooks: boolean
  hasMaterials: boolean
  hasSkills: boolean
  hasAiSettings: boolean
  setBooks: (books: BookSummary[]) => void
  setMaterials: (materials: MaterialSummary[]) => void
  setSkillLibraryData: (
    skills: SkillSummary[],
    skillGroups: SkillLibraryGroup[],
  ) => void
  setBookCovers: (bookCovers: Record<string, string>) => void
  setWorkspaceRoot: (workspaceRoot: string | null) => void
  setAiSettings: (aiSettings: AiModelSettings) => void
}

export const useHomeStore = create<HomeStoreState>((set) => ({
  books: [],
  materials: [],
  skills: [],
  skillGroups: [],
  bookCovers: {},
  workspaceRoot: null,
  aiSettings: null,
  hasBooks: false,
  hasMaterials: false,
  hasSkills: false,
  hasAiSettings: false,

  setBooks: (books) => set({ books, hasBooks: true }),
  setMaterials: (materials) => set({ materials, hasMaterials: true }),
  setSkillLibraryData: (skills, skillGroups) =>
    set({ skills, skillGroups, hasSkills: true }),
  setBookCovers: (bookCovers) => set({ bookCovers }),
  setWorkspaceRoot: (workspaceRoot) => set({ workspaceRoot }),
  setAiSettings: (aiSettings) => set({ aiSettings, hasAiSettings: true }),
}))
