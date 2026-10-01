import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore, uid, emptyTrack } from '../state/store'
import { INSTRUMENTS, INSTRUMENT_MAP, type InstrumentId } from '../audio/instruments'
import { getContext, resumeContext, previewNote } from '../audio/engine'
import { detectPitchACF, notesToTicks, transcribe, toMonoResampled, type TranscriptionResult } from '../audio/transcribe'
import { PPQ, SCALES, freqToMidi, midiToSolfege, type Key } from '../lib/theory'
import { ticksPerBar } from '../lib/durations'
import type { AnalyzedRecording } from '../state/types'

type Status = 'idle' | 'recording' | 'decoding' | 'analyzing' | 'done' | 'error'

const GRID_OPTIONS = [
  { ticks: PPQ, label: 'Negra' },
  { ticks: PPQ / 2, label: 'Corchea' },
  { ticks: PPQ / 4, label: 'Semicorchea' },
  { ticks: PPQ / 8, label: 'Fusa' },
]

export default function RecorderPanel(): JSX.Element {
  const project = useStore((s) => s.project)
  const tracks = project.tracks
  const selectedTrackId = useStore((s) => s.selectedTrackId)
  const setProject = useStore((s) => s.setProject)
  const addNotes = useStore((s) => s.addNotes)
  const addTrack = useStore((s) => s.addTrack)
  const toast = useStore((s) => s.toast)
  const recordings = useStore((s) => s.recordings)
  const addRecording = useStore((s) => s.addRecording)
  const removeRecording = useStore((s) => s.removeRecording)
  const patchProject = useStore((s) => s.patchProject)

  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<TranscriptionResult | null>(null)
  const [livePitch, setLivePitch] = useState<{ midi: number; cents: number; level: number } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const [grid, setGrid] = useState(PPQ / 2)
  const [bpmMode, setBpmMode] = useState<'auto' | 'manual'>('auto')
  const [manualBpm, setManualBpm] = useState(project.bpm)
  const [targetTrack, setTargetTrack] = useState(selectedTrackId)
  const [createNew, setCreateNew] = useState(false)
  const [instrument, setInstrument] = useState<InstrumentId>('piano')
  const [useDetectedKey, setUseDetectedKey] = useState(true)
  const [snapScale, setSnapScale] = useState(false)
  const [octaveShift, setOctaveShift] = useState(0)
  const [replaceMode, setReplaceMode] = useState(false)
  const [showKeyEditor, setShowKeyEditor] = useState(false)

  const mediaRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const rafRef = useRef(0)
  const timerRef = useRef<number | undefined>(undefined)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  /* --- Medidor de afinación en vivo ---------------------------------- */
  const startTuner = useCallback((stream: MediaStream) => {
    const ctx = getContext()
    void resumeContext()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)
    const buf = new Float32Array(analyser.fftSize)

    const frame = (): void => {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const level = Math.sqrt(sum / buf.length)
      if (level > 0.008) {
        const freq = detectPitchACF(buf, ctx.sampleRate, 70, 1200)
        if (freq > 0) {
          const midiFloat = freqToMidi(freq)
          const midi = Math.round(midiFloat)
          setLivePitch({ midi, cents: Math.round((midiFloat - midi) * 100), level })
        }
      } else {
        setLivePitch(null)
      }
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(rafRef.current)
      try {
        source.disconnect()
        analyser.disconnect()
      } catch {
        /* ignorar */
      }
    }
  }, [])

  const startRecording = async (): Promise<void> => {
    setError(null)
    setResult(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      streamRef.current = stream
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(
        (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
      )
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.start(250)
      mediaRef.current = recorder
      setStatus('recording')
      setElapsed(0)
      timerRef.current = window.setInterval(() => setElapsed((t) => t + 0.1), 100)
      startTuner(stream)
    } catch (err) {
      setStatus('error')
      const message =
        (err as Error).name === 'NotAllowedError' || (err as Error).name === 'SecurityError'
          ? 'El navegador bloqueó el micrófono. Revisa el permiso (icono del candado en la barra de direcciones) o usa la opción de subir un archivo de audio.'
          : `No se pudo acceder al micrófono: ${(err as Error).message}. Puedes subir un archivo de audio en su lugar.`
      setError(message)
      toast(message, 'error')
    }
  }

  const stopRecording = (): void => {
    const recorder = mediaRef.current
    if (!recorder) return
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
      stopCleanup()
      await analyzeBlob(blob)
    }
    recorder.stop()
    setStatus('decoding')
  }

  const stopCleanup = (): void => {
    if (timerRef.current) window.clearInterval(timerRef.current)
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setLivePitch(null)
  }

  useEffect(() => () => stopCleanup(), [])

  /* --- Análisis ------------------------------------------------------ */
  const analyzeBlob = async (blob: Blob): Promise<void> => {
    try {
      setStatus('decoding')
      setProgress(0.05)
      const ctx = getContext()
      const arrayBuffer = await blob.arrayBuffer()
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
      if (audioBuffer.duration > 90) {
        toast('El audio es muy largo: se analizarán los primeros 90 segundos', 'info')
      }
      const { data, rate } = toMonoResampled(audioBuffer, 22050)
      setStatus('analyzing')
      const trimmed = data.length > rate * 90 ? data.slice(0, rate * 90) : data
      const outcome = await transcribe(trimmed, rate, {}, (f) => setProgress(0.05 + f * 0.9))
      setResult(outcome)
      setStatus('done')
      setProgress(1)
      if (outcome.bpmCandidates.length) setManualBpm(outcome.bpm)
      if (outcome.notes.length === 0) {
        toast('No se detectaron notas. Prueba a tararear más cerca del micrófono y sosteniendo las notas.', 'error')
      } else {
        toast(`Se detectaron ${outcome.notes.length} notas · ${outcome.bpm} BPM`, 'success')
      }
    } catch (err) {
      setStatus('error')
      setError(`No se pudo analizar el audio: ${(err as Error).message}`)
      toast('No se pudo analizar el audio', 'error')
    }
  }

  const onFile = async (file: File): Promise<void> => {
    setError(null)
    setResult(null)
    await analyzeBlob(file)
  }

  /* --- Aplicar el resultado al proyecto ------------------------------ */
  const buildNotes = useCallback(() => {
    if (!result) return []
    const bpm = bpmMode === 'auto' ? result.bpm : manualBpm
    const raw = notesToTicks(result.notes, bpm, grid, 0)
    const key: Key | null = useDetectedKey && result.keyDetection ? result.keyDetection.key : null
    const scalePcs = snapScale ? SCALES[(key ?? { root: project.keyRoot, scale: project.keyScale }).scale].steps.map((s) => (key ?? { root: project.keyRoot }).root + s).map((p) => ((p % 12) + 12) % 12) : null
    return raw.map((n) => {
      let pitch = n.pitch + octaveShift * 12
      if (scalePcs) {
        let best = pitch
        for (let d = 0; d <= 6; d++) {
          if (scalePcs.includes((((pitch + d) % 12) + 12) % 12)) {
            best = pitch + d
            break
          }
          if (scalePcs.includes((((pitch - d) % 12) + 12) % 12)) {
            best = pitch - d
            break
          }
        }
        pitch = best
      }
      return { tick: n.tick, duration: n.duration, pitch, velocity: n.velocity }
    })
  }, [result, bpmMode, manualBpm, grid, useDetectedKey, snapScale, project.keyRoot, project.keyScale, octaveShift])

  const applyKey = (): void => {
    if (!result?.keyDetection || !useDetectedKey) return
    patchProject({ keyRoot: result.keyDetection.key.root, keyScale: result.keyDetection.key.scale }, 'tonalidad detectada')
  }

  const applyBpm = (): void => {
    if (!result) return
    patchProject({ bpm: bpmMode === 'auto' ? result.bpm : manualBpm }, 'bpm del tarareo')
  }

  const sendToTrack = (mode: 'replace' | 'append' | 'new'): void => {
    if (!result) return
    const notes = buildNotes()
    if (!notes.length) {
      toast('No hay notas para añadir', 'error')
      return
    }
    if (useDetectedKey && result.keyDetection) applyKey()

    if (mode === 'new') {
      const track = emptyTrack(instrument, `Tarareo ${new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`)
      track.notes = notes.map((n) => ({ ...n, id: uid() }))
      const barsNeeded = Math.ceil((notes.reduce((m, n) => Math.max(m, n.tick + n.duration), 0)) / ticksPerBar(project.timeSignature))
      setProject(
        { ...project, tracks: [...project.tracks, track], bars: Math.max(project.bars, barsNeeded), updatedAt: Date.now() },
        { pushHistory: true, label: 'pista de tarareo' },
      )
      toast(`Pista "${track.name}" creada con ${notes.length} notas`, 'success')
      return
    }

    const id = createNew ? null : targetTrack || selectedTrackId
    if (!id) {
      addTrack(instrument, 'Tarareo')
      return
    }
    if (replaceMode || mode === 'replace') {
      setProject(
        {
          ...project,
          tracks: project.tracks.map((t) => (t.id === id ? { ...t, notes: notes.map((n) => ({ ...n, id: uid() })) } : t)),
          updatedAt: Date.now(),
        },
        { pushHistory: true, label: 'transcripción' },
      )
      toast(`${notes.length} notas escritas en la pista`, 'success')
    } else {
      addNotes(id, notes)
      toast(`${notes.length} notas añadidas a la pista`, 'success')
    }
    void mode
  }

  const saveToLibrary = (): void => {
    if (!result) return
    const notes = buildNotes()
    const rec: AnalyzedRecording = {
      id: uid(),
      name: `Tarareo ${new Date().toLocaleString('es')}`,
      createdAt: Date.now(),
      bpm: bpmMode === 'auto' ? result.bpm : manualBpm,
      notes,
      keyRoot: result.keyDetection?.key.root ?? project.keyRoot,
      keyScale: result.keyDetection?.key.scale ?? project.keyScale,
      durationSec: result.durationSec,
      // Solo se guarda una onda reducida para la vista previa: el trazo
      // detallado (f0) se descarta para no llenar el almacenamiento local.
      waveform: Array.from(result.waveform.filter((_, i) => i % 6 === 0)),
      f0Track: [],
      warnings: result.warnings,
    }
    addRecording(rec)
    toast('Transcripción guardada en la biblioteca', 'success')
  }

  const previewMelody = (): void => {
    if (!result) return
    const notes = buildNotes()
    if (!notes.length) return
    void resumeContext()
    const bpm = bpmMode === 'auto' ? result.bpm : manualBpm
    const secPerTick = 60 / (bpm * PPQ)
    notes.slice(0, 200).forEach((n) => {
      window.setTimeout(() => {
        previewNote(instrument, n.pitch, Math.max(0.08, n.duration * secPerTick), n.velocity)
      }, n.tick * secPerTick * 1000)
    })
  }

  const loadFromLibrary = (id: string): void => {
    const rec = recordings.find((r) => r.id === id)
    if (!rec) return
    if (replaceMode) {
      setProject(
        {
          ...project,
          tracks: project.tracks.map((t) => (t.id === (targetTrack || selectedTrackId) ? { ...t, notes: rec.notes.map((n) => ({ ...n, id: uid() })) } : t)),
          bpm: rec.bpm,
          keyRoot: rec.keyRoot,
          keyScale: rec.keyScale,
          updatedAt: Date.now(),
        },
        { pushHistory: true, label: 'cargar tarareo' },
      )
    } else {
      addNotes(targetTrack || selectedTrackId, rec.notes)
    }
    toast(`"${rec.name}" escrito en la pista`, 'success')
  }

  /* --- Dibujo de la onda y la melodía -------------------------------- */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.fillStyle = '#0a0e15'
    ctx.fillRect(0, 0, w, h)

    if (!result) {
      ctx.fillStyle = '#3b4457'
      ctx.font = '12px system-ui'
      ctx.fillText('Aquí aparecerá la onda de tu grabación y la melodía detectada', 14, h / 2)
      return
    }

    const wave = result.waveform
    const mid = h * 0.45
    ctx.strokeStyle = '#4a7bee'
    ctx.lineWidth = 1
    ctx.beginPath()
    wave.forEach((v, i) => {
      const x = (i / Math.max(1, wave.length - 1)) * w
      const y = mid - v * (h * 0.32)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
    ctx.strokeStyle = '#22304d'
    ctx.beginPath()
    wave.forEach((v, i) => {
      const x = (i / Math.max(1, wave.length - 1)) * w
      const y = mid + v * (h * 0.32)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()

    // Curva de altura (f0) sobre la onda.
    const pitched = result.f0Track.filter((f) => f.freq > 0)
    if (pitched.length) {
      const midis = pitched.map((f) => freqToMidi(f.freq))
      const minMidi = Math.min(...midis) - 1
      const maxMidi = Math.max(...midis) + 1
      ctx.strokeStyle = 'rgba(74, 212, 165, 0.9)'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      let started = false
      result.f0Track.forEach((f) => {
        const x = (f.time / Math.max(0.1, result.durationSec)) * w
        if (f.freq <= 0) {
          started = false
          return
        }
        const midiFloat = freqToMidi(f.freq)
        const y = h - ((midiFloat - minMidi) / Math.max(1, maxMidi - minMidi)) * (h * 0.42) - 8
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else {
          ctx.lineTo(x, y)
        }
      })
      ctx.stroke()

      // Línea de las notas cuantizadas.
      ctx.strokeStyle = 'rgba(255, 217, 61, 0.95)'
      ctx.lineWidth = 2.4
      ctx.beginPath()
      const bpm = bpmMode === 'auto' ? result.bpm : manualBpm
      const secPerTick = 60 / (bpm * PPQ)
      buildNotes().forEach((n) => {
        const x1 = (n.tick * secPerTick / Math.max(0.1, result.durationSec)) * w
        const x2 = ((n.tick + n.duration) * secPerTick / Math.max(0.1, result.durationSec)) * w
        const y = h - ((n.pitch - minMidi) / Math.max(1, maxMidi - minMidi)) * (h * 0.42) - 8
        ctx.moveTo(x1, y)
        ctx.lineTo(Math.max(x2, x1 + 2), y)
      })
      ctx.stroke()
    }
  }, [result, buildNotes, bpmMode, manualBpm])

  const detectedKey = result?.keyDetection
  const notes = buildNotes()
  const maxTick = notes.reduce((m, n) => Math.max(m, n.tick + n.duration), 0)
  const barsNeeded = Math.max(1, Math.ceil(maxTick / ticksPerBar(project.timeSignature)))

  return (
    <div className="view">
      <div className="toolbar">
        <strong style={{ fontSize: 13 }}>Tarareo → Partitura</strong>
        <span className="sep" />
        <span className="legend">
          Canta, tararea o silba una melodía: se detecta la altura de cada nota, se cuantiza al ritmo y se escribe en la partitura.
        </span>
      </div>

      <div className="rec-grid">
        {/* --- Grabación --- */}
        <div className="card">
          <h3>1 · Graba o sube tu melodía</h3>
          <p className="sub">
            Lo mejor es un entorno silencioso, una sola voz y notas sostenidas. También sirve un silbido o un instrumento
            monofónico.
          </p>
          <div className="rec-controls">
            {status === 'recording' ? (
              <button className="primary" onClick={stopRecording}>
                <span className="rec-dot" style={{ display: 'inline-block', marginRight: 8 }} />
                Detener ({elapsed.toFixed(1)} s)
              </button>
            ) : (
              <button className="primary" onClick={startRecording} disabled={status === 'analyzing' || status === 'decoding'}>
                🎤 Grabar con el micrófono
              </button>
            )}
            <label className="chip" style={{ cursor: 'pointer' }}>
              📁 Subir archivo…
              <input
                type="file"
                accept="audio/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void onFile(file)
                  e.target.value = ''
                }}
              />
            </label>
            {status === 'analyzing' || status === 'decoding' ? (
              <span className="pill warn">{status === 'decoding' ? 'Decodificando…' : `Analizando… ${Math.round(progress * 100)}%`}</span>
            ) : null}
          </div>

          {status === 'analyzing' || status === 'decoding' ? (
            <div className="progress" style={{ marginTop: 10 }}>
              <div style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          ) : null}

          {error ? (
            <div className="pill err" style={{ display: 'block', marginTop: 10, padding: 10, lineHeight: 1.5 }}>
              {error}
            </div>
          ) : null}

          {livePitch ? (
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="pill ok" style={{ fontSize: 16, padding: '6px 14px' }}>
                {midiToSolfege(livePitch.midi)}
              </span>
              <div style={{ flex: 1 }}>
                <div className="progress">
                  <div style={{ width: `${Math.min(100, Math.max(0, 50 - livePitch.cents))}%`, marginLeft: 'auto' }} />
                </div>
                <div className="legend" style={{ textAlign: 'center' }}>
                  {livePitch.cents > 0 ? `+${livePitch.cents}` : livePitch.cents} cents
                </div>
              </div>
            </div>
          ) : null}

          <h4>Onda y melodía detectada</h4>
          <div className="wave-box">
            <canvas ref={canvasRef} className="wave-canvas" />
          </div>
          <div className="legend" style={{ marginTop: 6 }}>
            Azul: forma de onda · Verde: altura detectada en cada instante · Amarillo: nota cuantizada final
          </div>

          {result?.warnings?.length ? (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {result.warnings.map((w) => (
                <div key={w} className="pill warn" style={{ lineHeight: 1.5, padding: 8 }}>
                  ⚠️ {w}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* --- Resultado --- */}
        <div className="card">
          <h3>2 · Resultado del análisis</h3>
          {!result ? (
            <p className="sub">Graba o sube un audio para ver aquí las notas detectadas, el tempo y la tonalidad.</p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                <span className="pill ok">{result.notes.length} notas</span>
                <span className="pill">{result.durationSec.toFixed(1)} s</span>
                <span className="pill">{detectedKey ? `${midiToSolfege(60 + detectedKey.key.root).replace(/\d/, '')} ${SCALES[detectedKey.key.scale].label}` : 'tonalidad ?'}</span>
                <span className="pill">confianza {detectedKey ? Math.round(detectedKey.confidence * 100) : 0}%</span>
                <span className="pill">≈ {barsNeeded} compases</span>
              </div>

              <h4>Tempo</h4>
              <div className="chip-row" style={{ flexWrap: 'wrap' }}>
                <button className={`chip ${bpmMode === 'auto' ? 'active' : ''}`} onClick={() => setBpmMode('auto')}>
                  Automático ({result.bpm})
                </button>
                <button className={`chip ${bpmMode === 'manual' ? 'active' : ''}`} onClick={() => setBpmMode('manual')}>
                  Manual
                </button>
                {bpmMode === 'manual' ? (
                  <input
                    type="number"
                    min={40}
                    max={240}
                    value={manualBpm}
                    onChange={(e) => setManualBpm(Math.max(40, Math.min(240, Number(e.target.value) || 100)))}
                    style={{ width: 76 }}
                  />
                ) : null}
                <button
                  className="chip"
                  onClick={() => {
                    applyBpm()
                    toast(`Tempo del proyecto: ${bpmMode === 'auto' ? result.bpm : manualBpm} BPM`, 'success')
                  }}
                >
                  Aplicar al proyecto
                </button>
              </div>
              {result.bpmCandidates.length > 1 ? (
                <div className="chip-row" style={{ flexWrap: 'wrap', marginTop: 6 }}>
                  <span className="legend">Otros tempos probables:</span>
                  {result.bpmCandidates.slice(0, 5).map((b) => (
                    <button
                      key={b}
                      className={`chip ${manualBpm === b && bpmMode === 'manual' ? 'active' : ''}`}
                      onClick={() => {
                        setBpmMode('manual')
                        setManualBpm(b)
                      }}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              ) : null}

              <h4>Cuantización</h4>
              <div className="chip-row" style={{ flexWrap: 'wrap' }}>
                {GRID_OPTIONS.map((g) => (
                  <button key={g.ticks} className={`chip ${grid === g.ticks ? 'active' : ''}`} onClick={() => setGrid(g.ticks)}>
                    {g.label}
                  </button>
                ))}
              </div>

              <h4>Ajustes</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label className="switch">
                  <input type="checkbox" checked={useDetectedKey} onChange={(e) => setUseDetectedKey(e.target.checked)} />
                  Usar la tonalidad detectada
                </label>
                <label className="switch">
                  <input type="checkbox" checked={snapScale} onChange={(e) => setSnapScale(e.target.checked)} />
                  Ajustar las notas a la escala (quita notas extrañas)
                </label>
                <div className="row" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className="legend">Octava:</span>
                  <button className="chip" onClick={() => setOctaveShift((o) => Math.max(-3, o - 1))}>
                    −
                  </button>
                  <span className="pill">{octaveShift > 0 ? `+${octaveShift}` : octaveShift}</span>
                  <button className="chip" onClick={() => setOctaveShift((o) => Math.min(3, o + 1))}>
                    +
                  </button>
                  <button className="chip" onClick={() => setShowKeyEditor((v) => !v)}>
                    🎼 Tonalidad manual
                  </button>
                </div>
                {showKeyEditor ? (
                  <div className="row" style={{ display: 'flex', gap: 6 }}>
                    <select
                      value={project.keyRoot}
                      onChange={(e) => patchProject({ keyRoot: Number(e.target.value) }, 'tonalidad')}
                      style={{ flex: 1 }}
                    >
                      {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map((n, i) => (
                        <option key={n} value={i}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <select
                      value={project.keyScale}
                      onChange={(e) => patchProject({ keyScale: e.target.value as Key['scale'] }, 'tonalidad')}
                      style={{ flex: 1 }}
                    >
                      {Object.entries(SCALES).map(([id, s]) => (
                        <option key={id} value={id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>

              <h4>Notas detectadas</h4>
              <div className="note-chips" style={{ maxHeight: 120, overflow: 'auto' }}>
                {notes.slice(0, 80).map((n, i) => (
                  <span key={i} className="note-chip" title={`compás ${Math.floor(n.tick / ticksPerBar(project.timeSignature)) + 1}`}>
                    {midiToSolfege(n.pitch)}
                  </span>
                ))}
                {notes.length > 80 ? <span className="note-chip">+{notes.length - 80}</span> : null}
              </div>

              <div className="rec-controls" style={{ marginTop: 12 }}>
                <button onClick={previewMelody}>▶ Escuchar</button>
                <button onClick={saveToLibrary}>💾 Guardar</button>
              </div>
            </>
          )}
        </div>

        {/* --- Enviar al proyecto --- */}
        <div className="card span-2">
          <h3>3 · Llevar la melodía al estudio</h3>
          <p className="sub">
            Escribe las notas detectadas en una pista: así podrás mezclarlas, verlas en la partitura y seguir editándolas.
          </p>
          <div className="grid-3">
            <div className="field">
              <label>Pista de destino</label>
              <select value={targetTrack} onChange={(e) => setTargetTrack(e.target.value)} disabled={createNew}>
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({INSTRUMENT_MAP[t.instrument].label})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Instrumento para una pista nueva</label>
              <select value={instrument} onChange={(e) => setInstrument(e.target.value as InstrumentId)}>
                {INSTRUMENTS.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Modo</label>
              <select value={replaceMode ? 'replace' : 'append'} onChange={(e) => setReplaceMode(e.target.value === 'replace')}>
                <option value="append">Añadir al final de las notas existentes</option>
                <option value="replace">Reemplazar las notas de la pista</option>
              </select>
            </div>
          </div>
          <label className="switch" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={createNew} onChange={(e) => setCreateNew(e.target.checked)} />
            Crear una pista nueva con el tarareo
          </label>
          <div className="rec-controls" style={{ marginTop: 12 }}>
            <button className="primary" disabled={!result} onClick={() => sendToTrack(createNew ? 'new' : replaceMode ? 'replace' : 'append')}>
              ➜ Escribir en la pista
            </button>
            <button disabled={!result || !detectedKey} onClick={applyKey}>
              🎼 Aplicar tonalidad detectada
            </button>
            <button disabled={!result} onClick={applyBpm}>
              🥁 Aplicar tempo al proyecto
            </button>
          </div>

          <h4>Biblioteca de tarareos</h4>
          {recordings.length === 0 ? (
            <div className="legend">Aún no has guardado ningún tarareo.</div>
          ) : (
            <div className="rec-list">
              {recordings.map((r) => (
                <div key={r.id} className="rec-item">
                  <span className="name">{r.name}</span>
                  <span className="pill">{r.notes.length} notas</span>
                  <span className="pill">{r.bpm} BPM</span>
                  <button className="chip" onClick={() => loadFromLibrary(r.id)}>
                    Escribir
                  </button>
                  <button className="chip" onClick={() => removeRecording(r.id)}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
