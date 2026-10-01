/**
 * Estado global del estudio (Zustand) + persistencia en localStorage.
 * Incluye un historial de deshacer/rehacer por instantáneas del proyecto.
 */

import { create } from 'zustand'
import type { InstrumentId } from '../audio/instruments'
import { INSTRUMENT_MAP } from '../audio/instruments'
import type { AnalyzedRecording, Note, Project, Snapshot, StoredState, Track } from './types'
import { PPQ, noteName, type Key, type ScaleId } from '../lib/theory'
import { ticksPerBar } from '../lib/durations'

const STORAGE_KEY = 'tabla-musica:state:v1'
const HISTORY_LIMIT = 40

export const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export function emptyTrack(instrument: InstrumentId, name?: string, octaveShift = 0): Track {
  const def = INSTRUMENT_MAP[instrument]
  return {
    id: uid(),
    name: name ?? def.label,
    instrument,
    color: def.color,
    notes: [],
    volume: 0.85,
    pan: 0,
    muted: false,
    solo: false,
    eq: { low: 0, mid: 0, high: 0 },
    transpose: octaveShift,
  }
}

export function newProject(name = 'Canción sin título'): Project {
  const tracks: Track[] = [
    emptyTrack('piano', 'Piano'),
    emptyTrack('bass', 'Bajo'),
    emptyTrack('drums', 'Batería'),
  ]
  return {
    id: uid(),
    name,
    bpm: 100,
    timeSignature: [4, 4],
    keyRoot: 0,
    keyScale: 'major',
    bars: 16,
    tracks,
    master: { volume: 0.85, reverb: 0.2, delay: 0.12, delayFeedback: 0.28, compression: 0.35 },
    updatedAt: Date.now(),
  }
}

function loadStored(): StoredState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredState
    if (!parsed?.projects?.length) return null
    return parsed
  } catch {
    return null
  }
}

interface DataState {
  project: Project
  projects: { id: string; name: string; updatedAt: number; tracks: number }[]
  recordings: AnalyzedRecording[]
  /** Pista seleccionada en el editor. */
  selectedTrackId: string
  /** Nota seleccionada (para editar propiedades). */
  selectedNoteIds: string[]
  /** Herramienta activa en el editor de pistas. */
  tool: 'draw' | 'erase' | 'select'
  /** Valor de duración para dibujar, en ticks. */
  drawDuration: number
  /** Rejilla de cuantización en ticks (0 = sin cuantizar). */
  snapTicks: number
  /** Segundos por compás visible en el editor. */
  zoom: number
  isPlaying: boolean
  playheadTick: number
  loop: { enabled: boolean; startTick: number; endTick: number }
  metronome: boolean
  /** Notas MIDI activas por pista, para la retroalimentación visual. */
  activeNotes: Record<string, number[]>
  toasts: { id: string; message: string; kind: 'info' | 'error' | 'success' }[]
  history: Snapshot[]
  future: Snapshot[]
  sidebarOpen: boolean
  showMixer: boolean
}

interface StoreState extends DataState {
  // Acciones
  setProject: (p: Project, options?: { pushHistory?: boolean; label?: string }) => void
  patchProject: (patch: Partial<Project>, label?: string, pushHistory?: boolean) => void
  addTrack: (instrument: InstrumentId, name?: string) => void
  removeTrack: (id: string) => void
  duplicateTrack: (id: string) => void
  updateTrack: (id: string, patch: Partial<Track>, pushHistory?: boolean) => void
  selectTrack: (id: string) => void
  addNote: (trackId: string, note: Omit<Note, 'id'>) => string
  addNotes: (trackId: string, notes: Omit<Note, 'id'>[]) => void
  updateNote: (trackId: string, noteId: string, patch: Partial<Note>, pushHistory?: boolean) => void
  removeNotes: (trackId: string, noteIds: string[]) => void
  moveNotes: (trackId: string, noteIds: string[], deltaTick: number, deltaPitch: number) => void
  setSelectedNotes: (ids: string[]) => void
  setTool: (tool: 'draw' | 'erase' | 'select') => void
  setDrawDuration: (ticks: number) => void
  setSnap: (ticks: number) => void
  setZoom: (z: number) => void
  setPlaying: (v: boolean) => void
  setPlayhead: (tick: number) => void
  setLoop: (loop: { enabled: boolean; startTick: number; endTick: number }) => void
  setMetronome: (v: boolean) => void
  setActiveNotes: (trackId: string, pitches: number[]) => void
  pushHistory: (label: string) => void
  undo: () => void
  redo: () => void
  toast: (message: string, kind?: 'info' | 'error' | 'success') => void
  dismissToast: (id: string) => void
  setSidebarOpen: (v: boolean) => void
  setShowMixer: (v: boolean) => void
  key: () => Key
  /** Proyectos guardados */
  saveProjectAs: (name: string) => void
  openProject: (id: string) => void
  deleteProject: (id: string) => void
  createProject: (name?: string, template?: TemplateId) => void
  exportProjectJson: () => void
  importProjectJson: (json: string) => void
  /** Grabaciones analizadas */
  addRecording: (r: AnalyzedRecording) => void
  removeRecording: (id: string) => void
}

export type TemplateId = 'blank' | 'piano' | 'rock' | 'lofi' | 'clasica'

/* ------------------------------------------------------------------ */
/* Persistencia                                                        */
/* ------------------------------------------------------------------ */

let saveTimer: number | undefined

/** Guarda el estado en localStorage con un pequeño retardo (debounce). */
function persist(state: StoreState): void {
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      const stored: StoredState = {
        projects: collectProjects(state),
        currentId: state.project.id,
        recordings: state.recordings.slice(0, 20),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    } catch (err) {
      console.warn('No se pudo guardar en localStorage', err)
    }
  }, 400)
}

const projectCache = new Map<string, Project>()

/** Todos los proyectos conocidos (el actual siempre incluido y al día). */
function collectProjects(state: StoreState): Project[] {
  projectCache.set(state.project.id, state.project)
  return [...projectCache.values()]
}

function bootstrap(): DataState {
  const stored = loadStored()
  const projects = stored?.projects ?? []
  projects.forEach((p) => projectCache.set(p.id, p))
  const initial = projects.find((p) => p.id === stored?.currentId) ?? projects[0] ?? newProject()
  return {
    project: initial,
    projects: projects.map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, tracks: p.tracks.length })),
    recordings: stored?.recordings ?? [],
    selectedTrackId: initial.tracks[0]?.id ?? '',
    selectedNoteIds: [],
    tool: 'draw',
    drawDuration: PPQ,
    snapTicks: PPQ / 2,
    zoom: 96,
    isPlaying: false,
    playheadTick: 0,
    loop: { enabled: false, startTick: 0, endTick: ticksPerBar(initial.timeSignature) * 4 },
    metronome: false,
    activeNotes: {},
    toasts: [],
    history: [],
    future: [],
    sidebarOpen: true,
    showMixer: false,
  }
}

/* ------------------------------------------------------------------ */
/* Plantillas                                                          */
/* ------------------------------------------------------------------ */

function template(id: TemplateId): Project {
  const base = newProject()
  switch (id) {
    case 'rock': {
      base.name = 'Rock'
      base.bpm = 128
      base.tracks = [emptyTrack('guitar', 'Guitarra rítmica'), emptyTrack('bass', 'Bajo'), emptyTrack('drums', 'Batería'), emptyTrack('organ', 'Órgano')]
      base.master.reverb = 0.16
      break
    }
    case 'lofi': {
      base.name = 'Lo-fi'
      base.bpm = 78
      base.tracks = [emptyTrack('epiano', 'Piano eléctrico'), emptyTrack('bass', 'Bajo'), emptyTrack('drums', 'Batería'), emptyTrack('pad', 'Pad')]
      base.master.reverb = 0.34
      base.master.delay = 0.2
      break
    }
    case 'clasica': {
      base.name = 'Clásica'
      base.bpm = 92
      base.tracks = [emptyTrack('piano', 'Piano'), emptyTrack('strings', 'Cuerdas'), emptyTrack('flute', 'Flauta')]
      base.master.reverb = 0.3
      break
    }
    case 'piano': {
      base.name = 'Solo piano'
      base.tracks = [emptyTrack('piano', 'Piano')]
      break
    }
    default:
      break
  }
  base.bars = 16
  return base
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export const useStore = create<StoreState>((set, get) => ({
  ...bootstrap(),

  key: () => ({ root: get().project.keyRoot, scale: get().project.keyScale }),

  setProject: (p, options) =>
    set((s) => {
      const history = options?.pushHistory ? pushSnapshot(s.history, s.project, options.label ?? 'cambio') : s.history
      projectCache.set(p.id, p)
      return {
        project: { ...p, updatedAt: Date.now() },
        history,
        future: options?.pushHistory ? [] : s.future,
        selectedTrackId: p.tracks.some((t) => t.id === s.selectedTrackId) ? s.selectedTrackId : (p.tracks[0]?.id ?? ''),
      }
    }),

  patchProject: (patch, label = 'cambio', pushHistory = true) =>
    set((s) => {
      const project = { ...s.project, ...patch, updatedAt: Date.now() }
      projectCache.set(project.id, project)
      persist({ ...s, project })
      return {
        project,
        history: pushHistory ? pushSnapshot(s.history, s.project, label) : s.history,
        future: pushHistory ? [] : s.future,
      }
    }),

  addTrack: (instrument, name) =>
    set((s) => {
      const def = INSTRUMENT_MAP[instrument]
      const count = s.project.tracks.filter((t) => t.instrument === instrument).length
      const track = emptyTrack(instrument, name ?? (count > 0 ? `${def.label} ${count + 1}` : def.label), def.clef === 'bass' ? -12 : 0)
      const project = { ...s.project, tracks: [...s.project.tracks, track], updatedAt: Date.now() }
      projectCache.set(project.id, project)
      persist({ ...s, project })
      return {
        project,
        selectedTrackId: track.id,
        history: pushSnapshot(s.history, s.project, `añadir ${def.label}`),
        future: [],
      }
    }),

  removeTrack: (id) =>
    set((s) => {
      if (s.project.tracks.length <= 1) {
        return { toasts: [...s.toasts, { id: uid(), message: 'Debe quedar al menos una pista', kind: 'error' as const }] }
      }
      const project = { ...s.project, tracks: s.project.tracks.filter((t) => t.id !== id), updatedAt: Date.now() }
      projectCache.set(project.id, project)
      persist({ ...s, project })
      return {
        project,
        selectedTrackId: s.selectedTrackId === id ? (project.tracks[0]?.id ?? '') : s.selectedTrackId,
        history: pushSnapshot(s.history, s.project, 'borrar pista'),
        future: [],
      }
    }),

  duplicateTrack: (id) =>
    set((s) => {
      const src = s.project.tracks.find((t) => t.id === id)
      if (!src) return {}
      const copy: Track = {
        ...src,
        id: uid(),
        name: `${src.name} (copia)`,
        notes: src.notes.map((n) => ({ ...n, id: uid() })),
        solo: false,
      }
      const idx = s.project.tracks.findIndex((t) => t.id === id)
      const tracks = [...s.project.tracks]
      tracks.splice(idx + 1, 0, copy)
      const project = { ...s.project, tracks, updatedAt: Date.now() }
      projectCache.set(project.id, project)
      persist({ ...s, project })
      return { project, selectedTrackId: copy.id, history: pushSnapshot(s.history, s.project, 'duplicar pista'), future: [] }
    }),

  updateTrack: (id, patch, pushHistory = false) =>
    set((s) => {
      const project = {
        ...s.project,
        tracks: s.project.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        updatedAt: Date.now(),
      }
      projectCache.set(project.id, project)
      persist({ ...s, project })
      return {
        project,
        history: pushHistory ? pushSnapshot(s.history, s.project, 'editar pista') : s.history,
      }
    }),

  selectTrack: (id) => set({ selectedTrackId: id, selectedNoteIds: [] }),

  addNote: (trackId, note) => {
    const id = uid()
    set((s) => {
      const project = {
        ...s.project,
        tracks: s.project.tracks.map((t) => (t.id === trackId ? { ...t, notes: [...t.notes, { ...note, id }] } : t)),
        updatedAt: Date.now(),
      }
      projectCache.set(project.id, project)
      persist({ ...s, project })
      return { project, history: pushSnapshot(s.history, s.project, 'añadir nota'), future: [] }
    })
    return id
  },

  addNotes: (trackId, notes) =>
    set((s) => {
      const withIds = notes.map((n) => ({ ...n, id: uid() }))
      const project = {
        ...s.project,
        tracks: s.project.tracks.map((t) => (t.id === trackId ? { ...t, notes: [...t.notes, ...withIds] } : t)),
        updatedAt: Date.now(),
      }
      projectCache.set(project.id, project)
      persist({ ...s, project })
      return { project, history: pushSnapshot(s.history, s.project, 'añadir notas'), future: [] }
    }),

  updateNote: (trackId, noteId, patch, pushHistory = false) =>
    set((s) => {
      const project = {
        ...s.project,
        tracks: s.project.tracks.map((t) =>
          t.id === trackId ? { ...t, notes: t.notes.map((n) => (n.id === noteId ? { ...n, ...patch } : n)) } : t,
        ),
        updatedAt: Date.now(),
      }
      projectCache.set(project.id, project)
      persist({ ...s, project })
      return { project, history: pushHistory ? pushSnapshot(s.history, s.project, 'editar nota') : s.history }
    }),

  removeNotes: (trackId, noteIds) =>
    set((s) => {
      const ids = new Set(noteIds)
      const project = {
        ...s.project,
        tracks: s.project.tracks.map((t) => (t.id === trackId ? { ...t, notes: t.notes.filter((n) => !ids.has(n.id)) } : t)),
        updatedAt: Date.now(),
      }
      projectCache.set(project.id, project)
      persist({ ...s, project })
      return {
        project,
        selectedNoteIds: s.selectedNoteIds.filter((id) => !ids.has(id)),
        history: noteIds.length > 1 ? pushSnapshot(s.history, s.project, 'borrar notas') : s.history,
        future: [],
      }
    }),

  moveNotes: (trackId, noteIds, deltaTick, deltaPitch) =>
    set((s) => {
      const ids = new Set(noteIds)
      const project = {
        ...s.project,
        tracks: s.project.tracks.map((t) =>
          t.id === trackId
            ? {
                ...t,
                notes: t.notes.map((n) =>
                  ids.has(n.id)
                    ? { ...n, tick: Math.max(0, n.tick + deltaTick), pitch: Math.max(12, Math.min(120, n.pitch + deltaPitch)) }
                    : n,
                ),
              }
            : t,
        ),
        updatedAt: Date.now(),
      }
      projectCache.set(project.id, project)
      persist({ ...s, project })
      return { project }
    }),

  setSelectedNotes: (ids) => set({ selectedNoteIds: ids }),
  setTool: (tool) => set({ tool }),
  setDrawDuration: (ticks) => set({ drawDuration: ticks }),
  setSnap: (ticks) => set({ snapTicks: ticks }),
  setZoom: (z) => set({ zoom: Math.max(28, Math.min(240, z)) }),
  setPlaying: (v) => set({ isPlaying: v }),
  setPlayhead: (tick) => set({ playheadTick: tick }),
  setLoop: (loop) => set({ loop }),
  setMetronome: (v) => set({ metronome: v }),
  setActiveNotes: (trackId, pitches) =>
    set((s) => {
      const existing = s.activeNotes[trackId] ?? []
      if (existing.length === pitches.length && existing.every((p, i) => p === pitches[i])) return {}
      return { activeNotes: { ...s.activeNotes, [trackId]: pitches } }
    }),

  pushHistory: (label) => set((s) => ({ history: pushSnapshot(s.history, s.project, label), future: [] })),

  undo: () =>
    set((s) => {
      const prev = s.history[s.history.length - 1]
      if (!prev) return {}
      projectCache.set(prev.project.id, prev.project)
      persist({ ...s, project: prev.project })
      return {
        project: prev.project,
        history: s.history.slice(0, -1),
        future: [...s.future, { id: uid(), label: prev.label, createdAt: Date.now(), project: s.project }].slice(-HISTORY_LIMIT),
        selectedNoteIds: [],
      }
    }),

  redo: () =>
    set((s) => {
      const next = s.future[s.future.length - 1]
      if (!next) return {}
      projectCache.set(next.project.id, next.project)
      persist({ ...s, project: next.project })
      return {
        project: next.project,
        future: s.future.slice(0, -1),
        history: [...s.history, { id: uid(), label: next.label, createdAt: Date.now(), project: s.project }].slice(-HISTORY_LIMIT),
        selectedNoteIds: [],
      }
    }),

  toast: (message, kind = 'info') =>
    set((s) => {
      const id = uid()
      window.setTimeout(() => {
        set((cur) => ({ toasts: cur.toasts.filter((t) => t.id !== id) }))
      }, 4200)
      return { toasts: [...s.toasts, { id, message, kind }] }
    }),

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setShowMixer: (v) => set({ showMixer: v }),

  saveProjectAs: (name) =>
    set((s) => {
      const copy: Project = { ...structuredClone(s.project), id: uid(), name, updatedAt: Date.now() }
      projectCache.set(copy.id, copy)
      persist({ ...s, project: copy })
      return {
        project: copy,
        projects: [...s.projects, { id: copy.id, name: copy.name, updatedAt: copy.updatedAt, tracks: copy.tracks.length }],
        selectedTrackId: copy.tracks[0]?.id ?? '',
        toasts: [...s.toasts, { id: uid(), message: `Guardado como "${name}"`, kind: 'success' as const }],
      }
    }),

  openProject: (id) =>
    set((s) => {
      const target = projectCache.get(id)
      if (!target) {
        return { toasts: [...s.toasts, { id: uid(), message: 'Proyecto no encontrado', kind: 'error' as const }] }
      }
      persist({ ...s, project: target })
      return {
        project: target,
        selectedTrackId: target.tracks[0]?.id ?? '',
        history: [],
        future: [],
      }
    }),

  deleteProject: (id) =>
    set((s) => {
      projectCache.delete(id)
      const projects = s.projects.filter((p) => p.id !== id)
      const remaining = [...projectCache.values()]
      const project = id === s.project.id ? (remaining[0] ?? newProject()) : s.project
      projectCache.set(project.id, project)
      persist({ ...s, project })
      return { projects, project, selectedTrackId: project.tracks[0]?.id ?? '', history: [], future: [] }
    }),

  createProject: (name, templateId = 'blank') =>
    set((s) => {
      const p = template(templateId)
      p.name = name ?? p.name
      projectCache.set(p.id, p)
      persist({ ...s, project: p })
      return {
        project: p,
        projects: [...s.projects, { id: p.id, name: p.name, updatedAt: p.updatedAt, tracks: p.tracks.length }],
        selectedTrackId: p.tracks[0]?.id ?? '',
        history: [],
        future: [],
        selectedNoteIds: [],
      }
    }),

  exportProjectJson: () => {
    const project = get().project
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project.name.replace(/[^\w\-]+/g, '_') || 'proyecto'}.tabla.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  },

  importProjectJson: (json) => {
    try {
      const parsed = JSON.parse(json) as Project
      if (!parsed?.tracks?.length) throw new Error('formato inválido')
      const project: Project = {
        ...newProject(parsed.name ?? 'Proyecto importado'),
        ...parsed,
        id: uid(),
        tracks: parsed.tracks.map((t) => ({ ...t, id: uid(), notes: (t.notes ?? []).map((n) => ({ ...n, id: uid() })) })),
        updatedAt: Date.now(),
      }
      projectCache.set(project.id, project)
      set((s) => {
        persist({ ...s, project })
        return {
          project,
          projects: [...s.projects, { id: project.id, name: project.name, updatedAt: project.updatedAt, tracks: project.tracks.length }],
          selectedTrackId: project.tracks[0]?.id ?? '',
          history: [],
          future: [],
          toasts: [...s.toasts, { id: uid(), message: 'Proyecto importado', kind: 'success' as const }],
        }
      })
    } catch (err) {
      get().toast(`No se pudo importar el archivo: ${(err as Error).message}`, 'error')
    }
  },

  addRecording: (r) => {
    set((s) => {
      const recordings = [r, ...s.recordings].slice(0, 20)
      persist({ ...s, recordings })
      return { recordings }
    })
  },

  removeRecording: (id) =>
    set((s) => {
      const recordings = s.recordings.filter((r) => r.id !== id)
      persist({ ...s, recordings })
      return { recordings }
    }),
}))

function pushSnapshot(history: Snapshot[], project: Project, label: string): Snapshot[] {
  const snapshot: Snapshot = { id: uid(), label, createdAt: Date.now(), project: structuredClone(project) }
  return [...history, snapshot].slice(-HISTORY_LIMIT)
}

/** Etiqueta de nota con nombre y octava, útil en varias vistas. */
export function noteLabel(midi: number): string {
  return `${noteName(midi)}${Math.floor(midi / 12) - 1}`
}

export type { Key, ScaleId }
