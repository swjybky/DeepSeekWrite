import { create } from 'zustand'
import type {
  AiModelSettings,
  BookSummary,
  MaterialSummary,
  SkillSummary,
} from '../bridge'

type HomeStoreState = {
  books: BookSummary[]
  materials: MaterialSummary[]
  skills: SkillSummary[]
  bookCovers: Record<string, string>
  workspaceRoot: string | null
  aiSettings: AiModelSettings | null
  hasBooks: boolean
  hasMaterials: boolean
  hasSkills: boolean
  hasAiSettings: boolean
  setBooks: (books: BookSummary[]) => void
  setMaterials: (materials: MaterialSummary[]) => void
  setSkills: (skills: SkillSummary[]) => void
  setBookCovers: (bookCovers: Record<string, string>) => void
  setWorkspaceRoot: (workspaceRoot: string | null) => void
  setAiSettings: (aiSettings: AiModelSettings) => void
}

export const useHomeStore = create<HomeStoreState>((set) => ({
  books: [],
  materials: [],
  skills: [],
  bookCovers: {},
  workspaceRoot: null,
  aiSettings: null,
  hasBooks: false,
  hasMaterials: false,
  hasSkills: false,
  hasAiSettings: false,

  setBooks: (books) => set({ books, hasBooks: true }),
  setMaterials: (materials) => set({ materials, hasMaterials: true }),
  setSkills: (skills) => set({ skills, hasSkills: true }),
  setBookCovers: (bookCovers) => set({ bookCovers }),
  setWorkspaceRoot: (workspaceRoot) => set({ workspaceRoot }),
  setAiSettings: (aiSettings) => set({ aiSettings, hasAiSettings: true }),
}))
