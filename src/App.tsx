import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import TopBar, { type TabId } from './components/TopBar'
import TrackSidebar from './components/TrackSidebar'
import PianoRoll from './components/PianoRoll'
import Mixer from './components/Mixer'
import RecorderPanel from './components/RecorderPanel'
import GeneratorPanel from './components/GeneratorPanel'
import Keyboard from './components/Keyboard'
import { useStore } from './state/store'
import { transport } from './audio/playback'
import { PPQ } from './lib/theory'

// La partitura arrastra la librería de notación (VexFlow) con sus tipografías:
// se carga solo cuando el usuario abre esa pestaña.
const ScoreView = lazy(() => import('./components/ScoreView'))

export default function App(): JSX.Element {
  const project = useStore((s) => s.project)
  const selectedTrackId = useStore((s) => s.selectedTrackId)
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const drawDuration = useStore((s) => s.drawDuration)
  const setDrawDuration = useStore((s) => s.setDrawDuration)
  const snapTicks = useStore((s) => s.snapTicks)
  const setSnap = useStore((s) => s.setSnap)
  const zoom = useStore((s) => s.zoom)
  const setZoom = useStore((s) => s.setZoom)
  const selectedNoteIds = useStore((s) => s.selectedNoteIds)
  const removeNotes = useStore((s) => s.removeNotes)
  const setSelectedNotes = useStore((s) => s.setSelectedNotes)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const toasts = useStore((s) => s.toasts)
  const dismissToast = useStore((s) => s.dismissToast)

  const [tab, setTab] = useState<TabId>('compose')
  const [showGenerator, setShowGenerator] = useState(true)
  const [showHelp, setShowHelp] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const track = project.tracks.find((t) => t.id === selectedTrackId) ?? project.tracks[0]
  const isEmpty = project.tracks.every((t) => t.notes.length === 0)

  // Atajos de teclado globales.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      if (typing) return

      if (e.code === 'Space') {
        e.preventDefault()
        const el = document.querySelector<HTMLButtonElement>('.play-btn')
        el?.click()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        const st = useStore.getState()
        const tr = st.project.tracks.find((t) => t.id === st.selectedTrackId)
        if (tr) st.setSelectedNotes(tr.notes.map((n) => n.id))
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNoteIds.length) {
        e.preventDefault()
        const st = useStore.getState()
        const tr = st.project.tracks.find((t) => t.id === st.selectedTrackId)
        if (tr) removeNotes(tr.id, st.selectedNoteIds)
        return
      }
      if (e.key === '1') setTool('draw')
      if (e.key === '2') setTool('select')
      if (e.key === '3') setTool('erase')
      if (e.key === 'Escape') setSelectedNotes([])
      if (e.key.toLowerCase() === 'l' && !e.metaKey && !e.ctrlKey) {
        const st = useStore.getState()
        const next = { ...st.loop, enabled: !st.loop.enabled }
        st.setLoop(next)
        transport.setLoop(next)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [removeNotes, redo, selectedNoteIds, setSelectedNotes, setTool, undo])

  // Al cambiar de pista, detiene la reproducción para evitar confusión.
  useEffect(() => {
    return () => {
      transport.stop()
    }
  }, [])

  const durations: { ticks: number; label: string }[] = [
    { ticks: PPQ * 4, label: '𝅝' },
    { ticks: PPQ * 2, label: '𝅗𝅥' },
    { ticks: PPQ, label: '♩' },
    { ticks: PPQ / 2, label: '♪' },
    { ticks: PPQ / 4, label: '♬' },
  ]
  const snaps: { ticks: number; label: string }[] = [
    { ticks: PPQ, label: '1/4' },
    { ticks: PPQ / 2, label: '1/8' },
    { ticks: PPQ / 4, label: '1/16' },
    { ticks: PPQ / 8, label: '1/32' },
    { ticks: 0, label: 'libre' },
  ]

  return (
    <div className="app">
      <TopBar
        tab={tab}
        onTab={setTab}
        onShowHelp={() => setShowHelp(true)}
        onShowGenerator={() => setShowGenerator((v) => !v)}
        showGenerator={showGenerator}
      />

      <div className="app-body">
        {tab === 'compose' || tab === 'score' || tab === 'mix' ? <TrackSidebar /> : null}

        <main className="main">
          {tab === 'compose' ? (
            <div className="view">
              <div className="toolbar">
                <label>Herramienta</label>
                <div className="chip-row">
                  <button className={`chip ${tool === 'draw' ? 'active' : ''}`} onClick={() => setTool('draw')} title="Dibujar notas (1)">
                    ✏️ Dibujar
                  </button>
                  <button className={`chip ${tool === 'select' ? 'active' : ''}`} onClick={() => setTool('select')} title="Seleccionar (2)">
                    ⬚ Seleccionar
                  </button>
                  <button className={`chip ${tool === 'erase' ? 'active' : ''}`} onClick={() => setTool('erase')} title="Borrar (3)">
                    🧽 Borrar
                  </button>
                </div>
                <span className="sep" />
                <label>Duración</label>
                <div className="chip-row">
                  {durations.map((d) => (
                    <button
                      key={d.ticks}
                      className={`chip ${drawDuration === d.ticks ? 'active' : ''}`}
                      onClick={() => setDrawDuration(d.ticks)}
                      title={`${d.ticks / PPQ} negra(s)`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <span className="sep" />
                <label>Rejilla</label>
                <div className="chip-row">
                  {snaps.map((s) => (
                    <button key={s.label} className={`chip ${snapTicks === s.ticks ? 'active' : ''}`} onClick={() => setSnap(s.ticks)}>
                      {s.label}
                    </button>
                  ))}
                </div>
                <span className="sep" />
                <label>Zoom</label>
                <input
                  type="range"
                  min={28}
                  max={240}
                  step={4}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  style={{ width: 110 }}
                />
                <span className="sep" />
                <label>Compases</label>
                <input
                  type="number"
                  min={1}
                  max={128}
                  value={project.bars}
                  onChange={(e) => useStore.getState().patchProject({ bars: Math.max(1, Math.min(128, Number(e.target.value) || 8)) }, 'compases', false)}
                  style={{ width: 62 }}
                />
                <div className="spacer" />
                {selectedNoteIds.length ? (
                  <button
                    className="chip"
                    onClick={() => {
                      const st = useStore.getState()
                      const tr = st.project.tracks.find((t) => t.id === st.selectedTrackId)
                      if (tr) st.removeNotes(tr.id, st.selectedNoteIds)
                    }}
                  >
                    🗑️ Borrar selección ({selectedNoteIds.length})
                  </button>
                ) : null}
                <button
                  className="chip"
                  title="Borra todas las notas de la pista seleccionada"
                  onClick={() => {
                    if (!track) return
                    if (track.notes.length === 0) return
                    if (!confirm(`¿Vaciar todas las notas de "${track.name}"?`)) return
                    useStore.getState().setProject(
                      { ...project, tracks: project.tracks.map((t) => (t.id === track.id ? { ...t, notes: [] } : t)) },
                      { pushHistory: true, label: 'vaciar pista' },
                    )
                  }}
                >
                  🧹 Vaciar pista
                </button>
              </div>

              {isEmpty ? (
                <div className="hint-bar" style={{ borderTop: 'none', padding: '8px 12px', background: 'rgba(91,140,255,0.08)' }}>
                  <span>
                    👋 Empieza así: dibuja notas con el ratón, usa el <b>Generador</b> (arriba a la derecha) o pulsa ☰ Proyecto →{' '}
                    <b>Cargar canción de ejemplo</b>.
                  </span>
                </div>
              ) : null}

              <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
                <PianoRoll key={track?.id ?? 'none'} track={track ?? project.tracks[0]} scrollRef={scrollRef} />
                {showGenerator ? <GeneratorPanel /> : null}
              </div>

              <Keyboard />
            </div>
          ) : null}

          {tab === 'mix' ? <Mixer /> : null}
          {tab === 'score' ? (
            <Suspense
              fallback={
                <div className="empty-state">
                  Cargando el grabador de partituras…
                  <br />
                  <span className="legend">La primera vez tarda un poco: se descargan las tipografías musicales.</span>
                </div>
              }
            >
              <ScoreView />
            </Suspense>
          ) : null}
          {tab === 'hum' ? <RecorderPanel /> : null}
        </main>
      </div>

      {showHelp ? <HelpModal onClose={() => setShowHelp(false)} /> : null}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  )
}

function HelpModal({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Tabla Música · ayuda rápida</h2>
        <p className="sub">Un estudio de composición completo que funciona en tu navegador. Todo el audio se genera por síntesis: no hay samples ni servidores.</p>

        <div className="grid-2">
          <div className="card">
            <h3>🎹 Componer</h3>
            <div className="legend">
              <b>Componer</b> tiene un editor de piano roll: el eje vertical es la altura y el horizontal el tiempo. Haz clic
              para dibujar una nota, arrástrala para moverla y tira del borde derecho para alargarla. Con la herramienta{' '}
              <b>Seleccionar</b> puedes enmarcar varias notas y moverlas juntas. La pista de <b>batería</b> muestra una fila por
              pieza en lugar de un teclado.
              <br />
              <br />
              El <b>Generador</b> (arriba a la derecha) crea progresiones de acordes, líneas de bajo, patrones de batería y
              melodías según la tonalidad y el estilo.
            </div>
          </div>
          <div className="card">
            <h3>🎚️ Mezclar</h3>
            <div className="legend">
              Cada pista tiene fader de volumen, paneo y EQ de tres bandas. El canal <b>Master</b> añade reverberación, eco y
              compresión. Los cambios se escuchan al instante. Puedes silenciar (M) o aislar (S) pistas.
            </div>
          </div>
          <div className="card">
            <h3>🎼 Partitura</h3>
            <div className="legend">
              Las pistas se escriben en notación estándar, con figuras, silencios, ligaduras, armadura y compás. Puedes
              exportar <b>MusicXML</b> (para MuseScore, Finale, Sibelius…), <b>SVG</b>, <b>PNG</b> o imprimir.
              <br />
              <br />
              Las duraciones irregulares se aproximan a figuras estándar, por eso puedes ver ligaduras donde el original era
              una nota larga.
            </div>
          </div>
          <div className="card">
            <h3>🎤 Tarareo</h3>
            <div className="legend">
              Graba con el micrófono o sube un audio y la app detecta la altura de cada nota (autocorrelación), estima el
              tempo, propone una tonalidad y escribe la melodía en la partitura. Si el micrófono está bloqueado en el navegador,
              sube un archivo.
            </div>
          </div>
        </div>

        <h4>Atajos de teclado</h4>
        <div className="grid-3 legend">
          <div>
            <b>Espacio</b> reproducir / pausar
          </div>
          <div>
            <b>Ctrl + Z</b> deshacer · <b>Ctrl + Y</b> rehacer
          </div>
          <div>
            <b>1 / 2 / 3</b> herramienta
          </div>
          <div>
            <b>Ctrl + A</b> seleccionar todo
          </div>
          <div>
            <b>Supr</b> borrar selección
          </div>
          <div>
            <b>L</b> bucle on/off
          </div>
          <div>
            <b>A S D F G H J K</b> tocar notas
          </div>
          <div>
            <b>Z / X</b> cambiar de octava
          </div>
          <div>
            <b>Ctrl + rueda</b> zoom en el editor
          </div>
        </div>

        <h4>Guardado</h4>
        <div className="legend">
          Las canciones se guardan solas en el almacenamiento del navegador. Usa <b>Proyecto → Guardar archivo .tabla.json</b>{' '}
          para tener una copia de seguridad o compartirla.
        </div>

        <div className="modal-actions">
          <button className="primary" onClick={onClose}>
            Entendido
          </button>
        </div>
      </div>
    </div>
  )
}
