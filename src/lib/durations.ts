/**
 * Duraciones musicales: conversión entre ticks y figuras de partitura.
 * PPQ = 480 ticks por negra (quarter).
 */

import { PPQ } from './theory'

export interface NoteFigure {
  /** Nombre de la figura en VexFlow: 'w', 'h', 'q', '8', '16', '32' */
  vf: string
  ticks: number
  dotted: boolean
  label: string
}

/** Todas las figuras estándar ordenadas de mayor a menor, con puntillo. */
export const FIGURES: NoteFigure[] = [
  { vf: 'w', ticks: PPQ * 4, dotted: false, label: 'redonda' },
  { vf: 'h', ticks: PPQ * 2, dotted: false, label: 'blanca' },
  { vf: 'q', ticks: PPQ, dotted: false, label: 'negra' },
  { vf: '8', ticks: PPQ / 2, dotted: false, label: 'corchea' },
  { vf: '16', ticks: PPQ / 4, dotted: false, label: 'semicorchea' },
  { vf: '32', ticks: PPQ / 8, dotted: false, label: 'fusa' },
  { vf: '64', ticks: PPQ / 16, dotted: false, label: 'semifusa' },
  { vf: 'h', ticks: PPQ * 3, dotted: true, label: 'blanca con puntillo' },
  { vf: 'q', ticks: PPQ * 1.5, dotted: true, label: 'negra con puntillo' },
  { vf: '8', ticks: PPQ * 0.75, dotted: true, label: 'corchea con puntillo' },
  { vf: '16', ticks: PPQ * 0.375, dotted: true, label: 'semicorchea con puntillo' },
]

export interface NotatedPiece {
  vf: string
  dotted: boolean
  keys: string[]
  ticks: number
}

/**
 * Divide una duración arbitraria en una secuencia de figuras estándar.
 * `startOffset` (posición métrica dentro del compás) garantiza que las notas
 * no crucen el pulso de forma ilegible: se prefieren figuras alineadas.
 */
export function splitDuration(durationTicks: number, startOffset: number): { ticks: number; figure: NoteFigure }[] {
  const out: { ticks: number; figure: NoteFigure }[] = []
  let remaining = Math.round(durationTicks)
  let pos = Math.round(startOffset)
  let guard = 0

  while (remaining > 0 && guard++ < 64) {
    // La figura más grande que cabe y que empieza en una posición métrica válida.
    let chosen: NoteFigure | undefined
    for (const f of FIGURES) {
      if (f.ticks <= remaining && pos % f.ticks === 0) {
        chosen = f
        break
      }
    }
    if (!chosen) {
      // Sin figura alineada: se usa la mayor que quepa (la ligadura lo arregla).
      chosen = [...FIGURES].filter((f) => f.ticks <= remaining).sort((a, b) => b.ticks - a.ticks)[0]
    }
    if (!chosen) {
      // Resto más pequeño que una semifusa: se redondea a la figura mínima.
      out.push({ ticks: remaining, figure: { vf: '64', ticks: remaining, dotted: false, label: 'semifusa' } })
      break
    }
    out.push({ ticks: chosen.ticks, figure: chosen })
    remaining -= chosen.ticks
    pos += chosen.ticks
  }
  return out
}

/** Divide un compás completo sin notas en silencios (VexFlow 'r' + figura). */
export function restFor(ticks: number, offset: number): { vf: string; dotted: boolean; ticks: number }[] {
  return splitDuration(ticks, offset).map((s) => ({
    vf: s.figure.vf,
    dotted: s.figure.dotted,
    ticks: s.ticks,
  }))
}

export function ticksPerBar(timeSignature: [number, number]): number {
  const [num, den] = timeSignature
  return (PPQ * 4 * num) / den
}

export function ticksToSeconds(ticks: number, bpm: number): number {
  return (ticks / PPQ) * (60 / bpm)
}

export function secondsToTicks(seconds: number, bpm: number): number {
  return (seconds * bpm * PPQ) / 60
}

/** Redondea un tick a la rejilla indicada (en ticks). */
export function quantizeTick(tick: number, grid: number): number {
  if (grid <= 0) return Math.round(tick)
  return Math.round(tick / grid) * grid
}

export function describeDuration(ticks: number): string {
  if (ticks >= PPQ * 4) return 'redonda'
  if (ticks >= PPQ * 3) return 'blanca con puntillo'
  if (ticks >= PPQ * 2) return 'blanca'
  if (ticks >= PPQ * 1.5) return 'negra con puntillo'
  if (ticks >= PPQ) return 'negra'
  if (ticks >= PPQ * 0.75) return 'corchea con puntillo'
  if (ticks >= PPQ / 2) return 'corchea'
  if (ticks >= PPQ / 4) return 'semicorchea'
  return 'fusa'
}

/**
 * Nombre de una figura en VexFlow, incluyendo puntillo. VexFlow espera
 * la duración con el sufijo 'd' para los puntillos (p.ej. 'qd').
 */
export function vexDuration(figure: NoteFigure): string {
  return figure.dotted ? `${figure.vf}d` : figure.vf
}

/** Tick -> tupla [beats, beatsPerSecond] para Tone/Audio scheduling. */
export function ticksToBeats(ticks: number): number {
  return ticks / PPQ
}
