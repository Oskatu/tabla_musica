import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { barsToRender, renderScore } from '../lib/renderScore'
import { toMusicXML, downloadText } from '../lib/musicxml'
import type { Track } from '../state/types'
import { transport } from '../audio/playback'

interface RenderOptions {
  barsPerSystem: number
  scale: number
  showColors: boolean
  showTies: boolean
}

export default function ScoreView(): JSX.Element {
  const project = useStore((s) => s.project)
  const toast = useStore((s) => s.toast)
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  const [options, setOptions] = useState<RenderOptions>({ barsPerSystem: 4, scale: 1, showColors: true, showTies: true })
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  const tracks = project.tracks
  const shown = useMemo(() => tracks.filter((t) => visible[t.id] !== false), [tracks, visible])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    // clientWidth puede ser 0 mientras la pestaña aún no se ha mostrado:
    // en ese caso se usa un ancho de referencia y el ResizeObserver corrige
    // en cuanto la vista es visible.
    const update = (): void => setWidth(el.clientWidth || Math.max(320, Math.min(1100, window.innerWidth - 80) || 900))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const totalBars = useMemo(() => barsToRender(project, shown), [project, shown])

  /* --- Dibujo de la partitura ---------------------------------------- */
  useEffect(() => {
    const host = containerRef.current
    if (!host || width === 0) return
    try {
      renderScore(host, {
        project,
        tracks: shown,
        totalBars,
        barsPerSystem: options.barsPerSystem,
        scale: options.scale,
        showColors: options.showColors,
        showTies: options.showTies,
        width,
      })
    } catch (err) {
      console.error('Error al dibujar la partitura', err)
    }
  }, [project, shown, totalBars, width, options])

  /* --- Exportaciones -------------------------------------------------- */
  const exportXml = (): void => {
    try {
      const xml = toMusicXML(project, { tracks: shown })
      downloadText(xml, `${project.name.replace(/[^\w\-]+/g, '_') || 'partitura'}.musicxml`)
      toast('MusicXML descargado. Ábrelo en MuseScore, Finale, Sibelius…', 'success')
    } catch (err) {
      toast(`No se pudo exportar MusicXML: ${(err as Error).message}`, 'error')
    }
  }

  const exportSvg = (): void => {
    const svgs = containerRef.current?.querySelectorAll('svg')
    if (!svgs?.length) return
    const totalHeight = Array.from(svgs).reduce((m, el) => m + (el.getAttribute('height') ? Number(el.getAttribute('height')) : 0), 0)
    const maxWidth = Math.max(...Array.from(svgs).map((el) => Number(el.getAttribute('width') ?? 0)))
    const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    wrapper.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    wrapper.setAttribute('width', String(maxWidth))
    wrapper.setAttribute('height', String(totalHeight + 40))
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bg.setAttribute('width', '100%')
    bg.setAttribute('height', '100%')
    bg.setAttribute('fill', '#ffffff')
    wrapper.appendChild(bg)
    let offset = 20
    svgs.forEach((el) => {
      const clone = el.cloneNode(true) as SVGElement
      const h = Number(el.getAttribute('height') ?? 0)
      const inner = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      inner.setAttribute('transform', `translate(0, ${offset})`)
      while (clone.firstChild) inner.appendChild(clone.firstChild)
      wrapper.appendChild(inner)
      offset += h + 14
    })
    const svgText = new XMLSerializer().serializeToString(wrapper)
    downloadText(svgText, `${project.name.replace(/[^\w\-]+/g, '_') || 'partitura'}.svg`, 'image/svg+xml')

    // PNG a partir del SVG.
    const img = new Image()
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const scale = 2
      canvas.width = img.width * scale
      canvas.height = img.height * scale
      const c = canvas.getContext('2d')
      if (c) {
        c.fillStyle = '#fff'
        c.fillRect(0, 0, canvas.width, canvas.height)
        c.drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((png) => {
          if (!png) return
          const pngUrl = URL.createObjectURL(png)
          const a = document.createElement('a')
          a.href = pngUrl
          a.download = `${project.name.replace(/[^\w\-]+/g, '_') || 'partitura'}.png`
          a.click()
          setTimeout(() => URL.revokeObjectURL(pngUrl), 2000)
        })
      }
      URL.revokeObjectURL(url)
    }
    img.onerror = () => URL.revokeObjectURL(url)
    img.src = url
    toast('Partitura exportada como SVG y PNG', 'success')
  }

  const hasNotes = shown.some((t) => t.notes.length > 0)
  const { tick } = useTransportPlayhead()

  return (
    <div className="view">
      <div className="toolbar">
        <strong style={{ fontSize: 13 }}>Partitura</strong>
        <span className="sep" />
        <label>Compases por sistema</label>
        <div className="chip-row">
          {[2, 3, 4, 6, 8].map((n) => (
            <button
              key={n}
              className={`chip ${options.barsPerSystem === n ? 'active' : ''}`}
              onClick={() => setOptions((o) => ({ ...o, barsPerSystem: n }))}
            >
              {n}
            </button>
          ))}
        </div>
        <span className="sep" />
        <label>Zoom</label>
        <input
          type="range"
          min={0.6}
          max={1.8}
          step={0.05}
          style={{ width: 110 }}
          value={options.scale}
          onChange={(e) => setOptions((o) => ({ ...o, scale: Number(e.target.value) }))}
        />
        <label className="switch">
          <input type="checkbox" checked={options.showColors} onChange={(e) => setOptions((o) => ({ ...o, showColors: e.target.checked }))} />
          Colores por pista
        </label>
        <label className="switch">
          <input type="checkbox" checked={options.showTies} onChange={(e) => setOptions((o) => ({ ...o, showTies: e.target.checked }))} />
          Ligaduras
        </label>
        <div className="spacer" />
        <button onClick={exportXml} disabled={!hasNotes}>
          ⬇ MusicXML
        </button>
        <button onClick={exportSvg} disabled={!hasNotes}>
          ⬇ SVG / PNG
        </button>
        <button onClick={() => window.print()}>🖨️ Imprimir</button>
      </div>

      <div className="toolbar" style={{ paddingTop: 0, borderTop: 'none' }}>
        <label>Pistas en la partitura</label>
        {tracks.map((t: Track) => (
          <label key={t.id} className="switch">
            <input
              type="checkbox"
              checked={visible[t.id] !== false}
              onChange={(e) => setVisible((v) => ({ ...v, [t.id]: e.target.checked }))}
            />
            <span style={{ color: t.color }}>●</span> {t.name}
          </label>
        ))}
        <div className="spacer" />
        <span className="legend">
          {totalBars} compases · {Math.round(project.bpm)} BPM · cursor en el compás{' '}
          {Math.floor(tick / (((480 * 4) / project.timeSignature[1]) * project.timeSignature[0])) + 1}
        </span>
      </div>

      <div className="score-view">
        <div className="score-page" ref={containerRef} />
        {!hasNotes ? (
          <div className="score-page score-empty" style={{ marginTop: -260 }}>
            Todavía no hay notas.
            <br />
            Dibuja notas en <b>Componer</b>, genera una canción o transcribe un tarareo y aquí aparecerá la partitura.
          </div>
        ) : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Estado auxiliar                                                     */
/* ------------------------------------------------------------------ */

function useTransportPlayhead(): { tick: number } {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let raf = 0
    const unsub = transport.subscribe((t) => setTick(t))
    const frame = (): void => {
      if (!transport.isPlaying) return
      setTick(transport.currentTick())
      raf = requestAnimationFrame(frame)
    }
    if (transport.isPlaying) raf = requestAnimationFrame(frame)
    return () => {
      unsub()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])
  return { tick }
}
