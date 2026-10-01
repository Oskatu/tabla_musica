/**
 * Pruebas de teoría musical, duraciones, reparto en compases y generador.
 */

import { check, section } from './harness'
import { buildChord, diatonicChords, diatonicStack, detectKey, keyNotes, midiToLabel, PPQ, qualityFromNotes, SCALES } from '../src/lib/theory'
import { splitDuration, ticksPerBar, vexDuration } from '../src/lib/durations'
import { barsForNotes, buildScoreBars } from '../src/lib/score'
import { BASS_STYLES, CHORD_STYLES, DRUM_STYLES, PROGRESSIONS, generateBass, generateChords, generateDrums, generateMelody } from '../src/lib/generate'

const TS: [number, number] = [4, 4]
const KEY = { root: 0, scale: 'major' as const }

export function run(): void {
  section('[1] Duraciones y figuras musicales')
  for (const ticks of [PPQ / 8, PPQ / 4, PPQ / 2, PPQ, PPQ * 1.5, PPQ * 2, PPQ * 3, PPQ * 3.5, PPQ * 4, PPQ * 6, 137, 913, 1919]) {
    const total = splitDuration(ticks, 0).reduce((a, part) => a + part.ticks, 0)
    check(`splitDuration(${Math.round(ticks)}) reconstruye la duración`, Math.abs(total - ticks) < 0.001)
  }

  section('[2] Notas del editor → compases de partitura')
  const barTicks = ticksPerBar(TS)
  const awkward = [
    { id: 'a', tick: 0, duration: barTicks * 2 + PPQ * 1.5, pitch: 60, velocity: 0.8 },
    { id: 'b', tick: PPQ * 0.5, duration: PPQ * 3, pitch: 64, velocity: 0.8 },
    { id: 'c', tick: barTicks + PPQ / 3, duration: PPQ / 3, pitch: 67, velocity: 0.8 },
    { id: 'd', tick: barTicks * 3 - 10, duration: PPQ * 2, pitch: 72, velocity: 0.8 },
  ]
  const bars = buildScoreBars(awkward, TS, 4)
  check('genera el número de compases pedido', bars.length === 4)
  bars.forEach((bar, i) => {
    const total = bar.events.reduce((a, e) => a + e.duration, 0)
    check(`compás ${i + 1} cubierto al 100%`, Math.abs(total - barTicks) < 0.5, `(${Math.round(total)}/${barTicks})`)
    let cursor = 0
    const ordered = bar.events.every((e) => {
      const ok = e.start >= cursor - 0.5
      cursor = e.start + e.duration
      return ok
    })
    check(`compás ${i + 1} sin solapes`, ordered)
  })
  const tied = bars.flatMap((b) => b.events).filter((e) => e.kind === 'note' && e.notes.some((n) => n.tieTo)).length
  check('las notas largas se ligan', tied > 0, `(${tied} uniones)`)
  check('barsForNotes calcula el último compás', barsForNotes(awkward, TS, 1) === 4)

  // Un acorde que se solapa con el siguiente se recorta (una voz por pista)
  const overlap = [
    { id: '1', tick: 0, duration: PPQ * 4, pitch: 60, velocity: 0.8 },
    { id: '2', tick: PPQ * 2, duration: PPQ * 2, pitch: 64, velocity: 0.8 },
  ]
  const overlapBars = buildScoreBars(overlap, TS, 1)
  const noteEvents = overlapBars[0].events.filter((e) => e.kind === 'note')
  check('los solapes se recortan para una sola voz', noteEvents.length >= 2 && noteEvents[0].duration <= PPQ * 2 + 0.5, `${noteEvents.map((e) => e.duration).join('/')}`)

  section('[3] Teoría musical')
  check('Do mayor = C-E-G', JSON.stringify(buildChord(60, 'maj')) === JSON.stringify([60, 64, 67]))
  check('La menor = A-C-E', JSON.stringify(buildChord(57, 'min')) === JSON.stringify([57, 60, 64]))
  check('reconoce la calidad por intervalos', qualityFromNotes(60, [60, 64, 67]) === 'maj' && qualityFromNotes(60, [60, 63, 67, 70]) === 'min7' && qualityFromNotes(60, [60, 63, 66]) === 'dim')
  check(
    'grados de Do mayor correctos',
    diatonicChords(KEY, 4).map((c) => c.label).join(' ') === 'C Dm Em F G Am B°',
    diatonicChords(KEY, 4).map((c) => c.label).join(' '),
  )
  const seventh = diatonicStack(KEY, 4, 4, 4)
  // La séptima del V grado debe ser F (diatónica), no F#: se comprueba la clase de altura.
  check('la séptima del V grado es diatónica (F, no F#)', ((seventh[seventh.length - 1] % 12) + 12) % 12 === 5, midiToLabel(seventh[seventh.length - 1]))
  const detected = detectKey([
    { pitch: 60, duration: 2 },
    { pitch: 62, duration: 1 },
    { pitch: 64, duration: 2 },
    { pitch: 65, duration: 1 },
    { pitch: 67, duration: 3 },
    { pitch: 69, duration: 2 },
    { pitch: 71, duration: 1 },
    { pitch: 72, duration: 3 },
  ])
  check('detecta Do mayor', detected.key.root === 0 && detected.key.scale === 'major')

  section('[4] Generador musical')
  for (const style of CHORD_STYLES) {
    const part = generateChords({ key: KEY, bars: 8, timeSignature: TS, progression: PROGRESSIONS[0], style: style.id, octave: 4, extension: 1, voiceLeading: true, velocity: 0.8, seed: 21 })
    const pcs = keyNotes(KEY)
    const outside = part.notes.filter((n) => !pcs.includes(((n.pitch % 12) + 12) % 12))
    check(`acompañamiento "${style.id}" en la escala`, part.notes.length > 8 && outside.length === 0, `${part.notes.length} notas, ${outside.length} fuera`)
  }
  for (const style of BASS_STYLES) {
    const part = generateBass({ key: KEY, bars: 8, timeSignature: TS, progression: PROGRESSIONS[0], style: style.id, octave: 2, velocity: 0.9, seed: 7 })
    const range = part.notes.map((n) => n.pitch)
    check(`bajo "${style.id}" en registro de bajo`, Math.min(...range) >= 27 && Math.max(...range) <= 61, `${midiToLabel(Math.min(...range))}..${midiToLabel(Math.max(...range))}`)
  }
  for (const style of DRUM_STYLES) {
    const part = generateDrums({ bars: 4, timeSignature: TS, style: style.id, seed: 3, variation: 0.25, crashes: true })
    check(`batería "${style.id}" con piezas válidas`, part.notes.length > 8 && part.notes.every((n) => n.pitch >= 35 && n.pitch <= 53), `${part.notes.length} golpes`)
  }
  const melody = generateMelody({ key: KEY, bars: 8, timeSignature: TS, progression: PROGRESSIONS[1], octave: 5, seed: 11, density: 0.7, leapiness: 1, style: 'cantable' })
  check('melodía con notas y sin duraciones inválidas', melody.notes.length > 12 && melody.notes.every((n) => n.duration > 0 && n.tick >= 0 && n.tick < 8 * barTicks), `${melody.notes.length} notas`)
  const scalePcs = SCALES[KEY.scale].steps.map((s) => (KEY.root + s) % 12)
  const melodyInside = melody.notes.filter((n) => !scalePcs.includes(((n.pitch % 12) + 12) % 12))
  check('la melodía se mantiene en la tonalidad', melodyInside.length === 0, `${melodyInside.length} notas fuera`)

  // Determinismo: la misma semilla da el mismo resultado
  const a = generateDrums({ bars: 4, timeSignature: TS, style: 'rock', seed: 99, variation: 0.4, crashes: true })
  const b = generateDrums({ bars: 4, timeSignature: TS, style: 'rock', seed: 99, variation: 0.4, crashes: true })
  check('el generador es reproducible con la misma semilla', JSON.stringify(a.notes) === JSON.stringify(b.notes))
  const different = generateDrums({ bars: 4, timeSignature: TS, style: 'rock', seed: 100, variation: 0.4, crashes: true })
  check('otra semilla produce otra variación', JSON.stringify(a.notes) !== JSON.stringify(different.notes))
  check('vexDuration usa puntillos', vexDuration({ vf: 'q', ticks: 720, dotted: true, label: '' }) === 'qd')
}
