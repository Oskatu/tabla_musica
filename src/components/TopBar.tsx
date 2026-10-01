import { useEffect, useRef, useState } from 'react'
import { useStore, newProject, uid, emptyTrack } from '../state/store'
import { transport } from '../audio/playback'
import { applyMasterSettings, exportToWav, getContext, resumeContext } from '../audio/engine'
import { SCALES } from '../lib/theory'
import { ticksPerBar } from '../lib/durations'
import { toMusicXML, downloadText } from '../lib/musicxml'
import { formatPosition } from './useTransport'
import { useTransportTick } from './useTransport'
import {
  PROGRESSIONS,
  generateBass,
  generateChords,
  generateDrums,
  generateMelody,
} from '../lib/generate'
import type { Project, Track } from '../state/types'

export type TabId = 'compose' | 'mix' | 'score' | 'hum'

interface Props {
  tab: TabId
  onTab: (t: TabId) => void
  onShowHelp: () => void
  onShowGenerator: () => void
  showGenerator: boolean
}

export default function TopBar({ tab, onTab, onShowHelp, onShowGenerator, showGenerator }: Props): JSX.Element {
  const project = useStore((s) => s.project)
  const isPlaying = useStore((s) => s.isPlaying)
  const setPlaying = useStore((s) => s.setPlaying)
  const setPlayhead = useStore((s) => s.setPlayhead)
  const loop = useStore((s) => s.loop)
  const setLoop = useStore((s) => s.setLoop)
  const metronome = useStore((s) => s.metronome)
  const setMetronome = useStore((s) => s.setMetronome)
  const patchProject = useStore((s) => s.patchProject)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const history = useStore((s) => s.history)
  const future = useStore((s) => s.future)
  const createProject = useStore((s) => s.createProject)
  const openProject = useStore((s) => s.openProject)
  const saveProjectAs = useStore((s) => s.saveProjectAs)
  const deleteProject = useStore((s) => s.deleteProject)
  const exportProjectJson = useStore((s) => s.exportProjectJson)
  const importProjectJson = useStore((s) => s.importProjectJson)
  const toast = useStore((s) => s.toast)
  const projects = useStore((s) => s.projects)

  const { tick } = useTransportTick()
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialog, setDialog] = useState<null | 'projects' | 'saveas'>(null)
  const [nameDraft, setNameDraft] = useState(project.name)
  const [rendering, setRendering] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const barTicks = ticksPerBar(project.timeSignature)

  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [])

  useEffect(() => {
    setNameDraft(project.name)
  }, [project.name])

  // Mantiene la mezcla sincronizada con el motor mientras suena.
  useEffect(() => {
    if (transport.isPlaying) transport.update(project)
    applyMasterSettings(project.master)
  }, [project.master, project.tracks, project])

  const togglePlay = (): void => {
    if (transport.isPlaying) {
      transport.stop()
      setPlaying(false)
      return
    }
    void resumeContext().then(() => {
      if (getContext().state === 'suspended') {
        toast('El navegador bloqueó el audio. Pulsa otra vez o revisa los permisos de sonido.', 'error')
      }
    })
    const st = useStore.getState()
    transport.setLoop(st.loop)
    transport.start(st.project, {
      startTick: st.playheadTick >= st.project.bars * barTicks ? 0 : st.playheadTick,
      metronome: st.metronome,
      onEnded: () => {
        useStore.getState().setPlaying(false)
        useStore.getState().setPlayhead(0)
      },
    })
    setPlaying(true)
  }

  const stop = (): void => {
    transport.stop()
    setPlaying(false)
    setPlayhead(0)
    transport.setCursor(0)
  }

  const handleBpm = (value: number): void => {
    const bpm = Math.max(30, Math.min(280, value))
    if (transport.isPlaying) {
      const at = transport.currentTick()
      transport.stop()
      setPlaying(false)
      patchProject({ bpm }, 'tempo', false)
      window.setTimeout(() => {
        const st = useStore.getState()
        transport.setLoop(st.loop)
        transport.start(st.project, { startTick: at, metronome: st.metronome, onEnded: () => useStore.getState().setPlaying(false) })
        setPlaying(true)
      }, 60)
    } else {
      patchProject({ bpm }, 'tempo', false)
    }
  }

  const loadDemo = (): void => {
    const base: Project = { ...newProject('Canción de ejemplo'), bpm: 104, bars: 16, keyRoot: 0, keyScale: 'major' }
    const prog = PROGRESSIONS[0]
    const seed = Math.floor(Math.random() * 10000)
    const chords = emptyTrack('piano', 'Piano')
    chords.notes = generateChords({
      key: { root: 0, scale: 'major' },
      bars: base.bars,
      timeSignature: base.timeSignature,
      progression: prog,
      style: 'arpeggio',
      octave: 4,
      extension: 1,
      voiceLeading: true,
      velocity: 0.72,
      seed,
    }).notes.map((n) => ({ ...n, id: uid() }))
    const bass = emptyTrack('bass', 'Bajo')
    bass.notes = generateBass({
      key: { root: 0, scale: 'major' },
      bars: base.bars,
      timeSignature: base.timeSignature,
      progression: prog,
      style: 'roots',
      octave: 2,
      velocity: 0.9,
      seed: seed + 1,
    }).notes.map((n) => ({ ...n, id: uid() }))
    const drums = emptyTrack('drums', 'Batería')
    drums.notes = generateDrums({
      bars: base.bars,
      timeSignature: base.timeSignature,
      style: 'rock',
      seed: seed + 2,
      variation: 0.3,
      crashes: true,
    }).notes.map((n) => ({ ...n, id: uid() }))
    const melody = emptyTrack('synth', 'Melodía', 0)
    melody.notes = generateMelody({
      key: { root: 0, scale: 'major' },
      bars: base.bars,
      timeSignature: base.timeSignature,
      progression: prog,
      octave: 5,
      seed: seed + 3,
      density: 0.55,
      leapiness: 1,
      style: 'cantable',
    }).notes.map((n) => ({ ...n, id: uid() }))
    const pads = emptyTrack('pad', 'Pad')
    pads.notes = generateChords({
      key: { root: 0, scale: 'major' },
      bars: base.bars,
      timeSignature: base.timeSignature,
      progression: prog,
      style: 'whole',
      octave: 3,
      extension: 2,
      voiceLeading: true,
      velocity: 0.5,
      seed: seed + 4,
    }).notes.map((n) => ({ ...n, id: uid() }))
    const tracks: Track[] = [chords, bass, drums, melody, pads]
    const demo: Project = { ...base, tracks, master: { volume: 0.8, reverb: 0.28, delay: 0.14, delayFeedback: 0.3, compression: 0.4 } }
    useStore.getState().setProject(demo, { pushHistory: true, label: 'ejemplo' })
    useStore.getState().selectTrack(chords.id)
    setMenuOpen(false)
    toast('Canción de ejemplo cargada: I–V–vi–IV en Do mayor', 'success')
  }

  const doExportWav = async (withMetronome: boolean): Promise<void> => {
    setMenuOpen(false)
    setRendering(true)
    try {
      toast('Renderizando el audio…', 'info')
      await exportToWav(useStore.getState().project, withMetronome)
      toast('WAV descargado', 'success')
    } catch (err) {
      toast(`No se pudo exportar el audio: ${(err as Error).message}`, 'error')
    } finally {
      setRendering(false)
    }
  }

  const doExportMusicXML = (): void => {
    setMenuOpen(false)
    try {
      const xml = toMusicXML(useStore.getState().project)
      downloadText(xml, `${project.name.replace(/[^\w\-]+/g, '_') || 'partitura'}.musicxml`)
      toast('MusicXML descargado', 'success')
    } catch (err) {
      toast(`Error al exportar: ${(err as Error).message}`, 'error')
    }
  }

  const importJson = (file: File): void => {
    const reader = new FileReader()
    reader.onload = () => importProjectJson(String(reader.result))
    reader.readAsText(file)
  }

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          Tabla Música
        </div>

        <div className="group tight">
          <button className="ghost icon" title="Deshacer (Ctrl+Z)" onClick={undo} disabled={history.length === 0}>
            ↺
          </button>
          <button className="ghost icon" title="Rehacer (Ctrl+Y)" onClick={redo} disabled={future.length === 0}>
            ↻
          </button>
        </div>

        <div className="group">
          <button className={`play-btn ${isPlaying ? 'stop' : ''}`} onClick={togglePlay} title="Reproducir / pausar (Espacio)">
            {isPlaying ? '❚❚' : '▶'}
          </button>
          <button className="ghost icon" onClick={stop} title="Detener y volver al inicio">
            ■
          </button>
          <button
            className={`ghost icon ${loop.enabled ? 'active' : ''}`}
            onClick={() => {
              const next = { ...loop, enabled: !loop.enabled }
              setLoop(next)
              transport.setLoop(next)
            }}
            title="Bucle (arrastra en la regla con Mayús para definir el rango)"
          >
            🔁
          </button>
          <button
            className={`ghost icon ${metronome ? 'active' : ''}`}
            onClick={() => setMetronome(!metronome)}
            title="Metrónomo"
          >
            🥁
          </button>
          <div className="time-display" title="compás:tiempo:centésimas">
            {formatPosition(tick, project.timeSignature)}
          </div>
        </div>

        <div className="group">
          <label>Tempo</label>
          <input
            type="number"
            min={30}
            max={280}
            value={project.bpm}
            onChange={(e) => handleBpm(Number(e.target.value))}
            style={{ width: 66 }}
          />
          <label>Compás</label>
          <select
            value={`${project.timeSignature[0]}/${project.timeSignature[1]}`}
            onChange={(e) => {
              const [n, d] = e.target.value.split('/').map(Number)
              patchProject({ timeSignature: [n, d] }, 'compás')
            }}
          >
            {['4/4', '3/4', '2/4', '6/8', '5/4', '7/8', '12/8'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <label>Tonalidad</label>
          <select
            value={`${project.keyRoot}|${project.keyScale}`}
            onChange={(e) => {
              const [root, scale] = e.target.value.split('|')
              patchProject({ keyRoot: Number(root), keyScale: scale as typeof project.keyScale }, 'tonalidad')
            }}
          >
            {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].flatMap((n, i) =>
              Object.entries(SCALES).map(([id, s]) => (
                <option key={`${i}${id}`} value={`${i}|${id}`}>
                  {n} {s.label}
                </option>
              )),
            )}
          </select>
        </div>

        <div className="tabs">
          <button className={tab === 'compose' ? 'active' : ''} onClick={() => onTab('compose')}>
            🎹 Componer
          </button>
          <button className={tab === 'mix' ? 'active' : ''} onClick={() => onTab('mix')}>
            🎚️ Mezclar
          </button>
          <button className={tab === 'score' ? 'active' : ''} onClick={() => onTab('score')}>
            🎼 Partitura
          </button>
          <button className={tab === 'hum' ? 'active' : ''} onClick={() => onTab('hum')}>
            🎤 Tarareo
          </button>
        </div>

        <div className="spacer" />

        {tab === 'compose' ? (
          <button className={showGenerator ? 'active' : ''} onClick={onShowGenerator} title="Generador de progresiones, bajo, batería y melodía">
            ✨ Generador
          </button>
        ) : null}

        <input
          type="text"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => patchProject({ name: nameDraft || 'Sin título' }, 'nombre', false)}
          style={{ width: 150 }}
          title="Nombre de la canción"
        />

        <div className="menu" ref={menuRef}>
          <button onClick={() => setMenuOpen((v) => !v)} title="Menú de proyecto">
            ☰ Proyecto
          </button>
          {menuOpen ? (
            <div className="menu-panel">
              <button onClick={() => { createProject('Nueva canción'); setMenuOpen(false) }}>🆕 Canción vacía</button>
              <button onClick={() => { setMenuOpen(false); setDialog('projects') }}>📂 Mis canciones ({projects.length})</button>
              <button onClick={() => { setMenuOpen(false); setDialog('saveas') }}>💾 Guardar como…</button>
              <div style={{ padding: '4px 2px' }}>
                <input
                  type="number"
                  min={1}
                  max={128}
                  value={project.bars}
                  onChange={(e) => patchProject({ bars: Math.max(1, Math.min(128, Number(e.target.value) || 8)) }, 'compases', false)}
                  style={{ width: '100%' }}
                  title="Número de compases"
                />
              </div>
              <hr />
              <button onClick={loadDemo}>🎁 Cargar canción de ejemplo</button>
              <hr />
              <button onClick={() => void doExportWav(false)} disabled={rendering}>
                {rendering ? '⏳ Renderizando…' : '🎧 Exportar audio WAV'}
              </button>
              <button onClick={() => void doExportWav(true)} disabled={rendering}>
                🎧 Exportar WAV con metrónomo
              </button>
              <button onClick={doExportMusicXML}>🎼 Exportar MusicXML</button>
              <hr />
              <button onClick={() => { setMenuOpen(false); exportProjectJson() }}>⬇ Guardar archivo .tabla.json</button>
              <label className="menu-item" style={{ display: 'block', padding: '8px 10px', cursor: 'pointer', color: 'var(--text-dim)' }}>
                ⬆ Abrir archivo .tabla.json
                <input
                  type="file"
                  accept=".json,application/json"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) importJson(f)
                    e.target.value = ''
                    setMenuOpen(false)
                  }}
                />
              </label>
              <hr />
              <button onClick={() => { setMenuOpen(false); onShowHelp() }}>❔ Ayuda y atajos</button>
            </div>
          ) : null}
        </div>
      </header>

      {dialog === 'saveas' ? (
        <div className="modal-backdrop" onClick={() => setDialog(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2>Guardar como</h2>
            <p className="sub">Crea una copia de la canción con otro nombre. Se guarda en este navegador.</p>
            <div className="field">
              <label>Nombre</label>
              <input type="text" value={nameDraft} autoFocus onChange={(e) => setNameDraft(e.target.value)} />
            </div>
            <div className="modal-actions">
              <button onClick={() => setDialog(null)}>Cancelar</button>
              <button
                className="primary"
                onClick={() => {
                  saveProjectAs(nameDraft || 'Copia')
                  setDialog(null)
                }}
              >
                Guardar copia
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {dialog === 'projects' ? (
        <div className="modal-backdrop" onClick={() => setDialog(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Mis canciones</h2>
            <p className="sub">Se guardan automáticamente en el almacenamiento local del navegador.</p>
            <div className="proj-list">
              {projects.map((p) => (
                <div key={p.id} className={`proj-item ${p.id === project.id ? 'current' : ''}`}>
                  <span style={{ flex: 1 }}>{p.name}</span>
                  <span className="pill">{p.tracks} pistas</span>
                  <span className="pill">{new Date(p.updatedAt).toLocaleDateString('es')}</span>
                  <button
                    className="chip"
                    onClick={() => {
                      openProject(p.id)
                      setDialog(null)
                    }}
                  >
                    Abrir
                  </button>
                  <button
                    className="chip"
                    onClick={() => {
                      if (confirm(`¿Borrar "${p.name}"?`)) deleteProject(p.id)
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button
                onClick={() => {
                  createProject('Nueva canción')
                  setDialog(null)
                }}
              >
                🆕 Nueva
              </button>
              <button className="primary" onClick={() => setDialog(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
