import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { INSTRUMENT_MAP } from '../audio/instruments'
import { getAnalyserIfReady, getTrackLevels } from '../audio/engine'
import { transport } from '../audio/playback'

export default function Mixer(): JSX.Element {
  const project = useStore((s) => s.project)
  const updateTrack = useStore((s) => s.updateTrack)
  const patchProject = useStore((s) => s.patchProject)
  const selectedTrackId = useStore((s) => s.selectedTrackId)
  const selectTrack = useStore((s) => s.selectTrack)

  const [levels, setLevels] = useState<Record<string, number>>({})
  const [master, setMaster] = useState(0)

  // Sondea el nivel real de cada pista mientras suena la música (60 ms).
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!transport.isPlaying) {
        setLevels((prev) => (Object.keys(prev).length ? {} : prev))
        setMaster((prev) => (prev > 0 ? 0 : prev))
        return
      }
      const next: Record<string, number> = {}
      getTrackLevels().forEach((v, k) => {
        next[k] = v
      })
      setLevels((prev) => {
        const same = Object.keys(next).length === Object.keys(prev).length && Object.entries(next).every(([k, v]) => Math.abs((prev[k] ?? 0) - v) < 0.02)
        return same ? prev : next
      })
      const analyser = getAnalyserIfReady()
      if (analyser) {
        const buf = new Float32Array(analyser.fftSize)
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
        const level = Math.min(1, Math.sqrt(sum / buf.length) * 2.4)
        setMaster((prev) => (Math.abs(prev - level) < 0.02 ? prev : level))
      }
    }, 60)
    return () => window.clearInterval(timer)
  }, [])

  const masterLevel = master > 0 ? master : Object.values(levels).reduce((m, v) => Math.max(m, v), 0)

  return (
    <div className="view">
      <div className="toolbar">
        <strong style={{ fontSize: 13 }}>Mezclador</strong>
        <span className="sep" />
        <span className="legend">
          Ajusta volumen, paneo y EQ de cada pista. Los cambios se aplican en directo mientras suena.
        </span>
        <div className="spacer" />
        <button
          onClick={() => {
            patchProject({ master: { ...project.master, volume: 0.85, reverb: 0.2, delay: 0.12, delayFeedback: 0.28, compression: 0.35 } }, 'reset master')
            project.tracks.forEach((t) => updateTrack(t.id, { volume: 0.85, pan: 0, eq: { low: 0, mid: 0, high: 0 } }))
          }}
        >
          Restablecer mezcla
        </button>
      </div>

      <div className="mixer">
        <div className="mixer-strips">
          {project.tracks.map((track) => {
            const def = INSTRUMENT_MAP[track.instrument]
            return (
              <div
                key={track.id}
                className={`strip ${track.id === selectedTrackId ? 'selected' : ''}`}
                onClick={() => selectTrack(track.id)}
                style={track.id === selectedTrackId ? { borderColor: 'var(--accent)' } : undefined}
              >
                <div className="strip-head" title={track.name}>
                  <span style={{ color: track.color }}>●</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.name}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-faint)', minHeight: 13 }}>{def.label}</div>

                <div className="fader-area">
                  <input
                    className="vertical"
                    type="range"
                    min={0}
                    max={1.2}
                    step={0.01}
                    value={track.volume}
                    onChange={(e) => updateTrack(track.id, { volume: Number(e.target.value) })}
                    title={`Volumen ${Math.round(track.volume * 100)}%`}
                  />
                  <div className="meter">
                    <div className="meter-fill" style={{ height: `${Math.round(Math.min(1, (levels[track.id] ?? 0) * (track.muted ? 0 : 1)) * 100)}%` }} />
                  </div>
                </div>

                <div className="pan-row">
                  <span>PAN</span>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.02}
                    value={track.pan}
                    onChange={(e) => updateTrack(track.id, { pan: Number(e.target.value) })}
                  />
                </div>

                <div className="knob-row">
                  <div>
                    <div>BAJ</div>
                    <input
                      type="range"
                      min={-18}
                      max={18}
                      step={1}
                      value={track.eq.low}
                      onChange={(e) => updateTrack(track.id, { eq: { ...track.eq, low: Number(e.target.value) } })}
                    />
                  </div>
                  <div>
                    <div>MED</div>
                    <input
                      type="range"
                      min={-18}
                      max={18}
                      step={1}
                      value={track.eq.mid}
                      onChange={(e) => updateTrack(track.id, { eq: { ...track.eq, mid: Number(e.target.value) } })}
                    />
                  </div>
                  <div>
                    <div>ALT</div>
                    <input
                      type="range"
                      min={-18}
                      max={18}
                      step={1}
                      value={track.eq.high}
                      onChange={(e) => updateTrack(track.id, { eq: { ...track.eq, high: Number(e.target.value) } })}
                    />
                  </div>
                </div>
                <div className="eq-badge">
                  {track.eq.low >= 0 ? '+' : ''}
                  {track.eq.low} / {track.eq.mid >= 0 ? '+' : ''}
                  {track.eq.mid} / {track.eq.high >= 0 ? '+' : ''}
                  {track.eq.high} dB
                </div>

                <div className="chip-row" style={{ justifyContent: 'center' }}>
                  <button className={`mini ${track.muted ? 'on-mute' : ''}`} onClick={() => updateTrack(track.id, { muted: !track.muted })}>
                    M
                  </button>
                  <button className={`mini ${track.solo ? 'on-solo' : ''}`} onClick={() => updateTrack(track.id, { solo: !track.solo })}>
                    S
                  </button>
                </div>
                <div className="eq-badge">{Math.round(track.volume * 100)}%</div>
              </div>
            )
          })}

          {/* Master */}
          <div className="strip master">
            <div className="strip-head">🎚️ Master</div>
            <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>Salida general</div>
            <div className="fader-area">
              <input
                className="vertical"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={project.master.volume}
                onChange={(e) => patchProject({ master: { ...project.master, volume: Number(e.target.value) } }, 'volumen master', false)}
              />
              <div className="meter">
                <div className="meter-fill" style={{ height: `${Math.round(masterLevel * 100)}%` }} />
              </div>
            </div>
            <div className="knob-row" style={{ gridTemplateColumns: '1fr' }}>
              <div>
                <div>REVERB</div>
                <input
                  type="range"
                  min={0}
                  max={0.7}
                  step={0.01}
                  value={project.master.reverb}
                  onChange={(e) => patchProject({ master: { ...project.master, reverb: Number(e.target.value) } }, 'reverb', false)}
                />
              </div>
            </div>
            <div className="knob-row" style={{ gridTemplateColumns: '1fr' }}>
              <div>
                <div>ECO</div>
                <input
                  type="range"
                  min={0}
                  max={0.6}
                  step={0.01}
                  value={project.master.delay}
                  onChange={(e) => patchProject({ master: { ...project.master, delay: Number(e.target.value) } }, 'eco', false)}
                />
              </div>
            </div>
            <div className="knob-row" style={{ gridTemplateColumns: '1fr' }}>
              <div>
                <div>REPETICIÓN ECO</div>
                <input
                  type="range"
                  min={0}
                  max={0.8}
                  step={0.01}
                  value={project.master.delayFeedback}
                  onChange={(e) => patchProject({ master: { ...project.master, delayFeedback: Number(e.target.value) } }, 'eco', false)}
                />
              </div>
            </div>
            <div className="knob-row" style={{ gridTemplateColumns: '1fr' }}>
              <div>
                <div>COMPRESIÓN</div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={project.master.compression}
                  onChange={(e) => patchProject({ master: { ...project.master, compression: Number(e.target.value) } }, 'compresión', false)}
                />
              </div>
            </div>
            <div className="eq-badge">{Math.round(project.master.volume * 100)}%</div>
          </div>
        </div>
      </div>
    </div>
  )
}
