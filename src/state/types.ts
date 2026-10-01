import type { InstrumentId } from '../audio/instruments'
import type { ScaleId } from '../lib/theory'

export interface Note {
  id: string
  /** Posición en ticks desde el inicio de la canción (PPQ = 480). */
  tick: number
  /** Duración en ticks. */
  duration: number
  /** Altura MIDI (nota de batería = código GM). */
  pitch: number
  /** 0..1 */
  velocity: number
}

export interface TrackEQ {
  low: number
  mid: number
  high: number
}

export interface Track {
  id: string
  name: string
  instrument: InstrumentId
  color: string
  notes: Note[]
  volume: number
  pan: number
  muted: boolean
  solo: boolean
  eq: TrackEQ
  /** Ajuste fino de octava aplicado al reproducir (semitonos). */
  transpose: number
}

export interface MasterSettings {
  volume: number
  reverb: number
  delay: number
  delayFeedback: number
  compression: number
}

export interface Project {
  id: string
  name: string
  bpm: number
  timeSignature: [number, number]
  keyRoot: number
  keyScale: ScaleId
  /** Número de compases de la rejilla. */
  bars: number
  tracks: Track[]
  master: MasterSettings
  updatedAt: number
}

export interface AnalyzedRecording {
  id: string
  name: string
  createdAt: number
  bpm: number
  notes: {
    tick: number
    duration: number
    pitch: number
    velocity: number
  }[]
  keyRoot: number
  keyScale: ScaleId
  durationSec: number
  waveform: number[]
  f0Track: { time: number; freq: number; rms: number }[]
  warnings: string[]
}

export interface StoredState {
  projects: Project[]
  currentId: string
  recordings: AnalyzedRecording[]
}

export interface Snapshot {
  id: string
  label: string
  createdAt: number
  project: Project
}
