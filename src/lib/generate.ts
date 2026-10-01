/**
 * Generador musical: progresiones de acordes, acompañamiento, líneas de bajo,
 * grooves de batería, arpegios y melodías. Todo determinista por semilla para
 * que el resultado sea reproducible y editable después.
 */

import type { Note, Track } from '../state/types'
import { PPQ, SCALES, buildChord, diatonicChords, diatonicStack, type Key } from './theory'
import { ticksPerBar } from './durations'

export const uid = (): string => Math.random().toString(36).slice(2, 10)

/* ------------------------------------------------------------------ */
/* Aleatoriedad reproducible                                           */
/* ------------------------------------------------------------------ */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rand = () => number
const pick = <T,>(r: Rand, arr: T[]): T => arr[Math.floor(r() * arr.length) % arr.length]
const chance = (r: Rand, p: number): boolean => r() < p

/* ------------------------------------------------------------------ */
/* Progresiones                                                        */
/* ------------------------------------------------------------------ */

/** Progresiones famosas expresadas como grados (1..7) dentro de la tonalidad. */
export interface Progression {
  id: string
  label: string
  degrees: number[]
  mood: string
}

export const PROGRESSIONS: Progression[] = [
  { id: 'I-V-vi-IV', label: 'I – V – vi – IV', degrees: [1, 5, 6, 4], mood: 'Pop universal' },
  { id: 'vi-IV-I-V', label: 'vi – IV – I – V', degrees: [6, 4, 1, 5], mood: 'Pop melancólico' },
  { id: 'I-IV-V-I', label: 'I – IV – V – I', degrees: [1, 4, 5, 1], mood: 'Clásico / rock and roll' },
  { id: 'ii-V-I', label: 'ii – V – I – I', degrees: [2, 5, 1, 1], mood: 'Jazz' },
  { id: 'I-vi-ii-V', label: 'I – vi – ii – V', degrees: [1, 6, 2, 5], mood: 'Década de 1950' },
  { id: 'i-VI-III-VII', label: 'i – VI – III – VII', degrees: [1, 6, 3, 7], mood: 'Andaluza / épica' },
  { id: 'i-iv-v-i', label: 'i – iv – v – i', degrees: [1, 4, 5, 1], mood: 'Menor clásica' },
  { id: 'I-V-vi-iii-IV-I-IV-V', label: 'Canon de Pachelbel', degrees: [1, 5, 6, 3, 4, 1, 4, 5], mood: 'Canon' },
  { id: 'I-I-IV-IV', label: 'I – I – IV – IV', degrees: [1, 1, 4, 4], mood: 'Himno / balada' },
  { id: 'i-i-VI-VII', label: 'i – i – VI – VII', degrees: [1, 1, 6, 7], mood: 'Rock menor' },
  { id: 'I-iii-IV-iv', label: 'I – iii – IV – iv', degrees: [1, 3, 4, 4], mood: 'Indie' },
  { id: 'i-VII-VI-VII', label: 'i – VII – VI – VII', degrees: [1, 7, 6, 7], mood: 'Épica' },
]

/** Estilo rítmico del acompañamiento armónico. */
export type ChordStyle = 'block' | 'whole' | 'half' | 'arpeggio' | 'pulse' | 'syncopated'

export const CHORD_STYLES: { id: ChordStyle; label: string }[] = [
  { id: 'whole', label: 'Acorde por compás (redonda)' },
  { id: 'half', label: 'Dos acordes por compás (blancas)' },
  { id: 'block', label: 'Acordes en cada negra' },
  { id: 'pulse', label: 'Negras con acento (pulsación)' },
  { id: 'arpeggio', label: 'Arpegio de corcheas' },
  { id: 'syncopated', label: 'Síncopa (anteponiendo)' },
]

export interface GenerateChordsOptions {
  key: Key
  bars: number
  timeSignature: [number, number]
  progression: Progression
  style: ChordStyle
  octave: number
  /** Inversiones para suavizar los enlaces entre acordes. */
  voiceLeading: boolean
  velocity: number
  /** Extensión de los acordes: 0 = tríada, 1 = séptimas, 2 = novenas. */
  extension: 0 | 1 | 2
  seed: number
}

export interface GeneratedPart {
  notes: Omit<Note, 'id'>[]
  description: string
}

/**
 * Enlaza acordes evitando saltos grandes: prueba desplazamientos de octava e
 * inversiones del acorde diatónico y se queda con el que menos se mueve.
 */
function voiceChord(prev: number[] | null, notes: number[]): number[] {
  if (!prev) return notes

  let best: number[] = notes
  let bestCost = Infinity
  for (const shift of [-12, 0, 12]) {
    for (let inv = 0; inv < notes.length; inv++) {
      const candidate = rotateInversion(
        notes.map((n) => n + shift),
        inv,
      )
      const low = Math.min(...candidate)
      const high = Math.max(...candidate)
      if (low < 36 || high > 96) continue
      let cost = 0
      const n = Math.min(prev.length, candidate.length)
      for (let i = 0; i < n; i++) cost += Math.abs(prev[i] - candidate[i])
      cost += Math.abs(candidate.length - prev.length) * 4
      if (cost < bestCost) {
        bestCost = cost
        best = candidate
      }
    }
  }
  return best
}

export function generateChords(options: GenerateChordsOptions): GeneratedPart {
  const { key, bars, timeSignature, progression, style, octave, extension, seed } = options
  const rand = mulberry32(seed)
  const barTicks = ticksPerBar(timeSignature)
  const notes: Omit<Note, 'id'>[] = []
  let prevVoicing: number[] | null = null

  for (let bar = 0; bar < bars; bar++) {
    const degreeIndex = bar % progression.degrees.length
    const degree = progression.degrees[degreeIndex]
    const stackSize = extension === 0 ? 3 : extension === 1 ? 4 : 5
    // Apilado diatónico: las extensiones (séptimas, novenas) salen de la escala,
    // así nunca aparece una nota fuera de la tonalidad.
    const stack = diatonicStack(key, degree - 1, octave, stackSize)
    const voicing: number[] = options.voiceLeading ? voiceChord(prevVoicing, stack) : stack
    prevVoicing = voicing
    const barStart = bar * barTicks

    const emit = (tick: number, duration: number, pitches: number[], vel = options.velocity): void => {
      pitches.forEach((pitch, i) => {
        notes.push({
          tick,
          duration,
          pitch,
          velocity: Math.max(0.25, Math.min(1, vel - i * 0.02 + (rand() - 0.5) * 0.06)),
        })
      })
    }

    switch (style) {
      case 'whole':
        emit(barStart, barTicks * 0.98, voicing)
        break
      case 'half':
        emit(barStart, barTicks * 0.48, voicing)
        emit(barStart + barTicks * 0.5, barTicks * 0.48, voicing, options.velocity * 0.9)
        break
      case 'block': {
        const beats = timeSignature[0]
        const beatTicks = barTicks / beats
        for (let b = 0; b < beats; b++) emit(barStart + b * beatTicks, beatTicks * 0.9, voicing, b === 0 ? options.velocity : options.velocity * 0.8)
        break
      }
      case 'pulse': {
        const beats = timeSignature[0]
        const beatTicks = barTicks / beats
        for (let b = 0; b < beats; b++) {
          const accented = b === 0 || b === Math.floor(beats / 2)
          emit(barStart + b * beatTicks, beatTicks * 0.55, voicing, (accented ? 1 : 0.72) * options.velocity)
        }
        break
      }
      case 'arpeggio': {
        const step = PPQ / 2
        const order = [0, 1, 2, 1]
        let i = 0
        for (let t = 0; t < barTicks; t += step) {
          const idx = order[i % order.length] % voicing.length
          const pitch = voicing[idx] + (i % 8 >= 4 ? 12 : 0)
          notes.push({
            tick: barStart + t,
            duration: step * 0.92,
            pitch,
            velocity: Math.max(0.2, Math.min(1, options.velocity * 0.78 + (rand() - 0.5) * 0.08)),
          })
          i++
        }
        break
      }
      case 'syncopated': {
        const half = barTicks / 2
        emit(barStart, half * 0.7, voicing)
        emit(barStart + half * 0.75, half * 0.5, voicing, options.velocity * 0.85)
        emit(barStart + half, half * 0.7, voicing, options.velocity * 0.95)
        emit(barStart + half * 1.75, half * 0.5, voicing, options.velocity * 0.8)
        break
      }
    }
  }

  return {
    notes,
    description: `${progression.label} · ${CHORD_STYLES.find((s) => s.id === style)?.label ?? style}`,
  }
}

/* ------------------------------------------------------------------ */
/* Bajo                                                                */
/* ------------------------------------------------------------------ */

export type BassStyle = 'roots' | 'eighths' | 'walking' | 'syncopated' | 'octaves'

export const BASS_STYLES: { id: BassStyle; label: string }[] = [
  { id: 'roots', label: 'Solo fundamentales' },
  { id: 'eighths', label: 'Corcheas' },
  { id: 'walking', label: 'Caminante' },
  { id: 'syncopated', label: 'Síncopas' },
  { id: 'octaves', label: 'Octavas' },
]

export interface GenerateBassOptions {
  key: Key
  bars: number
  timeSignature: [number, number]
  progression: Progression
  style: BassStyle
  octave: number
  velocity: number
  seed: number
}

/** Rota un acorde (inversión) subiendo las voces bajas una octava. */
function rotateInversion(chord: number[], inversion: number): number[] {
  const notes = [...chord]
  for (let i = 0; i < inversion; i++) {
    const n = notes.shift()
    if (n !== undefined) notes.push(n + 12)
  }
  return notes
}

const BASS_MIN = 28
const BASS_MAX = 60

export function generateBass(options: GenerateBassOptions): GeneratedPart {
  const { key, bars, timeSignature, progression, style, octave, seed } = options
  const rand = mulberry32(seed)
  const barTicks = ticksPerBar(timeSignature)
  const diatonic = diatonicChords(key, octave)
  const scalePcs = SCALES[key.scale].steps
  const notes: Omit<Note, 'id'>[] = []

  const rootFor = (degree: number): number => {
    const chord = diatonic[(degree - 1) % diatonic.length]
    // Misma convención que los acordes: octava 2 => C2..B2 (Do2–Si2).
    const low = (octave + 1) * 12
    let midi = chord.rootMidi
    while (midi >= low + 12) midi -= 12
    while (midi < low) midi += 12
    return Math.max(BASS_MIN, Math.min(BASS_MAX, midi))
  }

  const fifthOf = (root: number): number => {
    const pc = ((root % 12) + 12) % 12
    const isMajorish = [0, 5, 7].includes(pc) || key.scale === 'major'
    void isMajorish
    return root + 7
  }

  for (let bar = 0; bar < bars; bar++) {
    const degree = progression.degrees[bar % progression.degrees.length]
    const root = rootFor(degree)
    const barStart = bar * barTicks
    const emit = (tick: number, duration: number, pitch: number, vel: number): void => {
      notes.push({ tick: barStart + tick, duration, pitch, velocity: Math.max(0.2, Math.min(1, vel)) })
    }
    const beats = timeSignature[0]
    const beat = barTicks / beats

    switch (style) {
      case 'roots': {
        emit(0, barTicks * 0.9, root, options.velocity)
        if (beats >= 4 && chance(rand, 0.6)) emit(beat * 2, beat * 0.8, root, options.velocity * 0.75)
        break
      }
      case 'eighths': {
        const step = beat / 2
        for (let t = 0; t < barTicks; t += step) {
          const alt = Math.floor(t / step) % 4 === 3 ? Math.min(BASS_MAX, fifthOf(root)) : root
          emit(t, step * 0.85, alt, options.velocity * (t === 0 ? 1 : 0.72))
        }
        break
      }
      case 'walking': {
        for (let b = 0; b < beats; b++) {
          const nextDegree = progression.degrees[(bar + 1) % progression.degrees.length]
          const nextRoot = rootFor(nextDegree)
          let pitch: number
          if (b === 0) pitch = root
          else if (b === beats - 1) {
            // Aproximación cromática al siguiente acorde.
            const dir = nextRoot > root ? 1 : -1
            const approach = nextRoot - dir
            pitch =
              Math.abs(approach - root) <= 6
                ? Math.max(BASS_MIN, Math.min(BASS_MAX, approach))
                : root + (dir > 0 ? 2 : -2)
          } else {
            const interval = pick(rand, [3, 4, 5, 7, 9, 10, 12])
            pitch = root + interval * (chance(rand, 0.5) ? 1 : -1)
          }
          emit(b * beat, beat * 0.9, pitch, options.velocity * (b === 0 ? 1 : 0.8))
        }
        break
      }
      case 'syncopated': {
        const patterns: number[][] = [
          [0, 0.75, 1.5, 2.5, 3.5],
          [0, 0.5, 1.25, 2, 2.75, 3.5],
          [0, 1.5, 2, 3.25],
        ]
        const pattern = pick(rand, patterns)
        for (const b of pattern) {
          if (b * beat >= barTicks) continue
          const pitch = b % 1 !== 0 && chance(rand, 0.4) ? Math.min(BASS_MAX, fifthOf(root)) : root
          emit(b * beat, beat * 0.42, pitch, options.velocity * (b === 0 ? 1 : 0.8))
        }
        break
      }
      case 'octaves': {
        for (let b = 0; b < beats; b++) {
          const pitch = b % 2 === 0 ? root : root + 12
          emit(b * beat, beat * 0.8, pitch, options.velocity * (b === 0 ? 1 : 0.8))
        }
        break
      }
    }
    void scalePcs
  }

  // Asegura que ninguna nota se sale del registro del bajo.
  const clamped = notes.map((n) => ({
    ...n,
    pitch: Math.max(BASS_MIN, Math.min(BASS_MAX, n.pitch)),
  }))
  return { notes: clamped, description: BASS_STYLES.find((s) => s.id === style)?.label ?? style }
}

/* ------------------------------------------------------------------ */
/* Batería                                                            */
/* ------------------------------------------------------------------ */

export type DrumStyle = 'basic' | 'rock' | 'pop' | 'funk' | 'ballad' | 'shuffle' | 'dance' | 'latin'

export const DRUM_STYLES: { id: DrumStyle; label: string; description: string }[] = [
  { id: 'basic', label: 'Básico', description: 'Negras en el charles, bombo y caja alternos' },
  { id: 'rock', label: 'Rock', description: 'Charles en corcheas, bombo 1 y 3, caja 2 y 4' },
  { id: 'pop', label: 'Pop', description: 'Patrón sencillo con charles en corcheas' },
  { id: 'funk', label: 'Funk', description: 'Semicorcheas en el charles con síncopas' },
  { id: 'ballad', label: 'Balada', description: 'Medio tiempo, escobillas' },
  { id: 'shuffle', label: 'Shuffle', description: 'Corcheas con swing (tresillo)' },
  { id: 'dance', label: 'Dance / EDM', description: 'Cuatro en el suelo con charles abierto' },
  { id: 'latin', label: 'Latino', description: 'Patrón de tumbao con claves' },
]

const K = { kick: 36, kickAlt: 35, snare: 38, clap: 39, rim: 37, hat: 42, hatOpen: 46, hatPedal: 44, crash: 49, ride: 51, tomLow: 41, tomMid: 45, tomHigh: 48 }

export interface GenerateDrumsOptions {
  bars: number
  timeSignature: [number, number]
  style: DrumStyle
  seed: number
  /** Nivel de variación/rellenos. */
  variation: number
  /** Añade un crash al inicio de cada sección. */
  crashes: boolean
}

export function generateDrums(options: GenerateDrumsOptions): GeneratedPart {
  const { bars, timeSignature, style, seed, variation } = options
  const rand = mulberry32(seed)
  const barTicks = ticksPerBar(timeSignature)
  const beats = timeSignature[0]
  const step = PPQ / 4 // semicorchea
  const notes: Omit<Note, 'id'>[] = []
  const v = { kick: 0.95, snare: 0.82, hat: 0.55, accent: 1 }

  const hit = (bar: number, offsetTicks: number, pitch: number, vel: number): void => {
    notes.push({
      tick: bar * barTicks + Math.round(offsetTicks),
      duration: PPQ / 4,
      pitch,
      velocity: Math.max(0.15, Math.min(1, vel)),
    })
  }

  for (let bar = 0; bar < bars; bar++) {
    const isFillBar = bars > 1 && (bar + 1) % 8 === 0 && variation > 0
    if (isFillBar) {
      // Relleno de toms en las últimas dos negras.
      const start = barTicks - PPQ * 2
      const toms = [K.tomHigh, K.tomMid, K.tomLow, K.snare]
      for (let i = 0; i < 8; i++) {
        if (chance(rand, 0.85)) hit(bar, start + i * (PPQ / 4), toms[i % toms.length], 0.7 + i * 0.03)
      }
      notes.push({ tick: bar * barTicks, duration: PPQ / 4, pitch: K.crash, velocity: 0.8 })
      continue
    }

    if (options.crashes && bar % 4 === 0) hit(bar, 0, K.crash, 0.85)

    switch (style) {
      case 'basic':
        for (let b = 0; b < beats; b++) hit(bar, b * PPQ, K.hat, v.hat)
        hit(bar, 0, K.kick, v.kick)
        hit(bar, PPQ, K.snare, v.snare)
        break
      case 'rock':
        for (let s = 0; s < beats * 2; s++) hit(bar, s * (PPQ / 2), K.hat, s % 2 === 0 ? v.hat * 1.1 : v.hat * 0.85)
        hit(bar, 0, K.kick, v.kick)
        hit(bar, PPQ, K.snare, v.snare)
        hit(bar, PPQ * 2, K.kick, v.kick * 0.9)
        if (chance(rand, 0.5)) hit(bar, PPQ * 2 + PPQ / 2, K.kick, v.kick * 0.7)
        hit(bar, PPQ * 3, K.snare, v.snare)
        break
      case 'pop':
        for (let s = 0; s < beats * 2; s++) hit(bar, s * (PPQ / 2), K.hat, s % 2 === 0 ? v.hat : v.hat * 0.8)
        hit(bar, 0, K.kick, v.kick)
        hit(bar, PPQ, K.clap, v.snare * 0.9)
        hit(bar, PPQ * 2, K.kick, v.kick * 0.85)
        hit(bar, PPQ * 3, K.snare, v.snare)
        break
      case 'funk': {
        const hats = ['x', '.', 'x', 'x', '.', 'x', 'x', '.', 'x', '.', 'x', 'x', '.', 'x', '.', 'x']
        hats.forEach((h, i) => {
          if (h === 'x') hit(bar, i * step, K.hat, i % 4 === 0 ? v.hat * 1.15 : v.hat * 0.75)
        })
        hit(bar, 0, K.kick, v.kick)
        hit(bar, PPQ * 1.5, K.kick, v.kick * 0.7)
        hit(bar, PPQ * 2.75, K.kick, v.kick * 0.75)
        hit(bar, PPQ, K.snare, v.snare)
        hit(bar, PPQ * 3, K.snare, v.snare)
        if (chance(rand, 0.6)) hit(bar, PPQ * 3.75, K.snare, 0.4)
        break
      }
      case 'ballad':
        hit(bar, 0, K.kick, v.kick * 0.8)
        hit(bar, PPQ * 2, K.kick, v.kick * 0.7)
        hit(bar, PPQ, K.rim, v.snare * 0.8)
        hit(bar, PPQ * 3, K.snare, v.snare * 0.85)
        for (let s = 0; s < beats * 2; s++) hit(bar, s * (PPQ / 2), K.hat, s % 2 === 0 ? v.hat * 0.8 : v.hat * 0.55)
        break
      case 'shuffle': {
        // Tresillo: negra + corchea con swing.
        for (let b = 0; b < beats; b++) {
          hit(bar, b * PPQ, K.hat, v.hat * 1.1)
          hit(bar, b * PPQ + PPQ * (2 / 3), K.hat, v.hat * 0.7)
        }
        hit(bar, 0, K.kick, v.kick)
        hit(bar, PPQ * 2, K.kick, v.kick * 0.85)
        hit(bar, PPQ, K.snare, v.snare * 0.9)
        hit(bar, PPQ * 3, K.snare, v.snare * 0.9)
        break
      }
      case 'dance':
        for (let b = 0; b < beats; b++) {
          hit(bar, b * PPQ, K.kick, v.kick)
          hit(bar, b * PPQ + PPQ / 2, K.hatOpen, v.hat * 0.6)
        }
        hit(bar, PPQ * 2, K.clap, v.snare)
        break
      case 'latin': {
        const clave = [0, 1.5, 3] // tresillo de 3-2 simplificado
        clave.forEach((b) => hit(bar, b * PPQ, K.rim, v.snare * 0.7))
        hit(bar, 0, K.kick, v.kick * 0.85)
        hit(bar, PPQ * 2.5, K.kick, v.kick * 0.7)
        for (let s = 0; s < beats * 2; s++) hit(bar, s * (PPQ / 2), K.hatPedal, v.hat * 0.5)
        break
      }
    }

    // Variaciones aleatorias repartidas por el patrón.
    if (variation > 0 && chance(rand, variation * 0.55)) {
      const offset = Math.floor(rand() * beats) * PPQ
      hit(bar, offset + PPQ / 2, K.snare, v.snare * 0.35)
    }
    if (variation > 0 && chance(rand, variation * 0.4)) {
      hit(bar, PPQ * (Math.floor(rand() * beats) + 0.5), K.kick, v.kick * 0.6)
    }
  }

  return { notes, description: DRUM_STYLES.find((s) => s.id === style)?.description ?? style }
}

/* ------------------------------------------------------------------ */
/* Arpegios y melodías                                                 */
/* ------------------------------------------------------------------ */

export interface MelodyOptions {
  key: Key
  bars: number
  timeSignature: [number, number]
  progression: Progression
  octave: number
  seed: number
  density: number // 0..1
  /** Salto máximo entre notas consecutivas, en grados de la escala. */
  leapiness: number
  style: 'cantable' | 'balada' | 'dance' | 'clasica' | 'ambient'
}

export function generateMelody(options: MelodyOptions): GeneratedPart {
  const { key, bars, timeSignature, progression, octave, seed, density, leapiness, style } = options
  const rand = mulberry32(seed)
  const barTicks = ticksPerBar(timeSignature)
  const scale = SCALES[key.scale].steps
  const notes: Omit<Note, 'id'>[] = []

  const scaleNote = (degreeIndex: number): number => {
    const oct = Math.floor(degreeIndex / scale.length)
    const idx = ((degreeIndex % scale.length) + scale.length) % scale.length
    return (octave + 1) * 12 + key.root + scale[idx] + oct * 12
  }

  const beatUnit = style === 'dance' ? PPQ / 2 : style === 'ambient' ? PPQ : PPQ / 2
  let degree = Math.floor(scale.length / 2)
  const centerDegree = Math.floor(scale.length * 0.6)

  for (let bar = 0; bar < bars; bar++) {
    const chordDegree = progression.degrees[bar % progression.degrees.length]
    const chordRootPc = (key.root + scale[(chordDegree - 1) % scale.length]) % 12
    const barStart = bar * barTicks
    const steps = Math.round(barTicks / beatUnit)

    for (let s = 0; s < steps; s++) {
      const onBeat = (s * beatUnit) % PPQ === 0
      const prob = onBeat ? 0.85 * density + 0.1 : 0.45 * density
      if (!chance(rand, prob)) continue

      // Movimiento por grados, con atracción hacia las notas del acorde.
      const stepChoices = [-3, -2, -1, 1, 2, 3].map((d) => d * (1 + Math.floor(rand() * leapiness)))
      let move = pick(rand, stepChoices)
      if (chance(rand, 0.25)) move = pick(rand, [-4, -3, 2, 3, 4]) * (1 + leapiness)

      let next = degree + move
      // Evita alejarse demasiado del centro.
      if (next > centerDegree + 4) next -= 3
      if (next < centerDegree - 4) next += 3
      next = Math.max(0, Math.min(scale.length * 2 - 1, next))
      degree = next

      let pitch = scaleNote(degree)
      // En los tiempos fuertes, se prioriza una nota del acorde.
      if (onBeat && chance(rand, 0.55)) {
        for (let tries = 0; tries < 5; tries++) {
          const candidate = scaleNote(degree + pick(rand, [-2, -1, 0, 1, 2]))
          if (((candidate % 12) + 12) % 12 === chordRootPc || Math.abs(candidate - pitch) <= 5) {
            pitch = candidate
            break
          }
        }
      }

      const duration = beatUnit * (chance(rand, style === 'balada' ? 0.55 : 0.35) ? 2 : 1)
      notes.push({
        tick: barStart + s * beatUnit,
        duration: Math.min(barTicks - s * beatUnit, duration * 0.95),
        pitch,
        velocity: Math.max(0.3, Math.min(1, (onBeat ? 0.85 : 0.68) + (rand() - 0.5) * 0.12)),
      })
    }
  }

  return { notes, description: `Melodía ${style}` }
}

/** Arpegio sobre un acorde concreto (para el botón "arpegiar"). */
export function arpeggiateChord(rootMidi: number, quality: string, octaveRange = 2, steps = 8): number[] {
  const chord = buildChord(rootMidi, quality)
  const out: number[] = []
  for (let i = 0; i < steps; i++) {
    const idx = i % chord.length
    out.push(chord[idx] + Math.floor(i / chord.length) * 12 * (octaveRange > 1 ? 1 : 0))
  }
  return out
}

/** Interpreta el grado y la calidad de un acorde en una tonalidad. */
export function chordLabelFor(key: Key, degree: number, octave = 4): string {
  const diatonic = diatonicChords(key, octave)
  return diatonic[(degree - 1) % diatonic.length]?.label ?? ''
}

/** Pistas auxiliares: rellena una pista con las notas generadas. */
export function applyToTrack(track: Track, notes: Omit<Note, 'id'>[]): Track {
  return { ...track, notes: notes.map((n) => ({ ...n, id: uid() })) }
}
