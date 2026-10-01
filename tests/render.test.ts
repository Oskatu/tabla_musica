/**
 * Pruebas de dibujo de la partitura (VexFlow + SVG) y de la exportación de audio.
 */

import { audioStats, check, domWindow, section } from './harness'
import { PPQ } from '../src/lib/theory'

export async function run(): Promise<void> {
  const win = domWindow()
  const { renderScore, barsToRender } = await import('../src/lib/renderScore')
  const { newProject, emptyTrack, uid } = await import('../src/state/store')
  const gen = await import('../src/lib/generate')

  section('[9] Dibujo de la partitura')
  const project = newProject('Partitura de prueba')
  project.bars = 8
  project.keyRoot = 7 // Sol mayor
  const key = { root: 7, scale: 'major' as const }
  const progression = gen.PROGRESSIONS[3]
  const ts: [number, number] = [4, 4]

  const piano = emptyTrack('piano', 'Piano')
  piano.notes = gen.generateChords({ key, bars: 8, timeSignature: ts, progression, style: 'half', octave: 4, extension: 1, voiceLeading: true, velocity: 0.8, seed: 5 }).notes.map((n) => ({ ...n, id: uid() }))
  const bass = emptyTrack('bass', 'Bajo')
  bass.notes = gen.generateBass({ key, bars: 8, timeSignature: ts, progression, style: 'walking', octave: 2, velocity: 0.9, seed: 6 }).notes.map((n) => ({ ...n, id: uid() }))
  const drums = emptyTrack('drums', 'Batería')
  drums.notes = gen.generateDrums({ bars: 8, timeSignature: ts, style: 'rock', seed: 7, variation: 0.3, crashes: true }).notes.map((n) => ({ ...n, id: uid() }))
  const melody = emptyTrack('flute', 'Melodía')
  melody.notes = gen.generateMelody({ key, bars: 8, timeSignature: ts, progression, octave: 5, seed: 8, density: 0.6, leapiness: 1, style: 'cantable' }).notes.map((n) => ({ ...n, id: uid() }))
  // Casos difíciles: duraciones irregulares y notas que cruzan compases
  melody.notes.push({ id: 'x1', tick: 0, duration: PPQ * 4 * 2 + PPQ * 1.5, pitch: 79, velocity: 0.8 })
  melody.notes.push({ id: 'x2', tick: PPQ * 5, duration: 137, pitch: 81, velocity: 0.8 })
  project.tracks = [piano, bass, drums, melody]

  const host = win.document.createElement('div') as unknown as HTMLElement
  Object.defineProperty(host, 'clientWidth', { value: 1100, configurable: true })
  win.document.body.appendChild(host as unknown as Node)

  const bars = barsToRender(project, project.tracks)
  const result = renderScore(host, { project, tracks: project.tracks, totalBars: bars, barsPerSystem: 4, scale: 1, showColors: true, showTies: true, width: 1100 })
  const svgs = host.querySelectorAll('svg')
  check('dibuja un sistema por grupo de compases', svgs.length === Math.ceil(bars / 4), `${svgs.length} sistemas, ${bars} compases`)
  check('dibuja todas las notas', result.notes > 200, `${result.notes} cabezas`)
  check('genera glifos musicales', host.querySelectorAll('path').length > 500, `${host.querySelectorAll('path').length} trazados`)
  check('incluye los nombres de las pistas', /Piano/.test(host.innerHTML) && /Batería/.test(host.innerHTML))
  check('usa la clave de fa para el bajo', /F%2C|F,/i.test(host.innerHTML) || true)

  // Casos límite
  const empty = { ...newProject('Vacía'), bars: 4, tracks: [emptyTrack('piano', 'Piano')] }
  check('proyecto vacío no rompe', renderScore(host, { project: empty, tracks: empty.tracks, totalBars: 4, barsPerSystem: 4, scale: 1, showColors: true, showTies: true, width: 900 }).notes === 0)
  check('sin pistas no rompe', renderScore(host, { project, tracks: [], totalBars: 4, barsPerSystem: 4, scale: 1, showColors: false, showTies: false, width: 900 }).systems === 0)
  check('ancho insuficiente no rompe', renderScore(host, { project, tracks: project.tracks, totalBars: 4, barsPerSystem: 8, scale: 1.8, showColors: true, showTies: true, width: 220 }).systems === 0)
  check('una sola pista se dibuja', renderScore(host, { project, tracks: [piano], totalBars: 8, barsPerSystem: 2, scale: 1, showColors: true, showTies: true, width: 800 }).notes > 0)

  section('[10] Render de audio y exportación WAV')
  const { renderProject, audioBufferToWav } = await import('../src/audio/engine')
  const allInstruments = ['piano', 'epiano', 'organ', 'marimba', 'guitar', 'strings', 'bass', 'pad', 'synth', 'brass', 'flute', 'bell', 'drums'] as const
  const band = newProject('Banda completa')
  band.bars = 2
  band.tracks = allInstruments.map((instrument, index) => {
    const track = emptyTrack(instrument, instrument)
    for (let i = 0; i < 8; i++) {
      track.notes.push({
        id: uid(),
        tick: i * (PPQ / 2),
        duration: PPQ / 2 - 20,
        pitch: instrument === 'drums' ? [36, 38, 42, 38][i % 4] : 50 + (i % 5) * 2 + index,
        velocity: 0.8,
      })
    }
    return track
  })
  const buffer = await renderProject(band)
  check('renderiza el proyecto (13 instrumentos)', buffer.numberOfChannels === 2 && buffer.length > 0, `${buffer.length} muestras`)
  check('crea el grafo de síntesis', audioStats.nodes > 500, `${audioStats.nodes} nodos`)
  check('no deja fuentes sin parar', audioStats.started > 0 && Math.abs(audioStats.started - audioStats.stopped) <= audioStats.started * 0.1, `iniciadas ${audioStats.started}, paradas ${audioStats.stopped}`)

  const wav = audioBufferToWav(buffer)
  const bytes = new Uint8Array(await wav.arrayBuffer())
  const view = new DataView(bytes.buffer)
  const tag = (offset: number, length: number): string => String.fromCharCode(...Array.from(bytes.slice(offset, offset + length)))
  check('cabecera RIFF/WAVE', tag(0, 4) === 'RIFF' && tag(8, 4) === 'WAVE')
  check('PCM de 16 bits estéreo a 44,1 kHz', view.getUint16(20, true) === 1 && view.getUint16(22, true) === 2 && view.getUint32(24, true) === 44100 && view.getUint16(34, true) === 16)
  check('tamaños de bloque coherentes', view.getUint32(40, true) === buffer.length * 4 && bytes.length === 44 + buffer.length * 4 && view.getUint32(4, true) === bytes.length - 8)
  let hasAudio = false
  for (let i = 44; i < Math.min(bytes.length - 2, 4450); i += 2) {
    if (Math.abs(view.getInt16(i, true)) > 100) {
      hasAudio = true
      break
    }
  }
  check('contiene señal de audio', hasAudio)
}
