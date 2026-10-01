import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { INSTRUMENT_MAP } from '../audio/instruments'
import { midiToSolfege } from '../lib/theory'
import { previewNote, resumeContext } from '../audio/engine'
import { transport } from '../audio/playback'
import { PPQ } from '../lib/theory'

/** Distribución tipo DAW: fila de letras = teclas blancas, fila de números = negras. */
const KEY_MAP: Record<string, number> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
  ';': 16,
  "'": 17,
  ']': 18,
}

const OCTAVES = 2
const WHITE_IN_OCTAVE = [0, 2, 4, 5, 7, 9, 11]

export default function Keyboard(): JSX.Element {
  const project = useStore((s) => s.project)
  const selectedTrackId = useStore((s) => s.selectedTrackId)
  const addNote = useStore((s) => s.addNote)
  const patchProject = useStore((s) => s.patchProject)
  const track = project.tracks.find((t) => t.id === selectedTrackId) ?? project.tracks[0]
  const [octave, setOctave] = useState(track ? INSTRUMENT_MAP[track.instrument].defaultOctave : 4)
  const [pressed, setPressed] = useState<number[]>([])
  const [writeMode, setWriteMode] = useState(false)
  const [open, setOpen] = useState(true)

  const isDrums = track?.instrument === 'drums'
  const baseMidi = isDrums ? 36 : (octave + 1) * 12

  const play = useCallback(
    (midi: number) => {
      if (!track) return
      resumeContext()
      previewNote(track.instrument, midi + track.transpose, 0.8, 0.85)
      setPressed((p) => (p.includes(midi) ? p : [...p, midi]))
      window.setTimeout(() => setPressed((p) => p.filter((x) => x !== midi)), 260)

      // Modo "escribir": cada nota tocada se añade a la pista en el cursor.
      if (writeMode) {
        const state = useStore.getState()
        const tick = quantize(transport.currentTick(), state.snapTicks || PPQ / 2)
        addNote(track.id, { tick, duration: state.drawDuration, pitch: midi, velocity: 0.85 })
      }
    },
    [addNote, track, writeMode],
  )

  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        setOctave((o) => Math.max(0, o - 1))
        return
      }
      if (key === 'x') {
        setOctave((o) => Math.min(7, o + 1))
        return
      }
      const offset = KEY_MAP[key]
      if (offset === undefined) return
      e.preventDefault()
      const midi = baseMidi + offset
      if (!e.repeat) play(midi)
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [baseMidi, play])

  if (!track) return <div />

  const whiteKeys: number[] = []
  const blackKeys: number[] = []
  for (let o = 0; o < OCTAVES; o++) {
    for (const semi of WHITE_IN_OCTAVE) whiteKeys.push(baseMidi + o * 12 + semi)
    for (const semi of [1, 3, 6, 8, 10]) blackKeys.push(baseMidi + o * 12 + semi)
  }
  const whiteCount = whiteKeys.length
  const whiteW = 100 / whiteCount

  const whiteIndex = (midi: number): number => whiteKeys.indexOf(midi)

  return (
    <div className="keyboard-wrap">
      <div className="keyboard-head">
        <button className="ghost icon" onClick={() => setOpen((v) => !v)} title={open ? 'Ocultar teclado' : 'Mostrar teclado'}>
          {open ? '▾' : '▸'}
        </button>
        <strong style={{ color: 'var(--text-dim)' }}>Teclado para tocar</strong>
        <span className="pill">{INSTRUMENT_MAP[track.instrument].icon} {track.name}</span>
        <button className="ghost" onClick={() => setOctave((o) => Math.max(0, o - 1))} title="Bajar octava (Z)">
          ◀ octava
        </button>
        <span className="pill">C{octave}{isDrums ? ' (batería)' : ''}</span>
        <button className="ghost" onClick={() => setOctave((o) => Math.min(7, o + 1))} title="Subir octava (X)">
          octava ▶
        </button>
        <label className="switch">
          <input type="checkbox" checked={writeMode} onChange={(e) => setWriteMode(e.target.checked)} />
          Escribir en la pista
        </label>
        <span className="legend">Teclas A S D F G H J K / W E T Y U · Z y X cambian de octava</span>
        <div className="spacer" />
        <span className="legend">BPM</span>
        <input
          type="number"
          min={40}
          max={240}
          value={project.bpm}
          style={{ width: 68 }}
          onChange={(e) => patchProject({ bpm: Math.max(40, Math.min(240, Number(e.target.value) || 100)) }, 'bpm', false)}
        />
      </div>

      {open ? (
        <div className="keyboard">
          <div className="kb-keys">
            {whiteKeys.map((midi) => {
              const idx = whiteIndex(midi)
              const isPressed = pressed.includes(midi)
              const label = KEY_MAP_ENTRY[midi - baseMidi]
              return (
                <div
                  key={midi}
                  className={`kb-key white ${isPressed ? 'pressed' : ''}`}
                  style={{ left: `calc(${idx * whiteW}% + 1px)`, width: `calc(${whiteW}% - 2px)` }}
                  onPointerDown={() => play(midi)}
                  title={`${midiToSolfege(midi)}${label ? ` · tecla ${label.toUpperCase()}` : ''}`}
                >
                  <span className="kb-label">{label ? label.toUpperCase() : ''}</span>
                </div>
              )
            })}
            {blackKeys.map((midi) => {
              // Coloca la tecla negra entre las dos blancas que la rodean.
              const belowIdx = whiteIndex(midi - 1)
              const left = (belowIdx + 1) * whiteW
              const isPressed = pressed.includes(midi)
              const label = KEY_MAP_ENTRY[midi - baseMidi]
              return (
                <div
                  key={midi}
                  className={`kb-key black ${isPressed ? 'pressed' : ''}`}
                  style={{ left: `calc(${left}% - ${whiteW * 0.3}%)`, width: `${whiteW * 0.6}%` }}
                  onPointerDown={() => play(midi)}
                  title={`${midiToSolfege(midi)}${label ? ` · tecla ${label.toUpperCase()}` : ''}`}
                >
                  <span className="kb-label">{label ? label.toUpperCase() : ''}</span>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

const KEY_MAP_ENTRY: Record<number, string> = Object.entries(KEY_MAP).reduce(
  (acc, [k, v]) => {
    acc[v] = k
    return acc
  },
  {} as Record<number, string>,
)

function quantize(tick: number, grid: number): number {
  if (grid <= 0) return Math.max(0, Math.round(tick))
  return Math.max(0, Math.round(tick / grid) * grid)
}
