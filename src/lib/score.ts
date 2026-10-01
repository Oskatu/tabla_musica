/**
 * Construcción de la notación: convierte las notas del editor (ticks) en
 * eventos listos para dibujar (figuras, silencios y ligaduras), dividiendo
 * las duraciones irregulares en figuras estándar y rellenando los huecos.
 */

import { Note } from '../state/types'
import { splitDuration, ticksPerBar, type NoteFigure } from './durations'
import { PPQ } from './theory'

export interface ScoreChordNote {
  midi: number
  /** Viene ligada desde el evento anterior (misma nota, figura partida). */
  tieFrom: boolean
  /** Se liga con el evento siguiente (la nota continúa). */
  tieTo: boolean
}

export interface ScoreNoteEvent {
  kind: 'note'
  start: number // tick relativo al inicio del compás
  duration: number
  figure: NoteFigure
  notes: ScoreChordNote[]
}

export interface ScoreRestEvent {
  kind: 'rest'
  start: number
  duration: number
  figure: NoteFigure
}

export type ScoreEvent = ScoreNoteEvent | ScoreRestEvent

export interface ScoreBar {
  index: number
  startTick: number
  events: ScoreEvent[]
  /** El compás no tiene ninguna nota. */
  empty: boolean
}

interface Segment {
  start: number
  duration: number
  midi: number
  continuesBefore: boolean
  continuesAfter: boolean
}

/**
 * Divide las notas en compases: recorta a las líneas divisorias, agrupa los
 * acordes, convierte en figuras estándar y añade silencios donde haga falta.
 */
export function buildScoreBars(notes: Note[], timeSignature: [number, number], bars: number): ScoreBar[] {
  const barTicks = ticksPerBar(timeSignature)
  const out: ScoreBar[] = []

  for (let b = 0; b < bars; b++) {
    const barStart = b * barTicks
    const barEnd = barStart + barTicks
    const segments: Segment[] = []

    for (const n of notes) {
      const s = Math.max(n.tick, barStart)
      const e = Math.min(n.tick + n.duration, barEnd)
      if (e - s < 1) continue
      segments.push({
        start: s,
        duration: e - s,
        midi: n.pitch,
        continuesBefore: n.tick < barStart - 0.5,
        continuesAfter: n.tick + n.duration > barEnd + 0.5,
      })
    }

    segments.sort((x, y) => x.start - y.start || x.midi - y.midi)

    // Agrupa en acordes (mismo inicio y misma duración).
    interface Group {
      start: number
      duration: number
      notes: Segment[]
    }
    const groups: Group[] = []
    for (const seg of segments) {
      const g = groups.find((x) => Math.abs(x.start - seg.start) < 1 && Math.abs(x.duration - seg.duration) < 1)
      if (g) g.notes.push(seg)
      else groups.push({ start: seg.start, duration: seg.duration, notes: [seg] })
    }

    // Una sola voz por pista: si dos acordes se solapan, el anterior se
    // acorta hasta el inicio del siguiente (la notación no admite solapes).
    for (let i = 0; i < groups.length - 1; i++) {
      const next = groups[i + 1]
      if (groups[i].start + groups[i].duration > next.start) {
        groups[i].duration = Math.max(1, next.start - groups[i].start)
      }
    }

    const events: ScoreEvent[] = []
    for (const g of groups) {
      const pieces = splitDuration(g.duration, g.start - barStart)
      let offset = g.start - barStart
      pieces.forEach((piece, i) => {
        const first = i === 0
        const last = i === pieces.length - 1
        events.push({
          kind: 'note',
          start: offset,
          duration: piece.ticks,
          figure: piece.figure,
          notes: g.notes.map((n) => ({
            midi: n.midi,
            tieFrom: !first || n.continuesBefore,
            tieTo: !last || n.continuesAfter,
          })),
        })
        offset += piece.ticks
      })
    }

    events.sort((x, y) => x.start - y.start)

    // Silencios que rellenan los huecos.
    const withRests: ScoreEvent[] = []
    let cursor = 0
    for (const ev of events) {
      if (ev.start > cursor + 1) {
        for (const piece of splitDuration(ev.start - cursor, cursor)) {
          withRests.push({ kind: 'rest', start: cursor, duration: piece.ticks, figure: piece.figure })
          cursor += piece.ticks
        }
      }
      withRests.push(ev)
      cursor = Math.max(cursor, ev.start + ev.duration)
    }
    if (cursor < barTicks - 1) {
      for (const piece of splitDuration(barTicks - cursor, cursor)) {
        withRests.push({ kind: 'rest', start: cursor, duration: piece.ticks, figure: piece.figure })
        cursor += piece.ticks
      }
    }

    out.push({ index: b, startTick: barStart, events: withRests, empty: segments.length === 0 })
  }

  return out
}

/** Nombre de compases necesarios para contener todas las notas. */
export function barsForNotes(notes: Note[], timeSignature: [number, number], minBars = 1): number {
  const barTicks = ticksPerBar(timeSignature)
  const last = notes.reduce((m, n) => Math.max(m, n.tick + n.duration), 0)
  return Math.max(minBars, Math.ceil(last / barTicks))
}

/** Nombre de figura en notación anglosajona, para MusicXML. */
export function figureName(figure: NoteFigure): string {
  switch (figure.vf) {
    case 'w':
      return 'whole'
    case 'h':
      return 'half'
    case 'q':
      return 'quarter'
    case '8':
      return 'eighth'
    case '16':
      return '16th'
    case '32':
      return '32nd'
    case '64':
      return '64th'
    default:
      return 'quarter'
  }
}

/** Duración en "divisions" de MusicXML (divisions = PPQ). */
export function divisionsFor(ticks: number): number {
  return Math.round((ticks / PPQ) * PPQ)
}
