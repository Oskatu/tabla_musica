/**
 * Teoría musical básica: notas, escalas, acordes y utilidades de conversión.
 * Todas las posiciones de tiempo del proyecto se miden en "ticks" (PPQ por negra).
 */

export const PPQ = 480

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

const SOLFEGE: Record<string, string> = {
  C: 'Do',
  'C#': 'Do#',
  Db: 'Reb',
  D: 'Re',
  'D#': 'Re#',
  Eb: 'Mib',
  E: 'Mi',
  F: 'Fa',
  'F#': 'Fa#',
  Gb: 'Solb',
  G: 'Sol',
  'G#': 'Sol#',
  Ab: 'Lab',
  A: 'La',
  'A#': 'La#',
  Bb: 'Sib',
  B: 'Si',
}

export function noteName(midi: number): string {
  const n = ((midi % 12) + 12) % 12
  return NOTE_NAMES[n]
}

export function octave(midi: number): number {
  return Math.floor(midi / 12) - 1
}

/** "C4", "F#3"... */
export function midiToLabel(midi: number): string {
  return `${noteName(midi)}${octave(midi)}`
}

export function midiToSolfege(midi: number): string {
  return `${SOLFEGE[noteName(midi)] ?? noteName(midi)}${octave(midi)}`
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440)
}

export function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12)
}

/** Nota escrita en notación anglosajona usada por la partitura. */
export function pitchClass(name: string): number {
  return NOTE_NAMES.indexOf(name as (typeof NOTE_NAMES)[number])
}

export type ScaleId =
  | 'major'
  | 'minor'
  | 'harmonicMinor'
  | 'dorian'
  | 'mixolydian'
  | 'majorPentatonic'
  | 'minorPentatonic'
  | 'blues'

export const SCALES: Record<ScaleId, { label: string; steps: number[] }> = {
  major: { label: 'Mayor', steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: 'Menor natural', steps: [0, 2, 3, 5, 7, 8, 10] },
  harmonicMinor: { label: 'Menor armónica', steps: [0, 2, 3, 5, 7, 8, 11] },
  dorian: { label: 'Dórico', steps: [0, 2, 3, 5, 7, 9, 10] },
  mixolydian: { label: 'Mixolidio', steps: [0, 2, 4, 5, 7, 9, 10] },
  majorPentatonic: { label: 'Pentatónica mayor', steps: [0, 2, 4, 7, 9] },
  minorPentatonic: { label: 'Pentatónica menor', steps: [0, 3, 5, 7, 10] },
  blues: { label: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
}

export interface Key {
  root: number // 0..11 (clase de altura)
  scale: ScaleId
}

export const MAJOR_KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export function keyNotes(key: Key): number[] {
  return SCALES[key.scale].steps.map((s) => (key.root + s) % 12)
}

export function inKey(midi: number, key: Key): boolean {
  return keyNotes(key).includes(((midi % 12) + 12) % 12)
}

/** Nombres enarmónicos "bonitos" según la armadura (bemoles para tonalidades de bemoles). */
const FLAT_KEYS = new Set([1, 3, 5, 8, 10])
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

export function spellPitch(midi: number, keyRoot?: number): string {
  const pc = ((midi % 12) + 12) % 12
  const useFlats = keyRoot !== undefined && FLAT_KEYS.has(((keyRoot % 12) + 12) % 12)
  return useFlats ? FLAT_NAMES[pc] : NOTE_NAMES[pc]
}

export function keyLabel(key: Key): string {
  const useFlats = FLAT_KEYS.has(key.root) && SCALES[key.scale].label.startsWith('Menor')
  const name = useFlats ? FLAT_NAMES[key.root] : NOTE_NAMES[key.root]
  return `${name} ${SCALES[key.scale].label.toLowerCase()}`
}

export interface ChordQuality {
  id: string
  label: string
  symbol: string
  intervals: number[]
}

export const CHORD_QUALITIES: ChordQuality[] = [
  { id: 'maj', label: 'Mayor', symbol: '', intervals: [0, 4, 7] },
  { id: 'min', label: 'Menor', symbol: 'm', intervals: [0, 3, 7] },
  { id: 'dim', label: 'Disminuido', symbol: '°', intervals: [0, 3, 6] },
  { id: 'aug', label: 'Aumentado', symbol: '+', intervals: [0, 4, 8] },
  { id: 'sus2', label: 'Suspendido 2', symbol: 'sus2', intervals: [0, 2, 7] },
  { id: 'sus4', label: 'Suspendido 4', symbol: 'sus4', intervals: [0, 5, 7] },
  { id: 'maj7', label: 'Séptima mayor', symbol: 'maj7', intervals: [0, 4, 7, 11] },
  { id: 'min7', label: 'Séptima menor', symbol: 'm7', intervals: [0, 3, 7, 10] },
  { id: 'dom7', label: 'Séptima dominante', symbol: '7', intervals: [0, 4, 7, 10] },
  { id: 'm7b5', label: 'Semidisminuido', symbol: 'm7b5', intervals: [0, 3, 6, 10] },
  { id: 'dim7', label: 'Séptima disminuida', symbol: '°7', intervals: [0, 3, 6, 9] },
  { id: 'six', label: 'Sexta', symbol: '6', intervals: [0, 4, 7, 9] },
  { id: 'add9', label: 'Novena añadida', symbol: 'add9', intervals: [0, 2, 4, 7] },
  { id: 'power', label: 'Quinta (power chord)', symbol: '5', intervals: [0, 7, 12] },
]

export function chordQuality(id: string): ChordQuality {
  return CHORD_QUALITIES.find((q) => q.id === id) ?? CHORD_QUALITIES[0]
}

/** Construye las notas MIDI de un acorde. */
export function buildChord(rootMidi: number, qualityId: string, inversion = 0): number[] {
  const q = chordQuality(qualityId)
  const notes = q.intervals.map((i) => rootMidi + i)
  for (let i = 0; i < inversion; i++) {
    const n = notes.shift()
    if (n !== undefined) notes.push(n + 12)
  }
  return notes
}

/**
 * Acordes diatónicos de una tonalidad (grados I..VII).
 * Devuelve el grado con su calidad y el nombre que se muestra.
 */
export interface DiatonicChord {
  degree: number // 1..7
  roman: string
  rootMidi: number // raíz en la octava indicada
  quality: string
  label: string
}

const MAJOR_ROMAN = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']
const MINOR_ROMAN = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']

/** Semitono (absoluto, creciente) del grado i de la escala, contando octavas. */
function scaleSemitone(key: Key, index: number): number {
  const steps = SCALES[key.scale].steps
  const n = steps.length
  const i = ((index % n) + n) % n
  return steps[i] + 12 * Math.floor(index / n)
}

/**
 * Apila terceras *diatónicas* desde un grado de la escala. Esto garantiza que
 * los acordes (tríada, séptima, novena) estén siempre en la tonalidad, cosa
 * que no ocurre si se usan plantillas fijas de calidad.
 * `degreeIndex` es 0-based (0 = tónica).
 */
export function diatonicStack(key: Key, degreeIndex: number, octaveBase = 4, size = 3): number[] {
  const basePc = (key.root + SCALES[key.scale].steps[((degreeIndex % SCALES[key.scale].steps.length) + SCALES[key.scale].steps.length) % SCALES[key.scale].steps.length]) % 12
  const baseMidi = (octaveBase + 1) * 12 + basePc
  const baseRef = scaleSemitone(key, degreeIndex)
  const out: number[] = []
  for (let k = 0; k < size; k++) {
    out.push(baseMidi + (scaleSemitone(key, degreeIndex + k * 2) - baseRef))
  }
  return out
}

/** Deducir la calidad de un acorde a partir de sus intervalos (semitonos). */
export function qualityFromNotes(rootMidi: number, notes: number[]): string {
  const iv = [...new Set(notes.map((n) => Math.round(n - rootMidi)))].sort((a, b) => a - b)
  const has = (x: number): boolean => iv.includes(x)
  const seventh = has(10) || has(11)
  const ninth = has(14) || has(13)
  if (has(3) && has(6) && has(10) && has(13)) return 'dim7'
  if (has(3) && has(6) && has(10)) return 'm7b5'
  if (has(3) && has(6)) return 'dim'
  if (has(4) && has(8)) return 'aug'
  if (has(3) && has(7) && has(11)) return 'min7'
  if (has(3) && has(7) && has(10)) return 'min7'
  if (has(3) && has(7)) return 'min'
  if (has(4) && has(7) && has(11)) return 'maj7'
  if (has(4) && has(7) && has(10)) return 'dom7'
  if (has(4) && has(7) && has(14)) return 'add9'
  if (has(4) && has(7) && has(9)) return 'six'
  if (has(4) && has(7)) return 'maj'
  if (has(2) && has(7)) return 'sus2'
  if (has(5) && has(7)) return 'sus4'
  if (has(7) && !has(3) && !has(4)) return 'power'
  if (seventh && ninth) return 'dom7'
  return 'maj'
}

export function diatonicChords(key: Key, octaveBase = 4): DiatonicChord[] {
  const steps = SCALES[key.scale].steps
  const minorish = key.scale !== 'major' && key.scale !== 'mixolydian'
  const romans = minorish ? MINOR_ROMAN : MAJOR_ROMAN
  const heptatonic = steps.length === 7
  return steps.map((step, i) => {
    const rootMidi = (octaveBase + 1) * 12 + ((key.root + step) % 12)
    // Las notas se apilan de forma diatónica: siempre dentro de la escala.
    const intervals = diatonicStack(key, i, octaveBase, 3)
    const qualityId = qualityFromNotes(rootMidi, intervals)
    const quality = chordQuality(qualityId)
    const name = spellPitch(rootMidi, key.root)
    // En escalas pentatónicas/blues los números romanos no aplican: se usa el grado.
    const roman = heptatonic ? romans[i] : `${i + 1}º`
    return {
      degree: i + 1,
      roman,
      rootMidi,
      quality: qualityId,
      label: `${name}${quality.symbol}`,
    }
  })
}

/** Detecta la tonalidad de un conjunto de notas (perfiles de Krumhansl-Schmuckler). */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

export interface KeyDetection {
  key: Key
  confidence: number
  alternatives: { key: Key; score: number }[]
}

export function detectKey(notes: { pitch: number; duration: number }[]): KeyDetection {
  const hist = new Array(12).fill(0)
  for (const n of notes) {
    const pc = ((n.pitch % 12) + 12) % 12
    hist[pc] += Math.max(0.05, n.duration)
  }
  const total = hist.reduce((a, b) => a + b, 0) || 1
  const norm = hist.map((v) => v / total)

  const corr = (profile: number[], rotation: number): number => {
    let a = 0
    let b = 0
    for (let i = 0; i < 12; i++) a += norm[(i + rotation) % 12] * profile[i]
    for (let i = 0; i < 12; i++) b += profile[i] * profile[i]
    return a / Math.sqrt(b)
  }

  const scored: { key: Key; score: number }[] = []
  for (let r = 0; r < 12; r++) {
    scored.push({ key: { root: r, scale: 'major' }, score: corr(MAJOR_PROFILE, r) })
    scored.push({ key: { root: r, scale: 'minor' }, score: corr(MINOR_PROFILE, r) })
  }
  scored.sort((x, y) => y.score - x.score)
  const best = scored[0]
  const second = scored[1] ?? best
  const confidence = Math.max(0, Math.min(1, 1 - second.score / (best.score || 1)))
  return { key: best.key, confidence, alternatives: scored.slice(0, 5) }
}

/** Armadura en notación VexFlow para un tono mayor/menor. */
export function keySignature(key: Key): string {
  const map: Record<number, string> = {
    0: 'C',
    1: 'Db',
    2: 'D',
    3: 'Eb',
    4: 'E',
    5: 'F',
    6: 'F#',
    7: 'G',
    8: 'Ab',
    9: 'A',
    10: 'Bb',
    11: 'B',
  }
  const name = map[key.root]
  return key.scale === 'major' ? name : `${name}m`
}
