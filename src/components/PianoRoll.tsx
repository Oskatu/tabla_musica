import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { PPQ, noteName, isBlackKey } from '../lib/theory'
import { ticksPerBar } from '../lib/durations'
import { DRUM_MAP, DRUM_NAME, INSTRUMENT_MAP } from '../audio/instruments'
import { transport } from '../audio/playback'
import { previewNote } from '../audio/engine'
import type { Note, Track } from '../state/types'

const ROW_H = 14
const KEY_W = 64
const RULER_H = 30
const LOWEST = 21 // A0
const HIGHEST = 108 // C8

/** Filas de la pista de percusión (una por pieza de batería). */
const DRUM_ROWS = [...new Set(DRUM_MAP.map((d) => d.midi))].sort((a, b) => b - a)

interface Props {
  track: Track
  scrollRef: React.RefObject<HTMLDivElement>
}

interface DragState {
  kind: 'move' | 'resize' | 'marquee'
  startX: number
  startY: number
  noteIds: string[]
  originals: Note[]
  curX: number
  curY: number
  moved: boolean
}

export default function PianoRoll({ track, scrollRef }: Props): JSX.Element {
  const project = useStore((s) => s.project)
  const zoom = useStore((s) => s.zoom)
  const snapTicks = useStore((s) => s.snapTicks)
  const tool = useStore((s) => s.tool)
  const drawDuration = useStore((s) => s.drawDuration)
  const selectedNoteIds = useStore((s) => s.selectedNoteIds)
  const setSelectedNotes = useStore((s) => s.setSelectedNotes)
  const addNote = useStore((s) => s.addNote)
  const removeNotes = useStore((s) => s.removeNotes)
  const updateNote = useStore((s) => s.updateNote)
  const pushHistory = useStore((s) => s.pushHistory)
  const setPlayhead = useStore((s) => s.setPlayhead)
  const loop = useStore((s) => s.loop)
  const setLoop = useStore((s) => s.setLoop)

  const [playhead, setLocalPlayhead] = useState(0)
  const [playing, setPlaying] = useState(transport.isPlaying)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [hoverPitch, setHoverPitch] = useState<number | null>(null)
  const dragRef = useRef<DragState | null>(null)
  dragRef.current = drag

  const isDrums = track.instrument === 'drums'
  const def = INSTRUMENT_MAP[track.instrument]
  const rows = useMemo(() => (isDrums ? DRUM_ROWS : Array.from({ length: HIGHEST - LOWEST + 1 }, (_, i) => HIGHEST - i)), [isDrums])
  const rowCount = rows.length

  const barTicks = ticksPerBar(project.timeSignature)
  const pxPerTick = zoom / PPQ
  const contentW = Math.max(project.bars * barTicks * pxPerTick, 800)
  const contentH = rowCount * ROW_H

  const rowIndexForPitch = useCallback(
    (pitch: number): number => {
      const idx = rows.indexOf(pitch)
      if (idx >= 0) return idx
      // Fuera del rango visible: se ancla al extremo más cercano.
      return pitch > rows[0] ? 0 : rows.length - 1
    },
    [rows],
  )

  const yForPitch = useCallback((pitch: number): number => rowIndexForPitch(pitch) * ROW_H, [rowIndexForPitch])
  const pitchForY = useCallback((y: number): number => rows[Math.max(0, Math.min(rowCount - 1, Math.floor(y / ROW_H)))], [rowCount, rows])
  const xForTick = useCallback((tick: number): number => tick * pxPerTick, [pxPerTick])
  const tickForX = useCallback((x: number): number => Math.max(0, x / pxPerTick), [pxPerTick])

  const snap = useCallback(
    (tick: number): number => {
      if (snapTicks <= 0) return Math.round(tick)
      return Math.round(tick / snapTicks) * snapTicks
    },
    [snapTicks],
  )

  /* --- Playhead ------------------------------------------------------ */
  useEffect(() => {
    let raf = 0
    const tickListener = (tick: number, isPlaying: boolean): void => {
      setLocalPlayhead(tick)
      setPlaying(isPlaying)
      setPlayhead(tick)
    }
    const unsub = transport.subscribe(tickListener)
    const frame = (): void => {
      if (!transport.isPlaying) return
      setLocalPlayhead(transport.currentTick())
      raf = requestAnimationFrame(frame)
    }
    if (transport.isPlaying) raf = requestAnimationFrame(frame)
    return () => {
      unsub()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [setPlayhead])

  const seek = useCallback(
    (tick: number) => {
      const t = Math.min(Math.max(0, tick), project.bars * barTicks - 1)
      transport.setCursor(t)
      setLocalPlayhead(t)
      setPlayhead(t)
    },
    [barTicks, project.bars, setPlayhead],
  )

  /* --- Interacción con la rejilla ------------------------------------ */
  const gridRef = useRef<HTMLDivElement>(null)

  const localPoint = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const el = gridRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const noteAt = (tick: number, pitch: number): Note | undefined =>
    track.notes.find((n) => n.pitch === pitch && tick >= n.tick && tick < n.tick + n.duration + 0.5)

  const startNoteDrag = (e: React.PointerEvent, note: Note | null, x: number, y: number): void => {
    const ids = note
      ? e.shiftKey
        ? Array.from(new Set([...selectedNoteIds, note.id]))
        : selectedNoteIds.includes(note.id)
          ? selectedNoteIds
          : [note.id]
      : []
    if (ids.length) setSelectedNotes(ids)
    setDrag({
      kind: 'move',
      startX: x,
      startY: y,
      noteIds: ids,
      originals: track.notes.filter((n) => ids.includes(n.id)).map((n) => ({ ...n })),
      curX: x,
      curY: y,
      moved: false,
    })
  }

  const onGridPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    const { x, y } = localPoint(e)
    const tick = tickForX(x)
    const pitch = pitchForY(y)
    const hit = noteAt(tick, pitch)

    if (tool === 'erase') {
      if (hit) {
        removeNotes(track.id, [hit.id])
        previewNote(track.instrument, hit.pitch, 0.2)
      }
      return
    }

    if (tool === 'select') {
      setDrag({ kind: 'marquee', startX: x, startY: y, noteIds: [], originals: [], curX: x, curY: y, moved: false })
      return
    }

    previewNote(track.instrument, pitch, 0.3)
    if (hit) {
      startNoteDrag(e, hit, x, y)
      return
    }

    const newTick = Math.max(0, snap(tick))
    const id = addNote(track.id, { tick: newTick, duration: drawDuration, pitch, velocity: 0.85 })
    setSelectedNotes([id])
    setDrag({
      kind: 'move',
      startX: x,
      startY: y,
      noteIds: [id],
      originals: [{ id, tick: newTick, duration: drawDuration, pitch, velocity: 0.85 }],
      curX: x,
      curY: y,
      moved: false,
    })
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const { x, y } = localPoint(e)
    setHoverPitch(pitchForY(y))
    const d = dragRef.current
    if (!d) return

    if (d.kind === 'marquee') {
      if (Math.abs(x - d.startX) > 2 || Math.abs(y - d.startY) > 2) setDrag({ ...d, curX: x, curY: y, moved: true })
      return
    }

    const rawDeltaTick = tickForX(x) - tickForX(d.startX)
    const rawDeltaPitch = rowIndexForPitch(pitchForY(y)) - rowIndexForPitch(pitchForY(d.startY))
    const deltaTick = snapTicks > 0 ? Math.round(rawDeltaTick / snapTicks) * snapTicks : Math.round(rawDeltaTick)
    const deltaRows = Math.round(rawDeltaPitch)
    if (deltaTick === 0 && deltaRows === 0 && !d.moved) return

    if (!d.moved) pushHistory(d.kind === 'resize' ? 'cambiar duración' : 'mover nota')
    setDrag({ ...d, curX: x, curY: y, moved: true })

    if (d.kind === 'move') {
      for (const orig of d.originals) {
        const targetRow = Math.max(0, Math.min(rowCount - 1, rowIndexForPitch(orig.pitch) + deltaRows))
        updateNote(track.id, orig.id, {
          tick: Math.max(0, orig.tick + deltaTick),
          pitch: rows[targetRow],
        })
      }
    } else if (d.kind === 'resize') {
      const orig = d.originals[0]
      if (!orig) return
      const minDur = snapTicks || PPQ / 8
      updateNote(track.id, orig.id, { duration: Math.max(minDur, Math.round(orig.duration + rawDeltaTick)) })
    }
  }

  const endDrag = (): void => {
    const d = dragRef.current
    if (d?.kind === 'marquee' && d.moved) {
      const x1 = Math.min(d.startX, d.curX)
      const x2 = Math.max(d.startX, d.curX)
      const y1 = Math.min(d.startY, d.curY)
      const y2 = Math.max(d.startY, d.curY)
      // Los rectángulos abarcan filas: se comparan por índice de fila.
      const rowTop = Math.floor(y1 / ROW_H)
      const rowBottom = Math.floor(y2 / ROW_H)
      const ids = track.notes
        .filter((n) => {
          const row = rowIndexForPitch(n.pitch)
          return row >= rowTop && row <= rowBottom && xForTick(n.tick + n.duration) >= x1 && xForTick(n.tick) <= x2
        })
        .map((n) => n.id)
      setSelectedNotes(ids)
    }
    setDrag(null)
  }

  const onResizeStart = (e: React.PointerEvent, note: Note): void => {
    e.stopPropagation()
    const { x, y } = localPoint(e)
    setSelectedNotes([note.id])
    setDrag({ kind: 'resize', startX: x, startY: y, noteIds: [note.id], originals: [{ ...note }], curX: x, curY: y, moved: false })
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  const onContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    const { x, y } = localPoint(e)
    const hit = noteAt(tickForX(x), pitchForY(y))
    if (hit) removeNotes(track.id, [hit.id])
  }

  /* --- Regla: cursor y bucle ---------------------------------------- */
  const rulerDragRef = useRef<{ startTick: number } | null>(null)
  const onRulerPointerDown = (e: React.PointerEvent): void => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const tick = Math.max(0, snap(tickForX(e.clientX - rect.left - KEY_W)))
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (e.shiftKey) {
      rulerDragRef.current = { startTick: tick }
      setLoop({ enabled: true, startTick: tick, endTick: tick + barTicks })
      return
    }
    rulerDragRef.current = null
    seek(tick)
  }

  const onRulerPointerMove = (e: React.PointerEvent): void => {
    const d = rulerDragRef.current
    if (!d) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const tick = Math.max(0, snap(tickForX(e.clientX - rect.left - KEY_W)))
    setLoop({
      enabled: true,
      startTick: Math.min(d.startTick, tick),
      endTick: Math.max(d.startTick, tick) + (snapTicks || PPQ / 2),
    })
  }

  /* --- Ctrl + rueda = zoom ------------------------------------------ */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handler = (ev: WheelEvent): void => {
      if (!ev.ctrlKey && !ev.metaKey) return
      ev.preventDefault()
      const st = useStore.getState()
      st.setZoom(st.zoom * (ev.deltaY < 0 ? 1.12 : 1 / 1.12))
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [scrollRef])

  /* --- Líneas de la rejilla ----------------------------------------- */
  const gridLines = useMemo(() => {
    const lines: JSX.Element[] = []
    const beats = project.timeSignature[0]
    const beatTicks = barTicks / beats
    const totalTicks = project.bars * barTicks
    for (let t = 0; t <= totalTicks; t += beatTicks) {
      const isBar = t % barTicks === 0
      lines.push(<div key={`v${t}`} className={`grid-line-v ${isBar ? 'bar' : 'beat'}`} style={{ left: xForTick(t), height: contentH }} />)
    }
    return lines
  }, [barTicks, contentH, project.bars, project.timeSignature, xForTick])

  const soundingIds = useMemo(() => {
    if (!playing) return new Set<string>()
    return new Set(track.notes.filter((n) => playhead >= n.tick && playhead < n.tick + n.duration).map((n) => n.id))
  }, [playing, playhead, track.notes])

  const barPx = barTicks * pxPerTick
  const barLabelEvery = Math.max(1, Math.ceil(46 / Math.max(1, barPx)))

  const labelFor = (pitch: number): string =>
    isDrums ? DRUM_NAME(pitch) : `${noteName(pitch)}${Math.floor(pitch / 12) - 1}`

  return (
    <div className="roll-wrap">
      <div className="roll-scroll" ref={scrollRef}>
        <div className="roll-inner" style={{ width: KEY_W + contentW, height: RULER_H + contentH }}>
          {/* Regla */}
          <div
            className="roll-ruler"
            style={{ width: KEY_W + contentW }}
            onPointerDown={onRulerPointerDown}
            onPointerMove={onRulerPointerMove}
            onPointerUp={() => {
              rulerDragRef.current = null
            }}
            title="Clic: colocar el cursor · Mayús + arrastrar: marcar bucle"
          >
            <div style={{ position: 'absolute', left: 0, top: 0, width: KEY_W, height: '100%', background: '#10141c', borderRight: '1px solid #2c3547' }} />
            <span style={{ position: 'absolute', left: 8, top: 7, fontSize: 10, color: '#64708a' }}>compás</span>
            {Array.from({ length: project.bars + 1 }).map((_, bar) =>
              bar % barLabelEvery === 0 ? (
                <div key={`bl${bar}`} className="ruler-bar-label" style={{ left: KEY_W + xForTick(bar * barTicks) + 4 }}>
                  {bar + 1}
                </div>
              ) : null,
            )}
            {loop.enabled && loop.endTick > loop.startTick ? (
              <div className="loop-region" style={{ left: KEY_W + xForTick(loop.startTick), width: Math.max(3, xForTick(loop.endTick - loop.startTick)) }} />
            ) : null}
          </div>

          {/* Columna de teclas (pegada a la izquierda al desplazar) */}
          <div className="roll-keys" style={{ width: KEY_W, height: contentH }}>
            {rows.map((pitch, i) => {
              const black = isDrums ? i % 2 === 1 : isBlackKey(pitch)
              const isHover = hoverPitch === pitch
              return (
                <div
                  key={pitch}
                  className={`pkey ${black ? 'black' : 'white'} ${isHover ? 'active' : ''}`}
                  style={{ top: i * ROW_H, height: ROW_H }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    previewNote(track.instrument, pitch, 0.5)
                  }}
                  title={isDrums ? DRUM_NAME(pitch) : labelFor(pitch)}
                >
                  {isDrums
                    ? DRUM_NAME(pitch)
                    : pitch % 12 === 0
                      ? `C${Math.floor(pitch / 12) - 1}`
                      : black
                        ? ''
                        : ''}
                </div>
              )
            })}
          </div>

          {/* Rejilla */}
          <div
            ref={gridRef}
            className="roll-grid"
            style={{
              left: KEY_W,
              top: RULER_H,
              width: contentW,
              height: contentH,
              cursor: tool === 'erase' ? 'crosshair' : tool === 'select' ? 'default' : 'copy',
            }}
            onPointerDown={onGridPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={() => setHoverPitch(null)}
            onContextMenu={onContextMenu}
          >
            {/* Sombreado alterno de compases */}
            {Array.from({ length: Math.ceil(project.bars / 2) }).map((_, i) => (
              <div
                key={`bar${i}`}
                className="row-shade"
                style={{
                  left: xForTick(i * 2 * barTicks),
                  top: 0,
                  width: xForTick(barTicks),
                  height: contentH,
                  background: 'rgba(255,255,255,0.016)',
                }}
              />
            ))}
            {/* Filas oscuras para las teclas negras */}
            {!isDrums
              ? rows.map((pitch, i) =>
                  isBlackKey(pitch) ? (
                    <div key={`rs${pitch}`} className="row-shade" style={{ top: i * ROW_H, height: ROW_H, background: 'rgba(255,255,255,0.025)' }} />
                  ) : null,
                )
              : null}
            {/* Línea de compás con más contraste */}
            {gridLines}
            {/* Notas */}
            {track.notes.map((n) => {
              const left = xForTick(n.tick)
              const width = Math.max(4, xForTick(n.duration) - 1)
              const top = yForPitch(n.pitch)
              const selected = selectedNoteIds.includes(n.id)
              const isSounding = soundingIds.has(n.id)
              return (
                <div
                  key={n.id}
                  className={`note ${selected ? 'selected' : ''} ${isSounding ? 'sounding' : ''}`}
                  style={{
                    left,
                    top: top + 1,
                    width,
                    height: ROW_H - 2,
                    background: `linear-gradient(180deg, ${track.color}, ${shade(track.color, -0.4)})`,
                    color: track.color,
                  }}
                  title={`${labelFor(n.pitch)} · ${(n.duration / PPQ).toFixed(2)} negras · ${Math.round(n.velocity * 100)}%`}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return
                    e.stopPropagation()
                    if (tool === 'erase') {
                      removeNotes(track.id, [n.id])
                      return
                    }
                    const { x, y } = localPoint(e)
                    previewNote(track.instrument, n.pitch, 0.3)
                    startNoteDrag(e, n, x, y)
                    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
                  }}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    previewNote(track.instrument, n.pitch, 0.9)
                  }}
                >
                  <span className="note-label">{width > 36 ? labelFor(n.pitch) : ''}</span>
                  {selected ? <span className="note-resize" onPointerDown={(e) => onResizeStart(e, n)} /> : null}
                </div>
              )
            })}

            {drag?.kind === 'marquee' && drag.moved ? (
              <div
                className="marquee"
                style={{
                  left: Math.min(drag.startX, drag.curX),
                  top: Math.min(drag.startY, drag.curY),
                  width: Math.abs(drag.curX - drag.startX),
                  height: Math.abs(drag.curY - drag.startY),
                }}
              />
            ) : null}

            <div className="playhead" style={{ left: xForTick(playhead), height: contentH }} />
          </div>
        </div>
      </div>

      <div className="hint-bar">
        <span>
          <b>Clic</b> dibuja · <b>Arrastra</b> mueve · <b>Borde derecho</b> alarga
        </span>
        <span>
          <b>Clic derecho</b> borra · <b>Mayús + clic</b> añade a la selección
        </span>
        <span>
          <b>Ctrl + rueda</b> zoom · <b>Mayús + arrastrar en la regla</b> marca el bucle
        </span>
        <span>
          Pista: <b>{track.name}</b> ({def.label}) · Rejilla: <b>{snapTicks ? `${snapTicks / PPQ}♩` : 'libre'}</b>
        </span>
      </div>
    </div>
  )
}

/** Aclara (positivo) u oscurece (negativo) un color hex. */
function shade(hex: string, amount: number): string {
  const clean = hex.replace('#', '')
  const num = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16)
  const r = Math.max(0, Math.min(255, ((num >> 16) & 255) + Math.round(255 * amount)))
  const g = Math.max(0, Math.min(255, ((num >> 8) & 255) + Math.round(255 * amount)))
  const b = Math.max(0, Math.min(255, (num & 255) + Math.round(255 * amount)))
  return `rgb(${r}, ${g}, ${b})`
}
