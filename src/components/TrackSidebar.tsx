import { useState } from 'react'
import { useStore } from '../state/store'
import { INSTRUMENTS, INSTRUMENT_MAP, type InstrumentId } from '../audio/instruments'
import { ticksPerBar } from '../lib/durations'

const GROUPS = ['Teclados', 'Cuerdas', 'Bajos', 'Sintetizadores', 'Vientos', 'Percusión'] as const

export default function TrackSidebar(): JSX.Element {
  const project = useStore((s) => s.project)
  const selectedTrackId = useStore((s) => s.selectedTrackId)
  const selectTrack = useStore((s) => s.selectTrack)
  const updateTrack = useStore((s) => s.updateTrack)
  const addTrack = useStore((s) => s.addTrack)
  const removeTrack = useStore((s) => s.removeTrack)
  const duplicateTrack = useStore((s) => s.duplicateTrack)
  const [showPicker, setShowPicker] = useState(false)
  const [group, setGroup] = useState<(typeof GROUPS)[number]>('Teclados')

  const barTicks = ticksPerBar(project.timeSignature)
  const selected = project.tracks.find((t) => t.id === selectedTrackId)

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span>Pistas ({project.tracks.length})</span>
        <button className="ghost icon" title="Añadir pista" onClick={() => setShowPicker((v) => !v)}>
          ➕
        </button>
      </div>

      <div className="track-list">
        {project.tracks.map((track) => {
          const def = INSTRUMENT_MAP[track.instrument]
          const bars = new Set(track.notes.map((n) => Math.floor(n.tick / barTicks))).size
          return (
            <div
              key={track.id}
              className={`track-item ${track.id === selectedTrackId ? 'selected' : ''}`}
              onClick={() => selectTrack(track.id)}
            >
              <div className="color" style={{ background: track.color }} />
              <div className="meta">
                <div className="name" title={track.name}>
                  {def.icon} {track.name}
                </div>
                <div className="sub">
                  {def.label} · {track.notes.length} notas · {bars} compases
                </div>
              </div>
              <div className="mini-btns" onClick={(e) => e.stopPropagation()}>
                <button
                  className={`mini ${track.muted ? 'on-mute' : ''}`}
                  title="Silenciar"
                  onClick={() => updateTrack(track.id, { muted: !track.muted })}
                >
                  M
                </button>
                <button
                  className={`mini ${track.solo ? 'on-solo' : ''}`}
                  title="Solo"
                  onClick={() => updateTrack(track.id, { solo: !track.solo })}
                >
                  S
                </button>
                <button className="mini" title="Duplicar pista" onClick={() => duplicateTrack(track.id)}>
                  ⧉
                </button>
                <button className="mini" title="Borrar pista" onClick={() => removeTrack(track.id)}>
                  ✕
                </button>
              </div>
            </div>
          )
        })}
        {project.tracks.length === 0 ? <div className="empty-state">Añade una pista para empezar</div> : null}
      </div>

      {selected ? (
        <div style={{ padding: '8px 10px', borderTop: '1px solid var(--line-soft)', display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div className="field">
            <label>Nombre de la pista</label>
            <input
              type="text"
              value={selected.name}
              onChange={(e) => updateTrack(selected.id, { name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Instrumento</label>
            <select
              value={selected.instrument}
              onChange={(e) => {
                const id = e.target.value as InstrumentId
                updateTrack(selected.id, { instrument: id, color: INSTRUMENT_MAP[id].color }, true)
              }}
            >
              {GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {INSTRUMENTS.filter((i) => i.group === g).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Transporte al reproducir: {selected.transpose > 0 ? `+${selected.transpose}` : selected.transpose} semitonos</label>
            <input
              type="range"
              min={-24}
              max={24}
              step={12}
              value={selected.transpose}
              onChange={(e) => updateTrack(selected.id, { transpose: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Volumen {Math.round(selected.volume * 100)}%</label>
            <input
              type="range"
              min={0}
              max={1.2}
              step={0.01}
              value={selected.volume}
              onChange={(e) => updateTrack(selected.id, { volume: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Paneo {selected.pan === 0 ? 'centro' : selected.pan < 0 ? `izq ${Math.round(-selected.pan * 100)}%` : `der ${Math.round(selected.pan * 100)}%`}</label>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.02}
              value={selected.pan}
              onChange={(e) => updateTrack(selected.id, { pan: Number(e.target.value) })}
            />
          </div>
        </div>
      ) : null}

      {showPicker ? (
        <div className="instrument-picker">
          <div className="chip-row" style={{ flexWrap: 'wrap', marginBottom: 6 }}>
            {GROUPS.map((g) => (
              <button key={g} className={`chip ${group === g ? 'active' : ''}`} onClick={() => setGroup(g)}>
                {g}
              </button>
            ))}
          </div>
          <div className="inst-grid">
            {INSTRUMENTS.filter((i) => i.group === group).map((i) => (
              <button
                key={i.id}
                onClick={() => {
                  addTrack(i.id)
                  setShowPicker(false)
                }}
                title={`Añadir ${i.label}`}
              >
                {i.icon} {i.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  )
}
