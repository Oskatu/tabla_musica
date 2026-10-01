/**
 * Pruebas de la interfaz: monta la aplicación en jsdom con las APIs de audio
 * simuladas y comprueba que cada vista funciona e interactúa.
 */

import React from 'react'
import { check, quietConsole, section } from './harness'

export async function run(): Promise<void> {
  const win = globalThis as unknown as typeof globalThis & { document: Document }
  const { createRoot } = await import('react-dom/client')
  const { useStore, emptyTrack, uid } = await import('../src/state/store')
  const gen = await import('../src/lib/generate')
  const App = (await import('../src/App')).default

  quietConsole()

  section('[11] Aplicación: composición, mezcla, partitura y tarareo')

  // Contenido real antes de montar, para que todas las vistas se pinten.
  const base = useStore.getState().project
  const progression = gen.PROGRESSIONS[0]
  const key = { root: 0, scale: 'major' as const }
  const ts: [number, number] = [4, 4]
  const piano = emptyTrack('piano', 'Piano')
  piano.notes = gen.generateChords({ key, bars: 4, timeSignature: ts, progression, style: 'arpeggio', octave: 4, extension: 1, voiceLeading: true, velocity: 0.8, seed: 3 }).notes.map((n) => ({ ...n, id: uid() }))
  const bass = emptyTrack('bass', 'Bajo')
  bass.notes = gen.generateBass({ key, bars: 4, timeSignature: ts, progression, style: 'roots', octave: 2, velocity: 0.9, seed: 4 }).notes.map((n) => ({ ...n, id: uid() }))
  const drums = emptyTrack('drums', 'Batería')
  drums.notes = gen.generateDrums({ bars: 4, timeSignature: ts, style: 'rock', seed: 5, variation: 0.3, crashes: true }).notes.map((n) => ({ ...n, id: uid() }))
  const melody = emptyTrack('synth', 'Melodía')
  melody.notes = gen.generateMelody({ key, bars: 4, timeSignature: ts, progression, octave: 5, seed: 6, density: 0.6, leapiness: 1, style: 'cantable' }).notes.map((n) => ({ ...n, id: uid() }))
  useStore.getState().setProject({ ...base, bars: 8, tracks: [piano, bass, drums, melody] })

  const container = win.document.getElementById('root') as unknown as HTMLElement
  const root = createRoot(container)
  root.render(React.createElement(App))
  const flush = (ms = 90): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
  await flush(250)

  const text = (): string => container.textContent ?? ''
  const clickText = (matcher: RegExp): boolean => {
    const target = Array.from(container.querySelectorAll('button, .chip')).find((el) => matcher.test(el.textContent ?? ''))
    if (!target) return false
    target.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    return true
  }

  check('la aplicación se monta', container.innerHTML.length > 4000, `${container.innerHTML.length} bytes`)
  check('la barra superior está completa', /Tabla Música/.test(text()) && /Componer/.test(text()) && /Mezclar/.test(text()) && /Partitura/.test(text()) && /Tarareo/.test(text()))
  check('el editor dibuja las notas de la pista', container.querySelectorAll('.note').length === piano.notes.length, `${container.querySelectorAll('.note').length} notas`)
  check('el teclado del editor tiene filas', container.querySelectorAll('.pkey').length >= 88)
  check('el generador musical es visible', /Generador musical/.test(text()))
  check('el teclado tocable está disponible', /Teclado para tocar/.test(text()))

  // Mezclador
  check('se cambia a Mezclar', clickText(/Mezclar/))
  await flush(150)
  check('el mezclador muestra faders y master', container.querySelectorAll('input[type=range].vertical').length >= 4 && /Master/.test(text()))

  // Partitura
  check('se cambia a Partitura', clickText(/Partitura/))
  await flush(400)
  check('la partitura se dibuja', container.querySelectorAll('.score-page svg').length > 0, `${container.querySelectorAll('.score-page svg').length} sistemas`)
  check('contiene glifos', container.querySelectorAll('.score-page path').length > 100, `${container.querySelectorAll('.score-page path').length} trazados`)

  // Tarareo
  check('se cambia a Tarareo', clickText(/Tarareo/))
  await flush(200)
  check('el panel de tarareo aparece', /Tarareo → Partitura/.test(text()) && /Grabar con el micrófono/.test(text()) && /Subir archivo/.test(text()))

  // Volver a componer e interactuar con la rejilla
  check('vuelve a Componer', clickText(/Componer/))
  await flush(150)
  const grid = container.querySelector('.roll-grid') as HTMLElement | null
  check('existe la rejilla del editor', !!grid)
  if (grid) {
    grid.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 900, right: 900, bottom: 900, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    const before = useStore.getState().project.tracks.find((t) => t.id === useStore.getState().selectedTrackId)?.notes.length ?? 0
    grid.dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, clientX: 150, clientY: 300, button: 0 }))
    await flush()
    const after = useStore.getState().project.tracks.find((t) => t.id === useStore.getState().selectedTrackId)?.notes.length ?? 0
    check('dibujar con el ratón añade una nota', after === before + 1, `${before} → ${after}`)
  }

  // Transporte
  const playButton = container.querySelector('.play-btn') as HTMLElement | null
  playButton?.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  await flush(150)
  check('el transporte arranca', useStore.getState().isPlaying)
  playButton?.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  await flush(120)
  check('el transporte se detiene', !useStore.getState().isPlaying)

  section('[12] Generador, deshacer y proyectos')
  const beforeTracks = useStore.getState().project.tracks.length
  check('genera una canción completa', clickText(/Generar canción completa/))
  await flush(200)
  const tracks = useStore.getState().project.tracks
  check('añade cuatro pistas', tracks.length === beforeTracks + 4, `${beforeTracks} → ${tracks.length}`)
  check('las pistas generadas tienen notas', tracks.slice(-4).every((t) => t.notes.length > 0), tracks.slice(-4).map((t) => t.notes.length).join('/'))
  useStore.getState().undo()
  await flush()
  check('deshacer revierte las pistas nuevas', useStore.getState().project.tracks.length === beforeTracks, `${useStore.getState().project.tracks.length}`)
  useStore.getState().redo()
  await flush()
  check('rehacer las recupera', useStore.getState().project.tracks.length === beforeTracks + 4)

  // Proyectos: guardar como y abrir
  const idBefore = useStore.getState().project.id
  const projectsBefore = useStore.getState().projects.length
  useStore.getState().saveProjectAs('Copia de prueba')
  await flush()
  check(
    'guardar como crea otro proyecto',
    useStore.getState().project.id !== idBefore && useStore.getState().projects.length === projectsBefore + 1,
    `proyecto "${useStore.getState().project.name}"`,
  )
  useStore.getState().openProject(idBefore)
  await flush()
  check('se puede volver al proyecto anterior', useStore.getState().project.id === idBefore)

  // Menú del proyecto
  check('abre el menú del proyecto', clickText(/☰ Proyecto/))
  await flush()
  check('el menú ofrece exportaciones', /Exportar audio WAV/.test(text()) && /MusicXML/.test(text()))

  root.unmount()
}
