/**
 * Exportación a MusicXML (score-partwise): cada pista es una parte, con
 * compases, silencios, puntillos, ligaduras, armadura, compás y tempo.
 * El archivo se abre en MuseScore, Finale, Sibelius, Dorico, etc.
 */

import type { Project, Track } from '../state/types'
import { noteName, PPQ } from './theory'
import { buildScoreBars, barsForNotes, figureName, type ScoreNoteEvent } from './score'
import type { Track as TrackType } from '../state/types'

const FLAT_KEYS = new Set([1, 3, 5, 8, 10])
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/** Número de alteraciones de la armadura (positivo = sostenidos). */
const FIFTHS_MAJOR: Record<string, number> = {
  C: 0,
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
  'F#': 6,
  'C#': 7,
  F: -1,
  Bb: -2,
  Eb: -3,
  Ab: -4,
  Db: -5,
  Gb: -6,
  Cb: -7,
}

function keyFifths(root: number, scale: string): number {
  const minorish = scale !== 'major' && scale !== 'mixolydian'
  // Relativa mayor de la tonalidad menor (3 semitonos arriba).
  const majorRoot = minorish ? (root + 3) % 12 : root
  const useFlats = FLAT_KEYS.has(majorRoot)
  const name = useFlats ? FLAT_NAMES[majorRoot] : noteName(majorRoot)
  return FIFTHS_MAJOR[name] ?? 0
}

function spellXML(midi: number, root: number): { step: string; alter: number; octave: number } {
  const pc = ((midi % 12) + 12) % 12
  const useFlats = FLAT_KEYS.has(((root % 12) + 12) % 12)
  const name = useFlats ? FLAT_NAMES[pc] : noteName(pc)
  const letter = name[0]
  const alter = name.length > 1 ? (name[1] === '#' ? 1 : -1) : 0
  return { step: letter, alter, octave: Math.floor(midi / 12) - 1 }
}

/** Posición en el pentagrama para percusión sin altura definida. */
const DRUM_DISPLAY: Record<number, { step: string; octave: number }> = {
  35: { step: 'F', octave: 4 },
  36: { step: 'F', octave: 4 },
  37: { step: 'C', octave: 5 },
  38: { step: 'C', octave: 5 },
  39: { step: 'C', octave: 5 },
  40: { step: 'C', octave: 5 },
  41: { step: 'E', octave: 4 },
  42: { step: 'G', octave: 5 },
  43: { step: 'A', octave: 4 },
  44: { step: 'G', octave: 5 },
  45: { step: 'B', octave: 4 },
  46: { step: 'G', octave: 5 },
  47: { step: 'C', octave: 5 },
  48: { step: 'D', octave: 5 },
  49: { step: 'A', octave: 5 },
  50: { step: 'E', octave: 5 },
  51: { step: 'F', octave: 5 },
  53: { step: 'F', octave: 5 },
}

const MIDI_PROGRAMS: Record<string, number> = {
  piano: 1,
  epiano: 5,
  organ: 20,
  marimba: 13,
  guitar: 25,
  strings: 49,
  bass: 34,
  pad: 90,
  synth: 81,
  brass: 62,
  flute: 74,
  bell: 15,
  drums: 1,
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function unpitchedXml(midi: number): string {
  const d = DRUM_DISPLAY[midi] ?? { step: 'C', octave: 5 }
  return `        <unpitched><display-step>${d.step}</display-step><display-octave>${d.octave}</display-octave></unpitched>\n`
}

function pitchedXml(midi: number, root: number): string {
  const p = spellXML(midi, root)
  return `        <pitch><step>${p.step}</step><alter>${p.alter}</alter><octave>${p.octave}</octave></pitch>\n`
}

function clefXml(instrument: string): string {
  if (instrument === 'drums') return `        <clef><sign>percussion</sign><line>2</line></clef>\n`
  if (instrument === 'bass') return `        <clef><sign>F</sign><line>4</line></clef>\n`
  return `        <clef><sign>G</sign><line>2</line></clef>\n`
}

function noteToXml(
  event: ScoreNoteEvent,
  index: number,
  project: Project,
  instrument: string,
  partId: string,
  isFirstInChord: boolean,
): string {
  const n = event.notes[index]
  const isDrums = instrument === 'drums'
  const type = figureName(event.figure)
  const dots = event.figure.dotted ? '        <dot/>\n' : ''
  const ties =
    (isFirstInChord && n.tieTo ? `        <tie type="start"/>\n` : '') +
    (isFirstInChord && n.tieFrom ? `        <tie type="stop"/>\n` : '')
  const notations =
    isFirstInChord && (n.tieTo || n.tieFrom)
      ? `        <notations>${n.tieTo ? '<tied type="start"/>' : ''}${n.tieFrom ? '<tied type="stop"/>' : ''}</notations>\n`
      : ''

  return (
    `      <note>\n` +
    (isDrums ? unpitchedXml(n.midi) : pitchedXml(n.midi, project.keyRoot)) +
    `        <duration>${Math.round(event.duration)}</duration>\n` +
    ties +
    (isFirstInChord ? '' : `        <chord/>\n`) +
    `        <voice>1</voice>\n` +
    `        <type>${type}</type>\n` +
    dots +
    notations +
    (isDrums ? `        <instrument id="${partId}-I1"/>\n` : '') +
    `      </note>\n`
  )
}

export function toMusicXML(project: Project, options: { tracks?: TrackType[] } = {}): string {
  const withNotes = (options.tracks ?? project.tracks).filter((t) => t.notes.length > 0)
  const list: Track[] = withNotes.length ? withNotes : project.tracks.slice(0, 1)
  const totalBars = Math.max(project.bars, ...list.map((t) => barsForNotes(t.notes, project.timeSignature, 1)))
  const fifths = keyFifths(project.keyRoot, project.keyScale)
  const [beats, beatType] = project.timeSignature

  const parts: string[] = []

  list.forEach((track, idx) => {
    const partId = `P${idx + 1}`
    const isDrums = track.instrument === 'drums'
    const bars = buildScoreBars(track.notes, project.timeSignature, totalBars)
    const measures: string[] = []

    bars.forEach((bar, barIndex) => {
      const contents: string[] = []

      if (barIndex === 0) {
        contents.push(
          `      <attributes>\n` +
            `        <divisions>${PPQ}</divisions>\n` +
            `        <key><fifths>${fifths}</fifths></key>\n` +
            `        <time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>\n` +
            clefXml(track.instrument) +
            (isDrums ? `        <staff-details><staff-lines>1</staff-lines></staff-details>\n` : '') +
            `      </attributes>\n`,
        )
        contents.push(
          `      <direction placement="above">\n` +
            `        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(project.bpm)}</per-minute></metronome></direction-type>\n` +
            `        <sound tempo="${Math.round(project.bpm)}"/>\n` +
            `      </direction>\n`,
        )
      }

      for (const ev of bar.events) {
        if (ev.kind === 'rest') {
          contents.push(
            `      <note>\n` +
              `        <rest/>\n` +
              `        <duration>${Math.round(ev.duration)}</duration>\n` +
              `        <voice>1</voice>\n` +
              `        <type>${figureName(ev.figure)}</type>\n` +
              (ev.figure.dotted ? '        <dot/>\n' : '') +
              `      </note>\n`,
          )
          continue
        }
        ev.notes.forEach((_, i) => {
          contents.push(noteToXml(ev, i, project, track.instrument, partId, i === 0))
        })
      }

      measures.push(`    <measure number="${barIndex + 1}">\n${contents.join('')}    </measure>\n`)
    })

    parts.push(`  <part id="${partId}">\n${measures.join('')}  </part>\n`)
  })

  const partList = list
    .map(
      (t, i) =>
        `    <score-part id="P${i + 1}">\n` +
        `      <part-name>${escapeXml(t.name)}</part-name>\n` +
        `      <score-instrument id="P${i + 1}-I1"><instrument-name>${escapeXml(t.instrument)}</instrument-name></score-instrument>\n` +
        `      <midi-instrument id="P${i + 1}-I1"><midi-channel>${i + 1}</midi-channel><midi-program>${MIDI_PROGRAMS[t.instrument] ?? 1}</midi-program></midi-instrument>\n` +
        `    </score-part>\n`,
    )
    .join('')

  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">`,
    `<score-partwise version="4.0">`,
    `  <work><work-title>${escapeXml(project.name)}</work-title></work>`,
    `  <identification>`,
    `    <creator type="composer">Tabla Música</creator>`,
    `    <encoding><software>Tabla Música — estudio de composición</software><encoding-date>${new Date().toISOString().slice(0, 10)}</encoding-date></encoding>`,
    `  </identification>`,
    `  <credit page="1"><credit-words default-x="600" default-y="1500" justify="center" valign="top" font-size="22">${escapeXml(project.name)}</credit-words></credit>`,
    `  <part-list>`,
    partList.replace(/\n$/, ''),
    `  </part-list>`,
    parts.join('').replace(/\n$/, ''),
    `</score-partwise>`,
  ]

  return lines.join('\n') + '\n'
}

export function downloadText(text: string, filename: string, mime = 'application/xml'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
