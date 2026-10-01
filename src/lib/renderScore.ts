/**
 * Dibujo de la partitura con VexFlow. Está separado de React para poder
 * probarlo de forma aislada y para poder exportar el SVG resultante.
 */

import { Accidental, Beam, Formatter, Renderer, Stave, StaveConnector, StaveNote, StaveTie, Voice } from 'vexflow'
import type { Project, Track } from '../state/types'
import { keySignature, spellPitch } from './theory'
import { vexDuration } from './durations'
import { barsForNotes, buildScoreBars, type ScoreBar } from './score'

const SYSTEM_PAD = 12
const STAFF_HEIGHT = 106
const FIRST_MEASURE_EXTRA = 62

export interface RenderScoreOptions {
  project: Project
  tracks: Track[]
  totalBars: number
  barsPerSystem: number
  scale: number
  showColors: boolean
  showTies: boolean
  width: number
}

/** Altura MIDI -> clave de VexFlow ("c/4", "f#/5"...). */
export function keyFor(midi: number, keyRoot: number): string {
  const name = spellPitch(midi, keyRoot)
  const step = name[0].toLowerCase() + (name.length > 1 ? name[1] : '')
  const octave = Math.floor(midi / 12) - 1
  return `${step}/${octave}`
}

/** Posición en la clave de percusión para cada pieza de batería. */
export const DRUM_KEY: Record<number, string> = {
  35: 'f/4',
  36: 'f/4',
  37: 'c/5',
  38: 'c/5',
  39: 'c/5',
  40: 'c/5',
  41: 'e/4',
  42: 'g/5',
  43: 'a/4',
  44: 'g/5',
  45: 'b/4',
  46: 'g/5',
  47: 'c/5',
  48: 'd/5',
  49: 'a/5',
  50: 'e/5',
  51: 'f/5',
  53: 'f/5',
}

const clefFor = (track: Track): string =>
  track.instrument === 'drums' ? 'percussion' : track.instrument === 'bass' ? 'bass' : 'treble'

/** Mapa de ligaduras pendientes entre compases (se reinicia en cada dibujo). */
let pendingTies = new Map<string, { note: StaveNote; indices: number[] }>()

/**
 * Dibuja la partitura completa dentro de `host` (se vacía antes).
 * Devuelve el número de pentagramas y de notas pintadas.
 */
export function renderScore(host: HTMLElement, options: RenderScoreOptions): { systems: number; notes: number } {
  const { project, tracks, totalBars, barsPerSystem, scale, showColors, showTies, width } = options
  host.innerHTML = ''
  pendingTies = new Map()
  if (tracks.length === 0) return { systems: 0, notes: 0 }

  const usableWidth = (width - SYSTEM_PAD * 2) / scale
  if (usableWidth < 240) return { systems: 0, notes: 0 }

  const systems = Math.max(1, Math.ceil(totalBars / barsPerSystem))
  const measureWidthBase = usableWidth / barsPerSystem
  const timeSignature: [number, number] = project.timeSignature
  const keySig = keySignature({ root: project.keyRoot, scale: project.keyScale })

  const scoreByTrack = new Map<string, ScoreBar[]>()
  for (const track of tracks) {
    scoreByTrack.set(track.id, buildScoreBars(track.notes, timeSignature, totalBars))
  }

  let drawnNotes = 0

  for (let s = 0; s < systems; s++) {
    const firstBar = s * barsPerSystem
    const barsInSystem = Math.min(barsPerSystem, Math.max(0, totalBars - firstBar))
    if (barsInSystem === 0) break
    const systemWidth = measureWidthBase * barsInSystem + (firstBar === 0 ? FIRST_MEASURE_EXTRA : 0)
    const height = tracks.length * STAFF_HEIGHT + 34

    const div = document.createElement('div')
    div.style.height = `${Math.ceil(height * scale)}px`
    div.style.position = 'relative'
    host.appendChild(div)

    let ctx: ReturnType<Renderer['getContext']>
    try {
      const renderer = new Renderer(div as HTMLDivElement, Renderer.Backends.SVG)
      renderer.resize(systemWidth * scale + 8, height * scale + 8)
      ctx = renderer.getContext()
      ctx.scale(scale, scale)
    } catch (err) {
      console.warn('No se pudo inicializar el render de la partitura', err)
      continue
    }

    // 1. Pentagramas.
    const staves: Stave[][] = []
    tracks.forEach((track, rowIndex) => {
      const row: Stave[] = []
      for (let m = 0; m < barsInSystem; m++) {
        const barIndex = firstBar + m
        const x = SYSTEM_PAD + m * measureWidthBase
        const isFirst = m === 0
        const staveWidth = measureWidthBase + (isFirst ? FIRST_MEASURE_EXTRA : 0)
        const stave = new Stave(x, rowIndex * STAFF_HEIGHT + 26, staveWidth)
        if (isFirst) {
          stave.addClef(clefFor(track))
          if (barIndex === 0) stave.addKeySignature(keySig)
          stave.addTimeSignature(`${timeSignature[0]}/${timeSignature[1]}`)
        } else if (barIndex === 0) {
          stave.addKeySignature(keySig)
        }
        row.push(stave)
      }
      staves.push(row)
    })

    // Nombre de la pista como etiqueta HTML (más robusto que el texto de VexFlow,
    // que depende de medir glifos SVG con getBBox).
    tracks.forEach((track, rowIndex) => {
      const label = document.createElement('div')
      label.textContent = track.name
      label.style.cssText = `position:absolute;left:${SYSTEM_PAD}px;top:${rowIndex * STAFF_HEIGHT + 4}px;font-size:11px;font-weight:600;color:#4a5568;letter-spacing:0.3px;pointer-events:none;`
      div.appendChild(label)
    })

    // 2. Voces y notas.
    const voicesByMeasure: Voice[][] = []
    const beams: Beam[] = []
    const tieHooks: { first: StaveNote; last: StaveNote; indices: number[] }[] = []

    for (let m = 0; m < barsInSystem; m++) {
      const barIndex = firstBar + m
      const voices: Voice[] = []
      tracks.forEach((track) => {
        const clef = clefFor(track)
        const isDrums = track.instrument === 'drums'
        const bar = scoreByTrack.get(track.id)?.[barIndex]
        const notes: StaveNote[] = []

        if (bar) {
          for (const ev of bar.events) {
            if (ev.kind === 'rest') {
              const rest = new StaveNote({ keys: [clef === 'bass' ? 'd/3' : 'b/4'], duration: `${vexDuration(ev.figure)}r`, clef })
              if (showColors) rest.setStyle({ fillStyle: '#8b93a5', strokeStyle: '#8b93a5' })
              notes.push(rest)
              continue
            }
            const keys = ev.notes.map((n) => (isDrums ? (DRUM_KEY[n.midi] ?? 'c/5') : keyFor(n.midi, project.keyRoot)))
            const note = new StaveNote({ keys, duration: vexDuration(ev.figure), clef, auto_stem: true })
            if (showColors) note.setStyle({ fillStyle: track.color, strokeStyle: track.color })
            notes.push(note)
            drawnNotes++

            if (showTies) {
              const pending = pendingTies.get(track.id)
              if (pending && ev.notes.some((n) => n.tieFrom)) {
                tieHooks.push({ first: pending.note, last: note, indices: pending.indices })
              }
              if (ev.notes.some((n) => n.tieTo)) {
                pendingTies.set(track.id, { note, indices: ev.notes.map((_, i) => i) })
              } else {
                pendingTies.delete(track.id)
              }
            }
          }
        }

        const voice = new Voice({ num_beats: timeSignature[0], beat_value: timeSignature[1] })
        voice.setMode(Voice.Mode.SOFT)
        voice.addTickables(notes)
        voices.push(voice)
        const beamables = notes.filter((n) => {
          const d = n.getDuration()
          return d !== 'w' && d !== 'h' && !d.endsWith('r')
        })
        if (beamables.length > 1) {
          try {
            beams.push(...Beam.generateBeams(beamables))
          } catch {
            /* sin barras si no se pueden agrupar */
          }
        }
      })
      voicesByMeasure.push(voices)
    }

    // 3. Formateo y dibujo. Cada paso va protegido: un fallo puntual
    // (por ejemplo al medir un glifo) no debe dejar el sistema en blanco.
    staves.forEach((row) =>
      row.forEach((stave) => {
        try {
          stave.setContext(ctx).draw()
        } catch (err) {
          console.warn('No se pudo dibujar un pentagrama', err)
        }
      }),
    )

    for (let r = 1; r < tracks.length; r++) {
      try {
        new StaveConnector(staves[r - 1][0], staves[r][0]).setType(StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw()
        new StaveConnector(staves[r - 1][barsInSystem - 1], staves[r][barsInSystem - 1])
          .setType(StaveConnector.type.SINGLE_RIGHT)
          .setContext(ctx)
          .draw()
      } catch (err) {
        console.warn('No se pudo dibujar el conector', err)
      }
    }
    if (tracks.length > 1) {
      try {
        new StaveConnector(staves[0][0], staves[staves.length - 1][0]).setType(StaveConnector.type.BRACE).setContext(ctx).draw()
        new StaveConnector(staves[0][0], staves[staves.length - 1][0]).setType(StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw()
      } catch (err) {
        console.warn('No se pudo dibujar la llave', err)
      }
    }

    for (let m = 0; m < barsInSystem; m++) {
      try {
        const voices = voicesByMeasure[m]
        if (voices.length === 0) continue
        const formatter = new Formatter()
        formatter.joinVoices(voices)
        const justifyWidth = measureWidthBase + (m === 0 ? FIRST_MEASURE_EXTRA : 0) - 26
        formatter.format(voices, justifyWidth)
        voices.forEach((voice, rowIndex) => {
          if (voice) voice.draw(ctx, staves[rowIndex][m])
        })
      } catch (err) {
        console.warn(`No se pudo dibujar el compás ${m + 1} del sistema ${s + 1}`, err)
      }
    }

    beams.forEach((beam) => {
      try {
        beam.setContext(ctx).draw()
      } catch {
        /* barras problemáticas */
      }
    })
    tieHooks.forEach((hook) => {
      try {
        new StaveTie({ first_note: hook.first, last_note: hook.last, first_indices: hook.indices, last_indices: hook.indices })
          .setContext(ctx)
          .draw()
      } catch {
        /* ligaduras problemáticas */
      }
    })
    if (tracks.some((t) => t.instrument !== 'drums')) {
      try {
        Accidental.applyAccidentals(voicesByMeasure.flat(), keySig)
      } catch {
        /* sin alteraciones automáticas */
      }
    }
  }

  return { systems, notes: drawnNotes }
}

/** Compases necesarios para dibujar todas las pistas visibles. */
export function barsToRender(project: Project, tracks: Track[]): number {
  const maxNotes = tracks.reduce((m, t) => Math.max(m, barsForNotes(t.notes, project.timeSignature, project.bars)), 0)
  return Math.max(project.bars, maxNotes + (maxNotes === project.bars ? 0 : 1))
}
