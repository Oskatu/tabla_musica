/**
 * Transcripción de audio monofónico (tarareo, silbido, canto, un instrumento)
 * a notas MIDI mediante autocorrelación + seguimiento de nota.
 * Sin dependencias externas: todo corre en el navegador.
 */

import { freqToMidi, detectKey, KeyDetection, PPQ, isBlackKey } from '../lib/theory'

export interface DetectedNote {
  pitch: number
  startSec: number
  endSec: number
  velocity: number
  /** 0..1 confianza media de los fotogramas que forman la nota. */
  confidence: number
}

export interface TranscriptionResult {
  notes: DetectedNote[]
  bpm: number
  keyDetection: KeyDetection | null
  durationSec: number
  /** Frecuencia fundamental por fotograma (0 = silencio). */
  f0Track: { time: number; freq: number; rms: number }[]
  /** Curva de energía para el editor de recorte. */
  waveform: Float32Array
  /** BPM candidatos ordenados por probabilidad. */
  bpmCandidates: number[]
  warnings: string[]
}

export interface TranscribeOptions {
  /** Ventana del análisis en segundos (más corto = mejor resolución rítmica). */
  frameSec?: number
  /** Umbral de silencio relativo (0..1) sobre el RMS máximo. */
  silenceThreshold?: number
  /** (Compatibility) Tolerancia en cents para considerar que sigue la misma nota. */
  pitchToleranceCents?: number
  /** Rango de búsqueda de la fundamental. */
  minFreq?: number
  maxFreq?: number
}

const DEFAULT_OPTS: Required<TranscribeOptions> = {
  frameSec: 0.022,
  silenceThreshold: 0.06,
  pitchToleranceCents: 70,
  minFreq: 70,
  maxFreq: 1400,
}

/* ------------------------------------------------------------------ */
/* Detección de frecuencia                                             */
/* ------------------------------------------------------------------ */

/**
 * Autocorrelación normalizada (tipo YIN simplificado). Devuelve la frecuencia
 * fundamental en Hz o 0 si el fotograma no es periódico.
 */
export function detectPitchACF(frame: Float32Array, sampleRate: number, minFreq: number, maxFreq: number): number {
  const size = frame.length
  const minLag = Math.max(2, Math.floor(sampleRate / maxFreq))
  const maxLag = Math.min(size - 2, Math.ceil(sampleRate / minFreq))
  if (maxLag <= minLag) return 0

  // Quita la componente continua.
  let mean = 0
  for (let i = 0; i < size; i++) mean += frame[i]
  mean /= size
  const x = new Float32Array(size)
  for (let i = 0; i < size; i++) x[i] = frame[i] - mean

  let energy = 0
  for (let i = 0; i < size; i++) energy += x[i] * x[i]
  if (energy < 1e-7) return 0

  const nsdf = new Float32Array(maxLag + 1)
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acf = 0
    let norm = 0
    for (let i = 0; i + lag < size; i++) {
      acf += x[i] * x[i + lag]
      norm += x[i] * x[i] + x[i + lag] * x[i + lag]
    }
    nsdf[lag] = norm > 1e-9 ? (2 * acf) / norm : 0
  }

  // Picos del MDF: un pico por cada tramo donde nsdf > 0.
  const peaks: { lag: number; value: number }[] = []
  let lag = minLag
  while (lag <= maxLag) {
    if (nsdf[lag] > 0) {
      const regionStart = lag
      while (lag <= maxLag && nsdf[lag] > 0) lag++
      let peakLag = regionStart
      let peakVal = -Infinity
      for (let j = regionStart; j < lag && j <= maxLag; j++) {
        if (nsdf[j] > peakVal) {
          peakVal = nsdf[j]
          peakLag = j
        }
      }
      if (peakVal > 0) peaks.push({ lag: peakLag, value: peakVal })
    }
    lag++
  }
  if (peaks.length === 0) return 0

  // Se elige el primer pico "lo bastante alto": así se evita el error de
  // octava (el período doble puntúa igual de bien pero es el pico siguiente).
  const highest = peaks.reduce((m, p) => Math.max(m, p.value), 0)
  const chosen = peaks.find((p) => p.value >= highest * 0.9) ?? peaks[0]
  const bestLag = chosen.lag
  const bestVal = chosen.value

  if (bestLag <= 0 || bestLag >= maxLag || bestVal < 0.4) return 0

  // Interpolación parabólica alrededor del pico: precisión sub-muestra.
  const y0 = nsdf[bestLag - 1] ?? 0
  const y1 = nsdf[bestLag]
  const y2 = nsdf[bestLag + 1] ?? 0
  const denom = 2 * (2 * y1 - y0 - y2)
  const shift = denom !== 0 ? (y2 - y0) / denom : 0
  const refinedLag = bestLag + Math.max(-0.5, Math.min(0.5, shift))
  const freq = sampleRate / refinedLag
  if (freq < minFreq * 0.85 || freq > maxFreq * 1.15) return 0
  return freq
}

/** Nivel RMS de un fotograma. */
function rms(frame: Float32Array): number {
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
  return Math.sqrt(sum / frame.length)
}

/**
 * Filtro de mediana sobre la secuencia de alturas. Es la clave de la
 * precisión: la interpolación parabólica del pico de autocorrelación tiene un
 * sesgo que oscila lentamente (±50 cents) y la mediana lo elimina.
 */
function medianFilter(pitches: number[], radius: number): number[] {
  const out = pitches.slice()
  for (let i = 0; i < pitches.length; i++) {
    const vals: number[] = []
    for (let j = Math.max(0, i - radius); j <= Math.min(pitches.length - 1, i + radius); j++) {
      if (pitches[j] > 0) vals.push(pitches[j])
    }
    if (vals.length === 0) {
      out[i] = 0
      continue
    }
    vals.sort((a, b) => a - b)
    out[i] = vals[Math.floor(vals.length / 2)]
  }
  return out
}

/** Curva de energía reducida para dibujar la onda en la interfaz. */
function downsampleWaveform(data: Float32Array, buckets = 900): Float32Array {
  const out = new Float32Array(buckets)
  const step = Math.max(1, Math.floor(data.length / buckets))
  for (let b = 0; b < buckets; b++) {
    let max = 0
    const start = b * step
    const end = Math.min(data.length, start + step)
    for (let i = start; i < end; i++) max = Math.max(max, Math.abs(data[i]))
    out[b] = max
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Estimación de tempo                                                 */
/* ------------------------------------------------------------------ */

function estimateTempo(onsets: number[], durationSec: number): { bpm: number; candidates: number[] } {
  const fallback = { bpm: 100, candidates: [100, 90, 120, 80, 140] }
  if (onsets.length < 3 || durationSec < 1) return fallback

  const fold = (b: number): number => {
    let x = b
    while (x > 190) x /= 2
    while (x < 55) x *= 2
    return x
  }

  /**
   * Puntúa un tempo con una "peineta": cada ataque debe caer cerca de un
   * pulso (en cualquier fase) o de uno de sus múltiplos rítmicos.
   */
  const scoreTempo = (bpm: number): number => {
    const period = 60 / bpm
    let score = 0
    for (const t of onsets) {
      const phase = ((t % period) + period) % period
      const dist = Math.min(phase, period - phase)
      const sigma = period * 0.18 + 0.02
      score += Math.exp(-(dist * dist) / (2 * sigma * sigma))
    }
    // Los tempos con subdivisiones presentes puntúan igual de bien: se
    // normaliza por el número de pulsos del fragmento para no premiar
    // tempos lentos por acaso.
    const beats = durationSec / period
    return score / Math.sqrt(1 + beats * 0.05)
  }

  const scored: { bpm: number; score: number }[] = []
  for (let bpm = 55; bpm <= 190; bpm += 1) {
    let score = scoreTempo(bpm)
    // Prior suave: la música popular suele estar entre 80 y 140 BPM.
    if (bpm >= 80 && bpm <= 140) score *= 1.12
    else if (bpm < 70 || bpm > 160) score *= 0.92
    scored.push({ bpm, score })
  }
  scored.sort((a, b) => b.score - a.score)

  // Agrupa los tempos parecidos (mismo pulso) para quedarnos con un representante.
  const candidates: number[] = []
  for (const { bpm } of scored) {
    if (candidates.every((c) => Math.abs(c - bpm) > 4)) candidates.push(bpm)
    if (candidates.length >= 6) break
  }

  // Preferimos el más probable dentro de la banda habitual.
  const best = candidates[0] ?? fallback.bpm
  const preferred = candidates.find((b) => b >= 76 && b <= 150) ?? best
  const chosen = Math.abs(preferred - best) <= 8 ? best : preferred

  // Redondeo fino: el tempo "humano" suele ser entero.
  return { bpm: Math.round(fold(chosen)), candidates: candidates.map((c) => Math.round(c)) }
}

/* ------------------------------------------------------------------ */
/* Transcripción                                                       */
/* ------------------------------------------------------------------ */

/**
 * Transcribe un buffer mono. Es asíncrona porque cede el hilo cada cierto
 * número de fotogramas para que la interfaz siga respondiendo y pueda
 * mostrar el progreso.
 */
export async function transcribe(
  audio: Float32Array,
  sampleRate: number,
  userOpts: TranscribeOptions = {},
  onProgress?: (fraction: number) => void,
): Promise<TranscriptionResult> {
  const opts = { ...DEFAULT_OPTS, ...userOpts }
  const warnings: string[] = []
  const frameLen = Math.max(512, Math.round(opts.frameSec * sampleRate))
  const hop = Math.max(128, Math.round(frameLen / 2))
  const totalFrames = Math.max(1, Math.floor((audio.length - frameLen) / hop) + 1)

  const f0Track: { time: number; freq: number; rms: number }[] = []
  const rawPitches: number[] = []
  const energies: number[] = []
  const frame = new Float32Array(frameLen)

  for (let f = 0; f < totalFrames; f++) {
    if (f % 300 === 0) {
      onProgress?.(Math.min(0.98, f / totalFrames))
      // Cede el hilo para que la UI respire durante el análisis.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const start = f * hop
    frame.set(audio.subarray(start, start + frameLen))
    const level = rms(frame)
    const freq = level > 1e-5 ? detectPitchACF(frame, sampleRate, opts.minFreq, opts.maxFreq) : 0
    const t = (start + frameLen / 2) / sampleRate
    f0Track.push({ time: t, freq, rms: level })
    const midi = freq > 0 ? freqToMidi(freq) : 0
    rawPitches.push(midi)
    energies.push(level)
  }

  const maxEnergy = Math.max(...energies, 1e-6)
  const voicedThreshold = maxEnergy * opts.silenceThreshold
  const avgEnergy = energies.reduce((a, b) => a + b, 0) / Math.max(1, energies.length)
  if (avgEnergy < 0.004) {
    warnings.push('La grabación tiene muy poca señal. Sube el volumen del micrófono y acerca la boca.')
  }

  // Aplica el umbral de silencio y suaviza con mediana (radio 4 ≈ 100 ms).
  const gated = rawPitches.map((p, i) => (energies[i] >= voicedThreshold ? p : 0))
  const pitched = medianFilter(gated, 4)

  const hopsPerSec = sampleRate / hop
  const minNoteFrames = Math.max(2, Math.round(0.05 / (hop / sampleRate)))
  const maxGapFrames = Math.max(1, Math.round(0.07 / (hop / sampleRate)))

  // 1. Cuantiza cada fotograma con voz al semitono más cercano.
  const semis: number[] = pitched.map((p) => (p > 0 ? Math.round(p) : 0))

  // 2. Elimina aislados: un fotograma (o dos) distinto entre iguales (mediana 3).
  for (let i = 1; i < semis.length - 1; i++) {
    if (semis[i] !== 0 && semis[i - 1] === semis[i + 1] && semis[i - 1] !== semis[i]) {
      semis[i] = semis[i - 1]
    }
  }

  // 3. Fusiona tramos consecutivos del mismo semitono (ignorando huecos cortos).
  interface Raw {
    semitone: number
    startFrame: number
    endFrame: number
    frames: number[]
  }
  const groups: Raw[] = []
  let current: Raw | null = null
  let gapSince = 0

  for (let i = 0; i < semis.length; i++) {
    const semi = semis[i]
    if (semi === 0) {
      if (current && gapSince === 0) gapSince = i
      continue
    }
    if (!current) {
      current = { semitone: semi, startFrame: i, endFrame: i, frames: [i] }
      gapSince = 0
      continue
    }
    const gapFrames = gapSince ? i - gapSince : 0
    if (semi === current.semitone && gapFrames <= maxGapFrames) {
      // Continúa la misma nota (aunque haya un hueco breve en medio).
      current.frames.push(i)
      current.endFrame = i
      gapSince = 0
    } else {
      groups.push(current)
      current = { semitone: semi, startFrame: i, endFrame: i, frames: [i] }
      gapSince = 0
    }
  }
  if (current) groups.push(current)
  void opts

  const notes: DetectedNote[] = []
  for (const g of groups) {
    if (g.frames.length < minNoteFrames) continue
    // Altura final: mediana de los fotogramas con voz del tramo.
    const values = g.frames.map((f) => pitched[f]).filter((v) => v > 0).sort((a, b) => a - b)
    const meanMidi = values.length ? values[Math.floor(values.length / 2)] : g.semitone
    const rounded = Math.round(meanMidi)
    const startSec = g.startFrame / hopsPerSec
    const endSec = (g.endFrame + 1) / hopsPerSec
    let energySum = 0
    for (let i = g.startFrame; i <= g.endFrame; i++) energySum += energies[i] ?? 0
    const meanEnergy = energySum / (g.endFrame - g.startFrame + 1)
    // Confianza: cuánto se acerca la altura medida al semitono final.
    const deviation = Math.abs(meanMidi - rounded)
    notes.push({
      pitch: rounded,
      startSec,
      endSec: Math.max(endSec, startSec + 0.04),
      velocity: Math.max(0.25, Math.min(1, (meanEnergy / maxEnergy) * 1.15)),
      confidence: Math.max(0, Math.min(1, 1 - deviation * 1.5)),
    })
  }

  const durationSec = audio.length / sampleRate
  const onsets = notes.map((n) => n.startSec)
  const tempo = estimateTempo(onsets, durationSec)

  const keyDetection =
    notes.length >= 3
      ? detectKey(notes.map((n) => ({ pitch: n.pitch, duration: n.endSec - n.startSec })))
      : null

  if (notes.length === 0) {
    warnings.push('No se detectaron notas. Prueba a tararear más fuerte, sin ruido de fondo y manteniendo las notas.')
  } else if (notes.length < 4) {
    warnings.push('Se detectaron muy pocas notas: la transcripción será muy corta.')
  }

  onProgress?.(1)

  return {
    notes,
    bpm: tempo.bpm,
    keyDetection,
    durationSec,
    f0Track,
    waveform: downsampleWaveform(audio),
    bpmCandidates: tempo.candidates,
    warnings,
  }
}

/** Convierte audio multicanal en mono y lo remuestrea a la frecuencia indicada. */
export function toMonoResampled(buffer: AudioBuffer, targetRate = 22050): { data: Float32Array; rate: number } {
  const src = buffer.getChannelData(0)
  const chans = buffer.numberOfChannels
  const mono = new Float32Array(src.length)
  if (chans === 1) {
    mono.set(src)
  } else {
    for (let ch = 0; ch < chans; ch++) {
      const data = buffer.getChannelData(ch)
      for (let i = 0; i < mono.length; i++) mono[i] += data[i] / chans
    }
  }
  if (Math.abs(buffer.sampleRate - targetRate) < 1) return { data: mono, rate: buffer.sampleRate }

  const ratio = buffer.sampleRate / targetRate
  const length = Math.floor(mono.length / ratio)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    const a = mono[idx] ?? 0
    const b = mono[idx + 1] ?? a
    out[i] = a + (b - a) * frac
  }
  return { data: out, rate: targetRate }
}

/**
 * Convierte segundos a ticks con cuantización musical y rejilla.
 * Devuelve también el BPM ajustado (recalculado tras la cuantización).
 */
export function notesToTicks(
  notes: DetectedNote[],
  bpm: number,
  gridTicks: number,
  offsetTicks = 0,
): { tick: number; duration: number; pitch: number; velocity: number }[] {
  const secPerTick = 60 / (bpm * PPQ)
  const gridSec = gridTicks * secPerTick
  const quantize = (sec: number): number => {
    if (gridSec <= 0) return sec
    return Math.round(sec / gridSec) * gridSec
  }
  let prevEnd = -Infinity
  return notes.map((n) => {
    let start = Math.max(0, quantize(n.startSec))
    let end = quantize(n.endSec)
    if (start < prevEnd) start = prevEnd
    if (end <= start) end = start + Math.max(gridSec, 0.05)
    prevEnd = end
    return {
      tick: offsetTicks + Math.round(start / secPerTick),
      duration: Math.max(gridTicks, Math.round((end - start) / secPerTick)),
      pitch: n.pitch,
      velocity: n.velocity,
    }
  })
}

/** Sugiere el cambio de tonalidad más cercano para que todas las notas encajen en la escala. */
export function snapToScale(pitch: number, scalePcs: number[]): number {
  if (scalePcs.includes(((pitch % 12) + 12) % 12)) return pitch
  for (let d = 1; d <= 6; d++) {
    if (scalePcs.includes((((pitch + d) % 12) + 12) % 12)) return pitch + d
    if (scalePcs.includes((((pitch - d) % 12) + 12) % 12)) return pitch - d
  }
  return pitch
}

export function isAccidental(midi: number): boolean {
  return isBlackKey(midi)
}
