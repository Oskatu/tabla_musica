/**
 * Transporte global: coordina el motor de audio con la posición visual
 * (playhead) mediante un reloj compartido. Los componentes se suscriben
 * con requestAnimationFrame solo mientras suena la música.
 */

import { play, type EngineHandle } from './engine'
import type { Project } from '../state/types'
import { PPQ } from '../lib/theory'

export interface TransportState {
  playing: boolean
  originTick: number
  originTime: number // performance.now() al arrancar
  bpm: number
  startTick: number
  endTick: number
  loopEnabled: boolean
  loopStart: number
  loopEnd: number
}

type Listener = (tick: number, playing: boolean) => void

class Transport {
  state: TransportState = {
    playing: false,
    originTick: 0,
    originTime: 0,
    bpm: 100,
    startTick: 0,
    endTick: 0,
    loopEnabled: false,
    loopStart: 0,
    loopEnd: 0,
  }

  private handle: EngineHandle | null = null
  private listeners = new Set<Listener>()
  private raf = 0
  /** Marca externa: posición del ratón al hacer clic en la regla. */
  onStopCallback: (() => void) | null = null

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    const tick = this.currentTick()
    for (const l of this.listeners) l(tick, this.state.playing)
  }

  private loop = (): void => {
    if (!this.state.playing) return
    this.emit()
    this.raf = requestAnimationFrame(this.loop)
  }

  currentTick(now = performance.now()): number {
    const s = this.state
    if (!s.playing) return s.originTick
    const secPerTick = 60 / (s.bpm * PPQ)
    let tick = s.originTick + ((now - s.originTime) / 1000) / secPerTick
    if (s.loopEnabled && s.loopEnd > s.loopStart) {
      const span = s.loopEnd - s.loopStart
      if (tick >= s.loopEnd) {
        tick = s.loopStart + ((tick - s.loopStart) % span)
      }
    } else if (tick >= s.endTick) {
      tick = s.endTick
    }
    return tick
  }

  get isPlaying(): boolean {
    return this.state.playing
  }

  /** Posición de inicio actual (sin arrancar el audio). */
  setCursor(tick: number): void {
    if (this.state.playing) return
    this.state.originTick = Math.max(0, tick)
    this.emit()
  }

  start(
    project: Project,
    options: { startTick: number; metronome: boolean; onEnded?: () => void },
  ): void {
    if (this.state.playing) return
    const endTick = project.bars * ((PPQ * 4 * project.timeSignature[0]) / project.timeSignature[1])
    const originTick = Math.max(0, Math.min(options.startTick, endTick - PPQ / 4))
    const anySolo = project.tracks.some((t) => t.solo)
    if (!project.tracks.some((t) => !t.muted && (!anySolo || t.solo) && t.notes.length > 0)) {
      // Nada que suene, pero mantenemos el playhead moviéndose igualmente.
    }
    const handle = play(project, {
      startTick: originTick,
      endTick,
      metronome: options.metronome,
      loop: { enabled: project.id ? this.state.loopEnabled : false, startTick: this.state.loopStart, endTick: this.state.loopEnd },
      onLoop: () => {
        this.state.originTick = this.state.loopStart
        this.state.originTime = performance.now()
      },
      onEnded: () => {
        this.stop()
        options.onEnded?.()
      },
    })
    this.handle = handle
    this.state.playing = true
    this.state.originTick = originTick
    this.state.originTime = performance.now()
    this.state.bpm = project.bpm
    this.state.startTick = originTick
    this.state.endTick = endTick
    this.raf = requestAnimationFrame(this.loop)
    this.emit()
  }

  setLoop(loop: { enabled: boolean; startTick: number; endTick: number }): void {
    this.state.loopEnabled = loop.enabled
    this.state.loopStart = loop.startTick
    this.state.loopEnd = loop.endTick
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.handle?.stop()
    this.handle = null
    this.state.playing = false
    this.onStopCallback?.()
    this.emit()
  }

  /** Reenvía los cambios de mezcla al motor en caliente. */
  update(project: Project): void {
    this.state.bpm = project.bpm
    this.handle?.update(project)
  }
}

export const transport = new Transport()
