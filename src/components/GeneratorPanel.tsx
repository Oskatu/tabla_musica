import { useMemo, useState } from 'react'
import { useStore, emptyTrack, uid } from '../state/store'
import { SCALES, chordQuality, diatonicChords, diatonicStack, type Key } from '../lib/theory'
import { ticksPerBar } from '../lib/durations'
import {
  BASS_STYLES,
  CHORD_STYLES,
  DRUM_STYLES,
  PROGRESSIONS,
  generateBass,
  generateChords,
  generateDrums,
  generateMelody,
  type BassStyle,
  type ChordStyle,
  type DrumStyle,
} from '../lib/generate'
import type { Track } from '../state/types'
import { INSTRUMENT_MAP } from '../audio/instruments'

type RhythmMode = 'chords' | 'bass' | 'drums' | 'melody'

export default function GeneratorPanel(): JSX.Element {
  const project = useStore((s) => s.project)
  const selectedTrackId = useStore((s) => s.selectedTrackId)
  const setProject = useStore((s) => s.setProject)
  const setPlayhead = useStore((s) => s.setPlayhead)
  const toast = useStore((s) => s.toast)
  const patchProject = useStore((s) => s.patchProject)

  const [progressionId, setProgressionId] = useState(PROGRESSIONS[0].id)
  const [chordStyle, setChordStyle] = useState<ChordStyle>('whole')
  const [chordOctave, setChordOctave] = useState(4)
  const [extension, setExtension] = useState<0 | 1 | 2>(0)
  const [voiceLeading, setVoiceLeading] = useState(true)
  const [bassStyle, setBassStyle] = useState<BassStyle>('roots')
  const [bassOctave, setBassOctave] = useState(2)
  const [drumStyle, setDrumStyle] = useState<DrumStyle>('rock')
  const [variation, setVariation] = useState(0.25)
  const [crashes, setCrashes] = useState(true)
  const [melodyStyle, setMelodyStyle] = useState<'cantable' | 'balada' | 'dance' | 'clasica' | 'ambient'>('cantable')
  const [density, setDensity] = useState(0.6)
  const [leapiness, setLeapiness] = useState(1)
  const [melodyOctave, setMelodyOctave] = useState(5)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6))
  const [mode, setMode] = useState<'replace' | 'append'>('replace')

  const key: Key = { root: project.keyRoot, scale: project.keyScale }
  const progression = PROGRESSIONS.find((p) => p.id === progressionId) ?? PROGRESSIONS[0]
  const selectedTrack = project.tracks.find((t) => t.id === selectedTrackId) ?? project.tracks[0]
  const diatonic = useMemo(() => diatonicChords(key, 4), [key.root, key.scale])
  const barTicks = ticksPerBar(project.timeSignature)

  const writeNotes = (trackId: string, notes: { tick: number; duration: number; pitch: number; velocity: number }[], label: string): void => {
    if (!notes.length) return
    setProject(
      {
        ...project,
        tracks: project.tracks.map((t) =>
          t.id === trackId
            ? { ...t, notes: mode === 'replace' ? notes.map((n) => ({ ...n, id: uid() })) : [...t.notes, ...notes.map((n) => ({ ...n, id: uid() }))] }
            : t,
        ),
        updatedAt: Date.now(),
      },
      { pushHistory: true, label },
    )
  }

  /** Genera una parte y la escribe en la pista seleccionada. */
  const apply = (kind: RhythmMode, label: string, pushHistoryLabel: string): void => {
    if (!selectedTrack) {
      toast('No hay ninguna pista seleccionada', 'error')
      return
    }
    let notes: { tick: number; duration: number; pitch: number; velocity: number }[] = []
    if (kind === 'chords') {
      notes = generateChords({
        key,
        bars: project.bars,
        timeSignature: project.timeSignature,
        progression,
        style: chordStyle,
        octave: chordOctave,
        extension,
        voiceLeading,
        velocity: 0.8,
        seed,
      }).notes
    } else if (kind === 'bass') {
      notes = generateBass({
        key,
        bars: project.bars,
        timeSignature: project.timeSignature,
        progression,
        style: bassStyle,
        octave: bassOctave,
        velocity: 0.9,
        seed,
      }).notes
    } else if (kind === 'drums') {
      notes = generateDrums({ bars: project.bars, timeSignature: project.timeSignature, style: drumStyle, seed, variation, crashes }).notes
    } else {
      notes = generateMelody({
        key,
        bars: project.bars,
        timeSignature: project.timeSignature,
        progression,
        octave: melodyOctave,
        seed,
        density,
        leapiness,
        style: melodyStyle,
      }).notes
    }
    writeNotes(selectedTrack.id, notes, pushHistoryLabel)
    toast(`${label}: ${notes.length} notas en "${selectedTrack.name}"`, 'success')
  }

  /** Crea una canción completa: armonía, bajo, batería y melodía. */
  const generateFullSong = (): void => {
    const chordsTrack = makeTrack('piano', 'Armonía')
    const bass = makeTrack('bass', 'Bajo')
    const drums = makeTrack('drums', 'Batería')
    const melody = makeTrack('synth', 'Melodía')

    const chordNotes = generateChords({
      key,
      bars: project.bars,
      timeSignature: project.timeSignature,
      progression,
      style: chordStyle === 'syncopated' ? 'block' : chordStyle,
      octave: chordOctave,
      extension,
      voiceLeading,
      velocity: 0.75,
      seed,
    }).notes
    const bassNotes = generateBass({
      key,
      bars: project.bars,
      timeSignature: project.timeSignature,
      progression,
      style: bassStyle,
      octave: bassOctave,
      velocity: 0.9,
      seed: seed + 1,
    }).notes
    const drumNotes = generateDrums({ bars: project.bars, timeSignature: project.timeSignature, style: drumStyle, seed: seed + 2, variation, crashes }).notes
    const melodyNotes = generateMelody({
      key,
      bars: project.bars,
      timeSignature: project.timeSignature,
      progression,
      octave: melodyOctave,
      seed: seed + 3,
      density,
      leapiness,
      style: melodyStyle,
    }).notes

    chordsTrack.notes = chordNotes.map((n) => ({ ...n, id: uid() }))
    bass.notes = bassNotes.map((n) => ({ ...n, id: uid() }))
    drums.notes = drumNotes.map((n) => ({ ...n, id: uid() }))
    melody.notes = melodyNotes.map((n) => ({ ...n, id: uid() }))

    setProject(
      { ...project, tracks: [...project.tracks, chordsTrack, bass, drums, melody], updatedAt: Date.now() },
      { pushHistory: true, label: 'canción generada' },
    )
    toast(`Canción generada: ${progression.label} en ${SCALES[project.keyScale].label.toLowerCase()} de ${['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][project.keyRoot]}`, 'success')
  }

  /** Inserta un acorde concreto en el cursor, en la pista seleccionada. */
  const insertChord = (degree: number): void => {
    if (!selectedTrack) return
    const chord = diatonic[(degree - 1) % diatonic.length]
    const notes: { tick: number; duration: number; pitch: number; velocity: number }[] = []
    diatonicStack(key, degree - 1, 3, 3).forEach((pitch) => {
      notes.push({
        tick: Math.round(useStore.getState().playheadTick / (barTicks / 4)) * (barTicks / 4),
        duration: barTicks,
        pitch,
        velocity: 0.8,
      })
    })
    writeNotes(selectedTrack.id, notes, 'acorde insertado')
    toast(`Acorde ${chord.label} insertado`, 'success')
  }

  return (
    <aside className="generator-panel">
      <h3>Generador musical</h3>

      <div className="gen-block">
        <div className="row">
          <label style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Progresión</label>
        </div>
        <select value={progressionId} onChange={(e) => setProgressionId(e.target.value)}>
          {PROGRESSIONS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} — {p.mood}
            </option>
          ))}
        </select>
        <div className="row">
          <label style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Tonalidad</label>
        </div>
        <div className="row">
          <select value={project.keyRoot} onChange={(e) => patchProject({ keyRoot: Number(e.target.value) }, 'tonalidad', false)}>
            {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map((n, i) => (
              <option key={n} value={i}>
                {n}
              </option>
            ))}
          </select>
          <select value={project.keyScale} onChange={(e) => patchProject({ keyScale: e.target.value as Key['scale'] }, 'escala', false)}>
            {Object.entries(SCALES).map(([id, s]) => (
              <option key={id} value={id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <label style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Compases</label>
        </div>
        <div className="row">
          <input
            type="number"
            min={1}
            max={128}
            value={project.bars}
            onChange={(e) => patchProject({ bars: Math.max(1, Math.min(128, Number(e.target.value) || 8)) }, 'compases', false)}
          />
          <button className="chip" onClick={() => setSeed(Math.floor(Math.random() * 1e6))} title="Nueva variación aleatoria">
            🎲 Variación
          </button>
        </div>
        <div className="row">
          <select value={mode} onChange={(e) => setMode(e.target.value as 'replace' | 'append')}>
            <option value="replace">Reemplazar notas de la pista</option>
            <option value="append">Añadir al final</option>
          </select>
        </div>
        <button className="primary" onClick={generateFullSong}>
          ✨ Generar canción completa (4 pistas)
        </button>
        <div className="legend">Añade pistas nuevas de armonía, bajo, batería y melodía con esta progresión.</div>
      </div>

      {/* Acordes */}
      <div className="gen-block">
        <strong style={{ fontSize: 12.5 }}>🎹 Acompañamiento</strong>
        <select value={chordStyle} onChange={(e) => setChordStyle(e.target.value as ChordStyle)}>
          {CHORD_STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <div className="row">
          <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>Octava {chordOctave}</label>
          <input type="range" min={2} max={6} value={chordOctave} onChange={(e) => setChordOctave(Number(e.target.value))} />
        </div>
        <div className="row">
          <select value={extension} onChange={(e) => setExtension(Number(e.target.value) as 0 | 1 | 2)}>
            <option value={0}>Tríadas</option>
            <option value={1}>Con séptimas</option>
            <option value={2}>Con novenas</option>
          </select>
        </div>
        <label className="switch">
          <input type="checkbox" checked={voiceLeading} onChange={(e) => setVoiceLeading(e.target.checked)} />
          Enlazar acordes suavemente
        </label>
        <button onClick={() => apply('chords', 'Acompañamiento', 'generar acordes')}>Aplicar a la pista seleccionada</button>
        <div className="legend">
          Acordes de la tonalidad — haz clic para insertarlos en el cursor:
        </div>
        <div className="chord-preview">
          {diatonic.map((c) => (
            <button key={c.degree} className="chord-btn" onClick={() => insertChord(c.degree)} title={`${c.roman} · ${chordQuality(c.quality).label}`}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bajo */}
      <div className="gen-block">
        <strong style={{ fontSize: 12.5 }}>🎸 Bajo</strong>
        <select value={bassStyle} onChange={(e) => setBassStyle(e.target.value as BassStyle)}>
          {BASS_STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <div className="row">
          <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>Octava {bassOctave}</label>
          <input type="range" min={1} max={3} value={bassOctave} onChange={(e) => setBassOctave(Number(e.target.value))} />
        </div>
        <div className="legend">La octava 2 (Do2–Si2) es el registro habitual del bajo eléctrico.</div>
        <button onClick={() => apply('bass', 'Bajo', 'generar bajo')}>Aplicar a la pista seleccionada</button>
      </div>

      {/* Batería */}
      <div className="gen-block">
        <strong style={{ fontSize: 12.5 }}>🥁 Batería</strong>
        <select value={drumStyle} onChange={(e) => setDrumStyle(e.target.value as DrumStyle)}>
          {DRUM_STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} — {s.description}
            </option>
          ))}
        </select>
        <div className="row">
          <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>Variación {Math.round(variation * 100)}%</label>
          <input type="range" min={0} max={1} step={0.05} value={variation} onChange={(e) => setVariation(Number(e.target.value))} />
        </div>
        <label className="switch">
          <input type="checkbox" checked={crashes} onChange={(e) => setCrashes(e.target.checked)} />
          Platillos al empezar cada 4 compases
        </label>
        <button onClick={() => apply('drums', 'Batería', 'generar batería')}>Aplicar a la pista seleccionada</button>
      </div>

      {/* Melodía */}
      <div className="gen-block">
        <strong style={{ fontSize: 12.5 }}>🎵 Melodía</strong>
        <select value={melodyStyle} onChange={(e) => setMelodyStyle(e.target.value as typeof melodyStyle)}>
          <option value="cantable">Cantable</option>
          <option value="balada">Balada</option>
          <option value="dance">Dance</option>
          <option value="clasica">Clásica</option>
          <option value="ambient">Ambient</option>
        </select>
        <div className="row">
          <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>Densidad {Math.round(density * 100)}%</label>
          <input type="range" min={0.1} max={1} step={0.05} value={density} onChange={(e) => setDensity(Number(e.target.value))} />
        </div>
        <div className="row">
          <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>Saltos {leapiness}</label>
          <input type="range" min={0} max={3} step={1} value={leapiness} onChange={(e) => setLeapiness(Number(e.target.value))} />
        </div>
        <div className="row">
          <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>Octava {melodyOctave}</label>
          <input type="range" min={3} max={6} value={melodyOctave} onChange={(e) => setMelodyOctave(Number(e.target.value))} />
        </div>
        <button onClick={() => apply('melody', 'Melodía', 'generar melodía')}>Aplicar a la pista seleccionada</button>
      </div>

      <div className="gen-block">
        <strong style={{ fontSize: 12.5 }}>🎼 Cursor</strong>
        <div className="legend">
          El cursor está en el tick {Math.round(useStore.getState().playheadTick)}. Los acordes del bloque de acompañamiento se
          insertan ahí.
        </div>
        <button onClick={() => setPlayhead(0)}>⏮ Ir al inicio</button>
      </div>

      <div className="legend">
        Pista seleccionada: <b>{selectedTrack?.name ?? '—'}</b> ({selectedTrack ? INSTRUMENT_MAP[selectedTrack.instrument].label : '—'})
      </div>
    </aside>
  )
}

function makeTrack(instrument: Track['instrument'], name: string, transpose = 0): Track {
  return emptyTrack(instrument, name, transpose)
}
