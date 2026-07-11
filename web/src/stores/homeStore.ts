import { create } from 'zustand'
import type {
  AiModelSettings,
  BookSummary,
  MaterialLibraryGroup,
  MaterialSummary,
  SkillLibraryGroup,
  SkillSummary,
} from '../bridge'

type HomeStoreState = {
  books: BookSummary[]
  materials: MaterialSummary[]
  materialGroups: MaterialLibraryGroup[]
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
  setMaterialLibraryData: (
    materials: MaterialSummary[],
    materialGroups: MaterialLibraryGroup[],
  ) => void
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
  materialGroups: [],
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
  setMaterialLibraryData: (materials, materialGroups) =>
    set({ materials, materialGroups, hasMaterials: true }),
  setSkillLibraryData: (skills, skillGroups) =>
    set({ skills, skillGroups, hasSkills: true }),
  setBookCovers: (bookCovers) => set({ bookCovers }),
  setWorkspaceRoot: (workspaceRoot) => set({ workspaceRoot }),
  setAiSettings: (aiSettings) => set({ aiSettings, hasAiSettings: true }),
}))
