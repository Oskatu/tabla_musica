/**
 * Pruebas de la transcripción de tarareo: se sintetizan melodías con vibrato,
 * ruido y armónicos (como una voz) y se comprueba que se recuperan las notas.
 */

import { check, section } from './harness'
import { PPQ, freqToMidi, midiToLabel } from '../src/lib/theory'

const SR = 22050

/** Genera una melodía monofónica con vibrato (modulación de fase) y ruido. */
function synthMelody(
  notes: { midi: number; beats: number }[],
  bpm: number,
  harmonics: number[] = [0.6, 0.25, 0.1],
  noise = 0.008,
): Float32Array {
  const secPerBeat = 60 / bpm
  const out: number[] = []
  const gap = Math.round(0.005 * SR)
  for (const note of notes) {
    const len = Math.round(note.beats * secPerBeat * SR)
    const freq = 440 * Math.pow(2, (note.midi - 69) / 12)
    for (let i = 0; i < len; i++) {
      const t = i / SR
      const vibrato = 1.0 * Math.sin(2 * Math.PI * 5.4 * t)
      const envelope = Math.min(1, t / 0.03) * Math.min(1, (len / SR - t) / 0.05)
      let value = 0
      harmonics.forEach((amp, h) => {
        value += amp * Math.sin(2 * Math.PI * freq * (h + 1) * t + vibrato * (h + 1))
      })
      out.push(value * 0.6 * envelope + (Math.random() * 2 - 1) * noise)
    }
    for (let i = 0; i < gap; i++) out.push(0)
  }
  return Float32Array.from(out)
}

export async function run(): Promise<void> {
  const { detectPitchACF, notesToTicks, transcribe } = await import('../src/audio/transcribe')

  section('[7] Detección de altura (autocorrelación)')
  for (const midi of [45, 55, 60, 64, 67, 72, 79]) {
    const freq = 440 * Math.pow(2, (midi - 69) / 12)
    const frameLen = 1024
    const frame = new Float32Array(frameLen)
    for (let i = 0; i < frameLen; i++) {
      frame[i] = 0.6 * Math.sin((2 * Math.PI * freq * i) / SR) + 0.25 * Math.sin((2 * Math.PI * freq * 2 * i) / SR) + 0.1 * Math.sin((2 * Math.PI * freq * 3 * i) / SR) + (Math.random() * 2 - 1) * 0.01
    }
    const detected = detectPitchACF(frame, SR, 70, 1400)
    const cents = detected > 0 ? (freqToMidi(detected) - midi) * 100 : Number.NaN
    check(`detecta ${midiToLabel(midi)} con error < 35 cents`, Math.abs(cents) < 35, `${cents.toFixed(1)} cents`)
  }
  const silence = new Float32Array(2048)
  check('el silencio no produce altura', detectPitchACF(silence, SR, 70, 1400) === 0)

  section('[8] Transcripción de melodías')
  const target = [
    { midi: 67, beats: 1 },
    { midi: 69, beats: 1 },
    { midi: 71, beats: 1 },
    { midi: 72, beats: 2 },
    { midi: 71, beats: 1 },
    { midi: 69, beats: 1 },
    { midi: 67, beats: 2 },
  ]
  const result = await transcribe(synthMelody(target, 100), SR)
  console.log(`   detectadas ${result.notes.length} notas · ${result.bpm} BPM · tonalidad ${result.keyDetection?.key.root}/${result.keyDetection?.key.scale}`)
  check('encuentra todas las notas', Math.abs(result.notes.length - target.length) <= 1, `${result.notes.length} vs ${target.length}`)
  check(
    'acierta las alturas exactas',
    result.notes.length >= target.length - 1 && target.every((t, i) => !result.notes[i] || result.notes[i].pitch === t.midi),
    result.notes.map((n) => midiToLabel(n.pitch)).join(' '),
  )
  check('estima el tempo correcto', Math.abs(result.bpm - 100) <= 2, `${result.bpm} BPM`)
  check('propone una tonalidad', !!result.keyDetection)
  const ticks = notesToTicks(result.notes, result.bpm, PPQ / 2)
  check('convierte a ticks sin solapes', ticks.every((n, i) => i === 0 || n.tick >= ticks[i - 1].tick + 0))
  check('las duraciones son positivas y cuantizadas', ticks.every((n) => n.duration > 0 && n.tick % (PPQ / 8) === 0))

  // Otra melodía, más grave y con armónicos distintos (voz masculina)
  const low = [
    { midi: 48, beats: 1 },
    { midi: 50, beats: 1 },
    { midi: 52, beats: 2 },
    { midi: 50, beats: 1 },
    { midi: 48, beats: 2 },
  ]
  const lowResult = await transcribe(synthMelody(low, 90, [0.5, 0.3, 0.15, 0.08], 0.012), SR)
  check('funciona en registro grave', Math.abs(lowResult.notes.length - low.length) <= 1 && lowResult.notes.every((n, i) => !low[i] || n.pitch === low[i].midi), lowResult.notes.map((n) => midiToLabel(n.pitch)).join(' '))

  // Con ruido de fondo fuerte pero señal clara
  const noisy = await transcribe(synthMelody(target, 100, [0.6, 0.25, 0.1], 0.05), SR)
  check('resiste el ruido de fondo', Math.abs(noisy.notes.length - target.length) <= 2, `${noisy.notes.length} notas`)

  // Silencio: no debe inventar nada
  const silent = await transcribe(new Float32Array(SR * 2), SR)
  check('el silencio no genera notas', silent.notes.length === 0)
  check('avisa cuando no hay señal', silent.warnings.length > 0, silent.warnings[0]?.slice(0, 60))

  // Muestreo a 48 kHz (típico de micrófonos)
  const at48 = synthMelody(target, 100)
  const resampled = new Float32Array(Math.round((at48.length / SR) * 48000))
  for (let i = 0; i < resampled.length; i++) {
    const pos = (i / 48000) * SR
    const idx = Math.floor(pos)
    resampled[i] = at48[idx] + (at48[idx + 1] - at48[idx]) * (pos - idx)
  }
  const highRate = await transcribe(resampled, 48000)
  check('funciona a 48 kHz', Math.abs(highRate.notes.length - target.length) <= 1 && Math.abs(highRate.bpm - 100) <= 3, `${highRate.notes.length} notas, ${highRate.bpm} BPM`)

  section('[8b] Casos difíciles')
  const hardCases: { name: string; notes: { midi: number; beats: number }[]; bpm: number; maxDiff: number }[] = [
    {
      name: 'corcheas rápidas a 120 BPM',
      bpm: 120,
      maxDiff: 0,
      notes: [60, 62, 64, 65, 67, 65, 64, 62, 60, 62, 64, 65, 67, 69, 71, 72].map((midi) => ({ midi, beats: 0.5 })),
    },
    { name: 'saltos de octava', bpm: 100, maxDiff: 0, notes: [72, 60, 74, 62, 76, 64, 77, 65].map((midi) => ({ midi, beats: 1 })) },
    { name: 'melodía cromática', bpm: 96, maxDiff: 0, notes: [60, 61, 62, 64, 65, 67, 66, 64, 63, 62, 60, 62, 64, 65, 67, 69].map((midi) => ({ midi, beats: 1 })) },
    { name: 'notas largas', bpm: 84, maxDiff: 0, notes: [55, 59, 62, 67].map((midi) => ({ midi, beats: 4 })) },
    { name: 'silbido agudo', bpm: 110, maxDiff: 0, notes: [79, 81, 83, 84, 83, 81, 79].map((midi) => ({ midi, beats: 1 })) },
  ]
  for (const testCase of hardCases) {
    const outcome = await transcribe(synthMelody(testCase.notes, testCase.bpm), SR)
    const expected = testCase.notes.map((n) => n.midi)
    const got = outcome.notes.map((n) => n.pitch)
    check(
      `recupera "${testCase.name}"`,
      Math.abs(got.length - expected.length) <= testCase.maxDiff && expected.every((midi, i) => got[i] === undefined || got[i] === midi),
      got.map((m) => midiToLabel(m)).join(' '),
    )
  }

  // Progreso notificado
  const progress: number[] = []
  await transcribe(synthMelody(target, 100), SR, {}, (f) => progress.push(f))
  check('informa del progreso del análisis', progress.length > 2 && progress[progress.length - 1] === 1, `${progress.length} avisos`)
}
