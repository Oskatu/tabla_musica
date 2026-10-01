import { useEffect, useState } from 'react'
import { transport } from '../audio/playback'

/** Posición del playhead y estado de reproducción, suscritos al transporte. */
export function useTransportTick(): { tick: number; playing: boolean } {
  const [tick, setTick] = useState(() => transport.currentTick())
  const [playing, setPlaying] = useState(transport.isPlaying)

  useEffect(() => {
    let raf = 0
    const unsub = transport.subscribe((t, p) => {
      setTick(t)
      setPlaying(p)
    })
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

  return { tick, playing }
}

/** Formatea un tick como compás:tiempo:ticks. */
export function formatPosition(tick: number, timeSignature: [number, number]): string {
  const beatsPerBar = timeSignature[0]
  const beatTicks = (480 * 4) / timeSignature[1]
  const bar = Math.floor(tick / (beatTicks * beatsPerBar)) + 1
  const beat = Math.floor((tick % (beatTicks * beatsPerBar)) / beatTicks) + 1
  const frac = Math.floor(((tick % beatTicks) / beatTicks) * 100)
  return `${String(bar).padStart(3, '0')}:${beat}:${String(frac).padStart(2, '0')}`
}

export function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
