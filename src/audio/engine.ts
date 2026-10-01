/**
 * Motor de audio del estudio: grafo maestro con ganancia, paneo, EQ de 3
 * bandas, compresor, delay y reverb; reproducción con programación precisa
 * (look-ahead) y render offline para exportar WAV.
 */

import { InstrumentId, createReverbImpulse, triggerNote } from './instruments'
import type { Project, Track, Note } from '../state/types'
import { PPQ, midiToFreq } from '../lib/theory'
import { ticksPerBar } from '../lib/durations'

export interface MasterSettings {
  volume: number
  reverb: number
  delay: number
  delayFeedback: number
  compression: number
}

export interface ScheduledNote {
  track: Track
  note: Note
  startTick: number
  endTick: number
}

let ctx: AudioContext | null = null
let masterChain: MasterChain | null = null

interface MasterChain {
  input: GainNode
  master: GainNode
  analyser: AnalyserNode
  comp: DynamicsCompressorNode
  dry: GainNode
  reverbSend: GainNode
  delaySend: GainNode
  delayNode: DelayNode
  delayFeedback: GainNode
  convolver: ConvolverNode
  reverbReturn: GainNode
  delayReturn: GainNode
}

export function getContext(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = new Ctor({ latencyHint: 'interactive' })
  }
  return ctx
}

export function resumeContext(): Promise<void> {
  const c = getContext()
  if (c.state === 'suspended') return c.resume()
  return Promise.resolve()
}

function buildMasterChain(c: BaseAudioContext, settings: MasterSettings): MasterChain {
  const input = c.createGain()
  input.gain.value = 1

  const comp = c.createDynamicsCompressor()
  applyCompression(comp, settings.compression)

  const master = c.createGain()
  master.gain.value = settings.volume

  const analyser = c.createAnalyser()
  analyser.fftSize = 2048
  analyser.smoothingTimeConstant = 0.8

  const dry = c.createGain()
  dry.gain.value = 1

  // Reverb por convolución con impulso sintetizado.
  const convolver = c.createConvolver()
  convolver.buffer = createReverbImpulse(c)
  const reverbSend = c.createGain()
  reverbSend.gain.value = settings.reverb
  const reverbReturn = c.createGain()
  reverbReturn.gain.value = 1

  // Delay con realimentación filtrada (más cálido).
  const delayNode = c.createDelay(2)
  delayNode.delayTime.value = 0.375
  const delayFeedback = c.createGain()
  delayFeedback.gain.value = settings.delayFeedback
  const delayTone = c.createBiquadFilter()
  delayTone.type = 'lowpass'
  delayTone.frequency.value = 3200
  const delaySend = c.createGain()
  delaySend.gain.value = settings.delay
  const delayReturn = c.createGain()
  delayReturn.gain.value = 0.9

  // Enrutado: input -> comp -> master -> analyser -> salida
  input.connect(comp)
  comp.connect(master)
  master.connect(analyser)

  // Envíos (post-fader)
  master.connect(dry)
  dry.connect(analyser)
  master.connect(reverbSend)
  reverbSend.connect(convolver)
  convolver.connect(reverbReturn)
  reverbReturn.connect(analyser)
  master.connect(delaySend)
  delaySend.connect(delayNode)
  delayNode.connect(delayTone)
  delayTone.connect(delayFeedback)
  delayFeedback.connect(delayNode)
  delayTone.connect(delayReturn)
  delayReturn.connect(analyser)

  return {
    input,
    master,
    analyser,
    comp,
    dry,
    reverbSend,
    delaySend,
    delayNode,
    delayFeedback,
    convolver,
    reverbReturn,
    delayReturn,
  }
}

function applyCompression(comp: DynamicsCompressorNode, amount: number): void {
  const a = Math.max(0, Math.min(1, amount))
  comp.threshold.value = -6 - a * 18
  comp.knee.value = 12 + a * 18
  comp.ratio.value = 1.5 + a * 9
  comp.attack.value = 0.006
  comp.release.value = 0.18
}

export function getChain(settings: MasterSettings): MasterChain {
  const c = getContext()
  if (!masterChain) {
    masterChain = buildMasterChain(c, settings)
    if (pendingMaster) {
      const t = c.currentTime
      masterChain.master.gain.value = pendingMaster.volume
      masterChain.reverbSend.gain.value = pendingMaster.reverb
      masterChain.delaySend.gain.value = pendingMaster.delay
      masterChain.delayFeedback.gain.value = Math.min(0.85, pendingMaster.delayFeedback)
      applyCompression(masterChain.comp, pendingMaster.compression)
      void t
    }
  }
  return masterChain
}

/** ¿Ya se creó el contexto de audio? (evita crearlo antes de un gesto del usuario) */
export function hasAudioContext(): boolean {
  return ctx !== null
}

/** Últimos ajustes de master pedidos, para aplicarlos cuando exista el grafo. */
let pendingMaster: MasterSettings | null = null

/**
 * Aplica los ajustes del master. Si el contexto todavía no existe, solo se
 * guardan: así no se crea un AudioContext antes de que el usuario interactúe.
 */
export function applyMasterSettings(settings: MasterSettings): void {
  pendingMaster = settings
  if (!masterChain) return
  const c = getContext()
  const t = c.currentTime
  const chain = masterChain
  chain.master.gain.setTargetAtTime(settings.volume, t, 0.02)
  chain.reverbSend.gain.setTargetAtTime(settings.reverb, t, 0.02)
  chain.delaySend.gain.setTargetAtTime(settings.delay, t, 0.02)
  chain.delayFeedback.gain.setTargetAtTime(Math.min(0.85, settings.delayFeedback), t, 0.02)
  applyCompression(chain.comp, settings.compression)
}

/** Analizador del master, si el grafo ya está creado. */
export function getAnalyserIfReady(): AnalyserNode | null {
  return masterChain ? masterChain.analyser : null
}

export function getMasterSettings(): MasterSettings | null {
  return pendingMaster
}

/**
 * Cadena por pista: ganancia -> paneo -> EQ 3 bandas -> salida.
 * Se crea una vez por reproducción y se reutiliza para todas las notas.
 */
export interface TrackChannel {
  input: GainNode
  gain: GainNode
  meter: AnalyserNode
  pan: StereoPannerNode
  low: BiquadFilterNode
  mid: BiquadFilterNode
  high: BiquadFilterNode
  /** Ganancia sostenida por el "fader" (mute/solo se aplican aparte). */
  gainValue: number
}

/** Medidores activos durante la reproducción (pista -> analizador). */
const activeMeters = new Map<string, AnalyserNode>()

/** Nivel (0..1) de cada pista que está sonando ahora mismo. */
export function getTrackLevels(): Map<string, number> {
  const out = new Map<string, number>()
  activeMeters.forEach((analyser, id) => {
    const buf = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    out.set(id, Math.min(1, Math.sqrt(sum / buf.length) * 2.6))
  })
  return out
}

function buildTrackChannel(c: BaseAudioContext, input: GainNode): TrackChannel {
  const gain = c.createGain()
  const meter = c.createAnalyser()
  meter.fftSize = 512
  meter.smoothingTimeConstant = 0.65
  const pan = c.createStereoPanner()
  const low = c.createBiquadFilter()
  const mid = c.createBiquadFilter()
  const high = c.createBiquadFilter()
  low.type = 'lowshelf'
  low.frequency.value = 250
  mid.type = 'peaking'
  mid.frequency.value = 1200
  mid.Q.value = 0.9
  high.type = 'highshelf'
  high.frequency.value = 4000

  // gain -> meter -> pan -> EQ -> mezcla (el medidor es transparente al audio)
  gain.connect(meter)
  meter.connect(pan)
  pan.connect(low)
  low.connect(mid)
  mid.connect(high)
  high.connect(input)
  return { input: gain, gain, meter, pan, low, mid, high, gainValue: 1 }
}

function configureChannel(ch: TrackChannel, track: Track, masterVolumeCompensation: number, c: BaseAudioContext, when: number): void {
  const vol = track.volume * masterVolumeCompensation
  ch.gain.gain.setValueAtTime(ch.gain.gain.value, when)
  ch.gain.gain.linearRampToValueAtTime(vol, when + 0.02)
  ch.gainValue = vol
  ch.pan.pan.setValueAtTime(ch.pan.pan.value || 0, when)
  ch.pan.pan.linearRampToValueAtTime(track.pan, when + 0.02)
  ch.low.gain.value = track.eq.low
  ch.mid.gain.value = track.eq.mid
  ch.high.gain.value = track.eq.high
  void c
}

/** Normaliza el volumen de las pistas para que el proyecto no sature. */
function mixCompensation(project: Project, activeTracks: Track[]): number {
  const n = Math.max(1, activeTracks.length)
  // Cada pista ocupa aproximadamente 1/sqrt(n) del headroom, con un mínimo
  // para que una canción con muchas pistas no se vuelva inaudible.
  const base = 1 / Math.sqrt(n)
  void project
  return Math.max(0.35, Math.min(1, base * 1.35))
}

export interface PlayOptions {
  /** Tick global desde el que empieza la reproducción (0 = inicio). */
  startTick: number
  /** Tick global donde termina la canción. */
  endTick: number
  /** Instrumento preferido para las notas que suena al hacer preview. */
  onNoteVisual?: (trackId: string, midi: number, tick: number) => void
  /** Metrónomo habilitado. */
  metronome: boolean
  loop?: { enabled: boolean; startTick: number; endTick: number }
  onLoop?: () => void
  onEnded?: () => void
}

/** Devuelve todas las notas del proyecto ya ordenadas y con ticks absolutos. */
export function flattenNotes(project: Project): ScheduledNote[] {
  const out: ScheduledNote[] = []
  const anySolo = project.tracks.some((t) => t.solo)
  for (const track of project.tracks) {
    if (track.muted) continue
    if (anySolo && !track.solo) continue
    for (const note of track.notes) {
      out.push({ track, note, startTick: note.tick, endTick: note.tick + note.duration })
    }
  }
  out.sort((a, b) => a.startTick - b.startTick || a.note.pitch - b.note.pitch)
  return out
}

/** Tracks que suenan (respetando solo/mute). */
export function activeTracks(project: Project): Track[] {
  const anySolo = project.tracks.some((t) => t.solo)
  return project.tracks.filter((t) => !t.muted && (!anySolo || t.solo))
}

export interface EngineHandle {
  stop: () => void
  /** Cambia los valores del mezclador en caliente. */
  update: (project: Project) => void
}

/**
 * Inicia la reproducción con programación por adelantado.
 * Devuelve un handle para actualizar la mezcla o detener.
 */
export function play(project: Project, options: PlayOptions): EngineHandle {
  const c = getContext()
  const chain = getChain(project.master)
  applyMasterSettings(project.master)

  const tracks = activeTracks(project)
  const notes = flattenNotes(project)
  const comp = mixCompensation(project, tracks)

  const channels = new Map<string, TrackChannel>()
  const startTime = c.currentTime + 0.12
  const secPerTick = 60 / (project.bpm * PPQ)

  const startTick = Math.max(0, options.startTick)
  const endTick = Math.max(startTick + PPQ / 4, options.endTick)
  const loop = options.loop
  const loopActive = !!(loop && loop.enabled && loop.endTick > loop.startTick)

  for (const t of tracks) {
    const ch = buildTrackChannel(c, chain.input)
    configureChannel(ch, t, comp, c, startTime)
    channels.set(t.id, ch)
    activeMeters.set(t.id, ch.meter)
  }

  // Metrónomo: canal aparte que no pasa por la mezcla de pistas.
  const metroGain = c.createGain()
  metroGain.gain.value = options.metronome ? 0.5 : 0
  metroGain.connect(chain.input)

  const state = { stopped: false }
  let timer: number | undefined
  let passIndex = 0

  const schedulePass = (passStartTick: number, passStartTime: number, passEndTick: number): number => {
    const bars = ticksPerBar(project.timeSignature)
    // Rejilla del metrónomo: un clic por negra (o por la unidad del denominador).
    const clickTicks = (PPQ * 4) / project.timeSignature[1]
    let lastTime = passStartTime

    if (options.metronome) {
      const firstClick = Math.ceil(passStartTick / clickTicks) * clickTicks
      for (let tick = firstClick; tick < passEndTick; tick += clickTicks) {
        const when = passStartTime + (tick - passStartTick) * secPerTick
        const isDownbeat = Math.round((tick % bars) / clickTicks) === 0
        triggerNote(c, metroGain, 'bell', isDownbeat ? 88 : 81, when, 0.03, isDownbeat ? 0.5 : 0.28)
      }
    }

    for (const item of notes) {
      if (item.startTick < passStartTick) {
        // Nota que ya empezó antes: si aún suena al entrar, se acorta.
        const remaining = item.endTick - passStartTick
        if (remaining > PPQ / 8 && !item.track.muted) {
          const ch = channels.get(item.track.id)
          if (!ch) continue
          const when = passStartTime
          const dur = Math.min(remaining, passEndTick - passStartTick) * secPerTick
          triggerNote(c, ch.input, item.track.instrument, item.note.pitch + item.track.transpose, when, dur, item.note.velocity)
          lastTime = Math.max(lastTime, when + dur)
        }
        continue
      }
      if (item.startTick >= passEndTick) break
      const ch = channels.get(item.track.id)
      if (!ch) continue
      const when = passStartTime + (item.startTick - passStartTick) * secPerTick
      const dur = (item.endTick - item.startTick) * secPerTick
      triggerNote(c, ch.input, item.track.instrument, item.note.pitch + item.track.transpose, when, dur, item.note.velocity)
      lastTime = Math.max(lastTime, when + dur)
    }
    return lastTime
  }

  const runPass = (): void => {
    if (state.stopped) return
    const passStartTick = loopActive ? loop.startTick : startTick
    const passEndTick = loopActive ? loop.endTick : endTick
    const passStartTime = c.currentTime + 0.08
    schedulePass(passStartTick, passStartTime, passEndTick)
    if (loopActive) {
      const durationSec = (passEndTick - passStartTick) * secPerTick
      passIndex++
      timer = window.setTimeout(() => {
        options.onLoop?.()
        runPass()
      }, Math.max(50, durationSec * 1000))
      void passIndex
    } else {
      const durationSec = (passEndTick - passStartTick) * secPerTick
      timer = window.setTimeout(() => {
        state.stopped = true
        channels.forEach((ch) => ch.input.disconnect())
        metroGain.disconnect()
        activeMeters.clear()
        options.onEnded?.()
      }, Math.max(50, (durationSec + 1.2) * 1000))
    }
  }

  runPass()

  return {
    stop: () => {
      state.stopped = true
      if (timer !== undefined) window.clearTimeout(timer)
      activeMeters.clear()
      channels.forEach((ch) => {
        try {
          ch.gain.gain.cancelScheduledValues(c.currentTime)
          ch.gain.gain.setTargetAtTime(0, c.currentTime, 0.02)
        } catch {
          /* ignorar */
        }
        window.setTimeout(() => ch.input.disconnect(), 400)
      })
      window.setTimeout(() => metroGain.disconnect(), 400)
    },
    update: (next: Project) => {
      const t = c.currentTime
      const nextActive = activeTracks(next)
      const nextComp = mixCompensation(next, nextActive)
      nextActive.forEach((track) => {
        const ch = channels.get(track.id)
        if (!ch) return
        ch.gain.gain.setTargetAtTime(track.volume * nextComp, t, 0.03)
        ch.pan.pan.setTargetAtTime(track.pan, t, 0.03)
        ch.low.gain.setTargetAtTime(track.eq.low, t, 0.03)
        ch.mid.gain.setTargetAtTime(track.eq.mid, t, 0.03)
        ch.high.gain.setTargetAtTime(track.eq.high, t, 0.03)
      })
      // Las pistas silenciadas ahora mismo bajan a cero.
      channels.forEach((ch, id) => {
        if (!nextActive.some((t2) => t2.id === id)) ch.gain.gain.setTargetAtTime(0, t, 0.03)
      })
      const chainNext = getChain(next.master)
      chainNext.master.gain.setTargetAtTime(next.master.volume, t, 0.03)
      chainNext.reverbSend.gain.setTargetAtTime(next.master.reverb, t, 0.03)
      chainNext.delaySend.gain.setTargetAtTime(next.master.delay, t, 0.03)
      chainNext.delayFeedback.gain.setTargetAtTime(Math.min(0.85, next.master.delayFeedback), t, 0.03)
      applyCompression(chainNext.comp, next.master.compression)
    },
  }
}

/** Toca una sola nota (preview al hacer clic en el piano / teclado). */
export function previewNote(instrument: InstrumentId, midi: number, durationSec = 0.5, velocity = 0.85): void {
  const c = getContext()
  const chain = getChain({ volume: 1, reverb: 0.18, delay: 0.1, delayFeedback: 0.3, compression: 0.25 })
  const bus = c.createGain()
  bus.gain.value = 0.9
  bus.connect(chain.input)
  triggerNote(c, bus, instrument, midi, c.currentTime + 0.01, durationSec, velocity)
  window.setTimeout(() => {
    try {
      bus.disconnect()
    } catch {
      /* ignorar */
    }
  }, (durationSec + 2.5) * 1000)
}

/* ------------------------------------------------------------------ */
/* Render offline y exportación WAV                                    */
/* ------------------------------------------------------------------ */

export async function renderProject(project: Project, options?: { metronome?: boolean }): Promise<AudioBuffer> {
  const notes = flattenNotes(project)
  const lastTick = notes.reduce((m, n) => Math.max(m, n.endTick), 0)
  const bars = Math.max(1, Math.ceil(lastTick / ticksPerBar(project.timeSignature)))
  const totalTicks = Math.max(bars * ticksPerBar(project.timeSignature), ticksPerBar(project.timeSignature))
  const secPerTick = 60 / (project.bpm * PPQ)
  const tail = 3.5
  const duration = totalTicks * secPerTick + tail

  const sampleRate = 44100
  const OfflineCtor =
    window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext
  const oc = new OfflineCtor(2, Math.ceil(duration * sampleRate), sampleRate) as unknown as OfflineAudioContext

  const chain = buildMasterChain(oc, project.master)
  chain.master.gain.value = project.master.volume
  chain.reverbSend.gain.value = project.master.reverb
  chain.delaySend.gain.value = project.master.delay
  chain.delayFeedback.gain.value = Math.min(0.85, project.master.delayFeedback)

  const tracks = activeTracks(project)
  const comp = mixCompensation(project, tracks)
  const channels = new Map<string, TrackChannel>()
  for (const t of tracks) {
    const ch = buildTrackChannel(oc, chain.input)
    ch.gain.gain.value = t.volume * comp
    ch.pan.pan.value = t.pan
    ch.low.gain.value = t.eq.low
    ch.mid.gain.value = t.eq.mid
    ch.high.gain.value = t.eq.high
    channels.set(t.id, ch)
  }

  const metroGain = oc.createGain()
  metroGain.gain.value = options?.metronome ? 0.4 : 0
  metroGain.connect(chain.input)
  if (options?.metronome) {
    const clickTicks = (PPQ * 4) / project.timeSignature[1]
    const bars = ticksPerBar(project.timeSignature)
    for (let tick = 0; tick <= totalTicks; tick += clickTicks) {
      const isDownbeat = Math.round((tick % bars) / clickTicks) === 0
      triggerNote(oc, metroGain, 'bell', isDownbeat ? 88 : 81, tick * secPerTick, 0.03, isDownbeat ? 0.5 : 0.25)
    }
  }

  for (const item of notes) {
    const ch = channels.get(item.track.id)
    if (!ch) continue
    triggerNote(
      oc,
      ch.input,
      item.track.instrument,
      item.note.pitch + item.track.transpose,
      item.startTick * secPerTick,
      (item.endTick - item.startTick) * secPerTick,
      item.note.velocity,
    )
  }

  return oc.startRendering()
}

export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const length = buffer.length
  const bytesPerSample = 2
  const blockAlign = numChannels * bytesPerSample
  const dataSize = length * blockAlign
  const bufferArray = new ArrayBuffer(44 + dataSize)
  const view = new DataView(bufferArray)

  const writeString = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  const channels: Float32Array[] = []
  for (let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch))

  let offset = 44
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }
  return new Blob([bufferArray], { type: 'audio/wav' })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Exporta el proyecto completo a WAV (con metrónomo opcional). */
export async function exportToWav(project: Project, metronome = false): Promise<void> {
  const buffer = await renderProject(project, { metronome })
  const blob = audioBufferToWav(buffer)
  downloadBlob(blob, `${project.name.replace(/[^\w\-]+/g, '_') || 'cancion'}.wav`)
}

export { midiToFreq }
