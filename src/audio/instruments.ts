/**
 * Motor de síntesis. Cada instrumento se construye con nodos de Web Audio,
 * sin samples: los mismos gráficos se usan en reproducción en vivo
 * (AudioContext) y en el render offline para exportar WAV.
 */

export type InstrumentId =
  | 'piano'
  | 'epiano'
  | 'guitar'
  | 'bass'
  | 'strings'
  | 'pad'
  | 'synth'
  | 'organ'
  | 'flute'
  | 'marimba'
  | 'brass'
  | 'bell'
  | 'drums'

export interface InstrumentDef {
  id: InstrumentId
  label: string
  icon: string
  group: 'Teclados' | 'Cuerdas' | 'Bajos' | 'Sintetizadores' | 'Vientos' | 'Percusión'
  /** Rango práctico en MIDI (para el teclado y la partitura). */
  range: [number, number]
  /** Octava por defecto al dibujar en el piano roll. */
  defaultOctave: number
  /** Clave recomendada para la partitura. */
  clef: 'treble' | 'bass' | 'percussion'
  /** Color base de la pista. */
  color: string
  /** Los instrumentos melódicos tienen una voz por pista. */
  monophonic: boolean
  /** Cola de reverberación natural en segundos (para saber cuándo parar). */
  tail: number
}

export const INSTRUMENTS: InstrumentDef[] = [
  {
    id: 'piano',
    label: 'Piano acústico',
    icon: '🎹',
    group: 'Teclados',
    range: [21, 108],
    defaultOctave: 4,
    clef: 'treble',
    color: '#5b8cff',
    monophonic: false,
    tail: 1.6,
  },
  {
    id: 'epiano',
    label: 'Piano eléctrico',
    icon: '🎛️',
    group: 'Teclados',
    range: [28, 103],
    defaultOctave: 4,
    clef: 'treble',
    color: '#7a6bff',
    monophonic: false,
    tail: 1.4,
  },
  {
    id: 'organ',
    label: 'Órgano',
    icon: '⛪',
    group: 'Teclados',
    range: [36, 96],
    defaultOctave: 4,
    clef: 'treble',
    color: '#c47bff',
    monophonic: false,
    tail: 0.4,
  },
  {
    id: 'marimba',
    label: 'Marimba',
    icon: '🪵',
    group: 'Teclados',
    range: [45, 96],
    defaultOctave: 4,
    clef: 'treble',
    color: '#e0a458',
    monophonic: false,
    tail: 0.8,
  },
  {
    id: 'guitar',
    label: 'Guitarra',
    icon: '🎸',
    group: 'Cuerdas',
    range: [40, 88],
    defaultOctave: 3,
    clef: 'treble',
    color: '#ff9f43',
    monophonic: false,
    tail: 1.2,
  },
  {
    id: 'strings',
    label: 'Cuerdas',
    icon: '🎻',
    group: 'Cuerdas',
    range: [36, 96],
    defaultOctave: 4,
    clef: 'treble',
    color: '#f368a0',
    monophonic: false,
    tail: 1.2,
  },
  {
    id: 'bass',
    label: 'Bajo eléctrico',
    icon: '🎸',
    group: 'Bajos',
    range: [24, 62],
    defaultOctave: 2,
    clef: 'bass',
    color: '#4ad4a5',
    monophonic: true,
    tail: 0.6,
  },
  {
    id: 'pad',
    label: 'Pad ambiental',
    icon: '🌫️',
    group: 'Sintetizadores',
    range: [36, 96],
    defaultOctave: 4,
    clef: 'treble',
    color: '#4fc3f7',
    monophonic: false,
    tail: 2.4,
  },
  {
    id: 'synth',
    label: 'Sintetizador lead',
    icon: '⚡',
    group: 'Sintetizadores',
    range: [36, 100],
    defaultOctave: 5,
    clef: 'treble',
    color: '#ffd93d',
    monophonic: true,
    tail: 0.5,
  },
  {
    id: 'brass',
    label: 'Metales',
    icon: '🎺',
    group: 'Vientos',
    range: [36, 88],
    defaultOctave: 4,
    clef: 'treble',
    color: '#ff7a45',
    monophonic: true,
    tail: 0.5,
  },
  {
    id: 'flute',
    label: 'Flauta',
    icon: '🪈',
    group: 'Vientos',
    range: [60, 96],
    defaultOctave: 5,
    clef: 'treble',
    color: '#7ee0c1',
    monophonic: true,
    tail: 0.5,
  },
  {
    id: 'bell',
    label: 'Campanas',
    icon: '🔔',
    group: 'Percusión',
    range: [48, 96],
    defaultOctave: 5,
    clef: 'treble',
    color: '#b0bec5',
    monophonic: false,
    tail: 2.2,
  },
  {
    id: 'drums',
    label: 'Batería',
    icon: '🥁',
    group: 'Percusión',
    range: [35, 51],
    defaultOctave: 2,
    clef: 'percussion',
    color: '#ff6b6b',
    monophonic: false,
    tail: 1.4,
  },
]

export const INSTRUMENT_MAP: Record<InstrumentId, InstrumentDef> = INSTRUMENTS.reduce(
  (acc, i) => {
    acc[i.id] = i
    return acc
  },
  {} as Record<InstrumentId, InstrumentDef>,
)

/** Mapa de notas de batería estándar (General MIDI) usado por la pista de percusión. */
export const DRUM_MAP: { midi: number; name: string; short: string }[] = [
  { midi: 35, name: 'Bombo (acústico)', short: 'Bombo' },
  { midi: 36, name: 'Bombo', short: 'Bombo' },
  { midi: 37, name: 'Rimshot', short: 'Rim' },
  { midi: 38, name: 'Caja', short: 'Caja' },
  { midi: 39, name: 'Palmas', short: 'Clap' },
  { midi: 40, name: 'Caja eléctrica', short: 'Caja-e' },
  { midi: 41, name: 'Tom bajo', short: 'Tom B' },
  { midi: 42, name: 'Charles cerrado', short: 'HH' },
  { midi: 43, name: 'Tom medio bajo', short: 'Tom MB' },
  { midi: 44, name: 'Charles pedal', short: 'HHp' },
  { midi: 45, name: 'Tom medio', short: 'Tom M' },
  { midi: 46, name: 'Charles abierto', short: 'HHo' },
  { midi: 47, name: 'Tom medio alto', short: 'Tom MA' },
  { midi: 48, name: 'Tom alto', short: 'Tom A' },
  { midi: 49, name: 'Crash', short: 'Crash' },
  { midi: 50, name: 'Tom alto 2', short: 'Tom A2' },
  { midi: 51, name: 'Ride', short: 'Ride' },
  { midi: 53, name: 'Ride bell', short: 'Ride B' },
]

export const DRUM_NAME = (midi: number): string => DRUM_MAP.find((d) => d.midi === midi)?.short ?? `Perc ${midi}`

/* ------------------------------------------------------------------ */
/* Utilidades internas                                                 */
/* ------------------------------------------------------------------ */

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>()

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = noiseCache.get(ctx)
  if (cached) return cached
  const len = Math.floor(ctx.sampleRate * 2)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  noiseCache.set(ctx, buf)
  return buf
}

function noiseSource(ctx: BaseAudioContext, when: number, duration: number, offset = 0): AudioBufferSourceNode {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx)
  src.loop = true
  src.loopStart = offset
  src.start(when, offset)
  src.stop(when + duration)
  return src
}

/** Envolvente ADSR sencilla sobre un GainNode ya conectado. */
interface EnvOptions {
  a: number
  d: number
  s: number
  r: number
  peak: number
  /** Duración "sostenida" de la nota (sin contar el release). */
  hold: number
}

function applyEnv(param: AudioParam, when: number, o: EnvOptions): void {
  const { a, d, s, r, peak, hold } = o
  const t0 = when
  param.cancelScheduledValues(t0)
  param.setValueAtTime(0.0001, t0)
  param.linearRampToValueAtTime(Math.max(0.0002, peak), t0 + Math.max(0.001, a))
  const decayEnd = t0 + a + Math.max(0.001, d)
  param.exponentialRampToValueAtTime(Math.max(0.0002, peak * s), decayEnd)
  const releaseStart = Math.max(decayEnd, t0 + hold)
  param.setValueAtTime(Math.max(0.0002, peak * s), releaseStart)
  param.exponentialRampToValueAtTime(0.0001, releaseStart + Math.max(0.01, r))
}

function gainNode(ctx: BaseAudioContext, value = 1): GainNode {
  const g = ctx.createGain()
  g.gain.value = value
  return g
}

function osc(ctx: BaseAudioContext, type: OscillatorType, freq: number, detune = 0): OscillatorNode {
  const o = ctx.createOscillator()
  o.type = type
  o.frequency.value = freq
  o.detune.value = detune
  return o
}

/** Suma varias ondas parciales con amplitud, tipo aditivo (campanas, órgano). */
function periodicWave(ctx: BaseAudioContext, partials: number[], cacheKey: string): PeriodicWave {
  const real = new Float32Array(partials.length + 1)
  const imag = new Float32Array(partials.length + 1)
  partials.forEach((amp, i) => {
    imag[i + 1] = amp
  })
  const key = `pw:${cacheKey}`
  const store = (ctx as unknown as { __tmWaves?: Map<string, PeriodicWave> }).__tmWaves ?? new Map()
  ;(ctx as unknown as { __tmWaves?: Map<string, PeriodicWave> }).__tmWaves = store
  const hit = store.get(key)
  if (hit) return hit
  const w = ctx.createPeriodicWave(real, imag, { disableNormalization: false })
  store.set(key, w)
  return w
}

const PIANO_PARTIALS = [1, 0.42, 0.26, 0.16, 0.1, 0.07, 0.05, 0.035, 0.02, 0.015, 0.01]
const ORGAN_PARTIALS = [1, 0.6, 0.5, 0.35, 0.0, 0.22, 0.0, 0.16]
const BRASS_PARTIALS = [1, 0.7, 0.5, 0.38, 0.28, 0.2, 0.14, 0.1, 0.07]

/* ------------------------------------------------------------------ */
/* Voces                                                               */
/* ------------------------------------------------------------------ */

type Voice = (ctx: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, vel: number) => void

const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12)

function playPiano(ctx: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, vel: number): void {
  const freq = midiToFreq(midi)
  const hold = Math.max(0.08, dur)
  const decay = Math.min(6, Math.max(1.1, 12 / Math.pow(freq / 220, 0.55)))
  const out = gainNode(ctx, vel)

  // Cuerdas: dos osciladores ligeramente desafinados (batido de cuerdas).
  const detunes = [0, midi < 60 ? 3.5 : 2.2]
  const mix = gainNode(ctx, 1)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 0.6
  lp.frequency.setValueAtTime(Math.min(9000, 2600 + freq * 8), when)
  lp.frequency.exponentialRampToValueAtTime(Math.max(500, freq * 4.5), when + decay * 0.5)

  detunes.forEach((dt, i) => {
    const o = ctx.createOscillator()
    o.setPeriodicWave(periodicWave(ctx, PIANO_PARTIALS, 'piano'))
    o.frequency.value = freq
    o.detune.value = dt
    const g = gainNode(ctx, i === 0 ? 0.62 : 0.38)
    o.connect(g).connect(mix)
    applyEnv(g.gain, when, { a: 0.004, d: decay, s: 0.0001, r: Math.min(0.6, decay * 0.35), peak: 1, hold })
    o.start(when)
    o.stop(when + hold + decay + 0.8)
  })

  // Ruido de martillo muy breve, da "golpe" al ataque.
  const hammer = noiseSource(ctx, when, 0.045)
  const hp = ctx.createBiquadFilter()
  hp.type = 'bandpass'
  hp.frequency.value = Math.min(6000, freq * 4)
  hp.Q.value = 0.8
  const hg = gainNode(ctx, 0.16 * vel)
  applyEnv(hg.gain, when, { a: 0.001, d: 0.04, s: 0.0001, r: 0.02, peak: 1, hold: 0.01 })
  hammer.connect(hp).connect(hg).connect(out)

  mix.connect(lp).connect(out).connect(dest)
}

function playEPiano(ctx: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, vel: number): void {
  const freq = midiToFreq(midi)
  const hold = Math.max(0.1, dur)
  const out = gainNode(ctx, vel * 0.9)
  out.connect(dest)

  // FM tipo Rhodes: portadora seno + moduladora con índice que decae rápido.
  const carrier = osc(ctx, 'sine', freq)
  const mod = osc(ctx, 'sine', freq * 2)
  const modGain = gainNode(ctx, freq * 3.2 * vel)
  modGain.gain.setValueAtTime(freq * 3.4 * vel, when)
  modGain.gain.exponentialRampToValueAtTime(freq * 0.35, when + 0.35)
  mod.connect(modGain).connect(carrier.frequency)

  const body = gainNode(ctx, 1)
  applyEnv(body.gain, when, { a: 0.006, d: Math.max(0.9, 4 / Math.pow(freq / 220, 0.5)), s: 0.06, r: 0.35, peak: 1, hold })
  carrier.connect(body).connect(out)

  // Ataque metálico ("tine").
  const tine = osc(ctx, 'sine', freq * 7.2)
  const tg = gainNode(ctx, 0.09 * vel)
  applyEnv(tg.gain, when, { a: 0.001, d: 0.18, s: 0.0001, r: 0.1, peak: 1, hold: 0.01 })
  tine.connect(tg).connect(out)

  carrier.start(when)
  carrier.stop(when + hold + 1.6)
  mod.start(when)
  mod.stop(when + hold + 1.6)
  tine.start(when)
  tine.stop(when + 0.4)
}

function playGuitar(ctx: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, vel: number): void {
  const freq = midiToFreq(midi)
  const hold = Math.max(0.15, dur)
  // Karplus-Strong: ruido corto en un lazo de retardo filtrado.
  const delay = ctx.createDelay(0.5)
  delay.delayTime.value = 1 / freq
  const damp = ctx.createBiquadFilter()
  damp.type = 'lowpass'
  damp.frequency.value = Math.min(9000, 1800 + freq * 6)
  damp.Q.value = 0.4
  const fb = gainNode(ctx, 0.965)
  const out = gainNode(ctx, 1)

  const excite = noiseSource(ctx, when, Math.min(0.06, 2 / freq))
  const bp = ctx.createBiquadFilter()
  bp.type = 'lowpass'
  bp.frequency.value = Math.min(7000, freq * 9)
  const exciteGain = gainNode(ctx, 0.9 * vel)

  excite.connect(bp).connect(exciteGain).connect(delay)
  delay.connect(damp).connect(fb).connect(delay)
  damp.connect(out).connect(dest)

  // El lazo pierde energía de forma natural (el cuerpo filtra los agudos).
  fb.gain.setValueAtTime(0.965, when)
  fb.gain.linearRampToValueAtTime(0.9, when + hold + 0.5)

  // Desconecta el lazo cuando la nota ya es inaudible, para no dejar
  // realimentación viva en el grafo (importante con muchas notas).
  const stopAt = when + hold + 0.6
  scheduleDisconnect(ctx, stopAt, [delay, damp, fb, out, excite, bp, exciteGain])
}

/**
 * Libera nodos de realimentación cuando el contexto (en vivo) llega a ese
 * instante. En un render offline no hay temporizador real: el grafo se
 * descarta completo al terminar, así que allí no hace falta.
 */
function scheduleDisconnect(ctx: BaseAudioContext, at: number, nodes: AudioNode[]): void {
  if (typeof window === 'undefined') return
  const live = ctx as AudioContext
  if (typeof live.state !== 'string' || typeof live.currentTime !== 'number') return
  const delayMs = Math.max(30, (at - ctx.currentTime) * 1000)
  window.setTimeout(() => {
    nodes.forEach((n) => {
      try {
        n.disconnect()
      } catch {
        /* ya desconectado */
      }
    })
  }, delayMs)
}

function playBass(ctx: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, vel: number): void {
  const freq = midiToFreq(midi)
  const hold = Math.max(0.08, dur)
  const out = gainNode(ctx, 1)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(220 + freq * 6, when)
  lp.frequency.exponentialRampToValueAtTime(120 + freq * 2.4, when + 0.35)
  lp.Q.value = 3.5
  out.connect(lp).connect(dest)

  const sub = osc(ctx, 'sine', freq / 2)
  const subG = gainNode(ctx, 0.5)

  const body = osc(ctx, 'triangle', freq)
  const bodyG = gainNode(ctx, 0.75)

  const saw = osc(ctx, 'sawtooth', freq * 2)
  const sawG = gainNode(ctx, 0.16)

  const allG = gainNode(ctx, vel)
  applyEnv(allG.gain, when, { a: 0.012, d: 0.3, s: 0.72, r: 0.12, peak: 1, hold })
  allG.connect(lp)

  sub.connect(subG).connect(allG)
  body.connect(bodyG).connect(allG)
  saw.connect(sawG).connect(allG)

  const end = when + hold + 0.4
  ;[sub, body, saw].forEach((o) => {
    o.start(when)
    o.stop(end)
  })
}

function playStrings(ctx: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, vel: number): void {
  const freq = midiToFreq(midi)
  const hold = Math.max(0.2, dur)
  const out = gainNode(ctx, 1)

  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(900, when)
  lp.frequency.linearRampToValueAtTime(2800, when + 0.35)

  const allG = gainNode(ctx, 0.0001)
  applyEnv(allG.gain, when, { a: 0.22, d: 0.4, s: 0.8, r: 0.55, peak: vel * 0.5, hold })
  allG.connect(lp).connect(out).connect(dest)

  // Vibrato lento y poco profundo, compartido por todas las voces del arco.
  const lfo = osc(ctx, 'sine', 4.7)
  const lfoGain = gainNode(ctx, 5)
  lfo.connect(lfoGain)

  const detunes = [-9, -3, 0, 3, 9]
  detunes.forEach((dt, i) => {
    const o = osc(ctx, 'sawtooth', freq, dt)
    const g = gainNode(ctx, i === 2 ? 0.34 : 0.24)
    lfoGain.connect(o.detune)
    o.connect(g).connect(allG)
    o.start(when)
    o.stop(when + hold + 1.6)
  })

  lfo.start(when)
  lfo.stop(when + hold + 1.6)
}

function playPad(ctx: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, vel: number): void {
  const freq = midiToFreq(midi)
  const hold = Math.max(0.3, dur)
  const out = gainNode(ctx, vel * 0.5)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 2200
  lp.Q.value = 1.2

  const g = gainNode(ctx, 0.0001)
  applyEnv(g.gain, when, { a: 0.6, d: 1.2, s: 0.75, r: 1.4, peak: 1, hold })
  g.connect(lp).connect(out).connect(dest)

  ;[
    { dt: -12, type: 'sawtooth' as OscillatorType, amp: 0.3 },
    { dt: 0, type: 'sawtooth' as OscillatorType, amp: 0.34 },
    { dt: 7, type: 'triangle' as OscillatorType, amp: 0.3 },
    { dt: 12, type: 'sine' as OscillatorType, amp: 0.22 },
  ].forEach((v) => {
    const o = osc(ctx, v.type, freq, v.dt)
    const og = gainNode(ctx, v.amp)
    o.connect(og).connect(g)
    o.start(when)
    o.stop(when + hold + 3)
  })

  // LFO lento sobre el filtro: el pad "respira".
  const lfo = osc(ctx, 'sine', 0.22)
  const lfoG = gainNode(ctx, 700)
  lfo.connect(lfoG).connect(lp.frequency)
  lfo.start(when)
  lfo.stop(when + hold + 3)
}

function playSynth(ctx: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, vel: number): void {
  const freq = midiToFreq(midi)
  const hold = Math.max(0.06, dur)
  const out = gainNode(ctx, 0.55)

  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 9
  const peak = Math.min(7000, 1400 + (midi - 48) * 90)
  lp.frequency.setValueAtTime(Math.max(300, peak * 0.4), when)
  lp.frequency.linearRampToValueAtTime(peak, when + 0.06)
  lp.frequency.exponentialRampToValueAtTime(Math.max(320, peak * 0.35), when + Math.max(0.2, hold))

  const amp = gainNode(ctx, 0.0001)
  applyEnv(amp.gain, when, { a: 0.01, d: 0.18, s: 0.72, r: 0.14, peak: vel, hold })
  amp.connect(lp).connect(out).connect(dest)

  ;[
    { type: 'sawtooth' as OscillatorType, dt: 0, amp: 0.55 },
    { type: 'square' as OscillatorType, dt: 8, amp: 0.24 },
    { type: 'sawtooth' as OscillatorType, dt: -8, amp: 0.24 },
  ].forEach((v) => {
    const o = osc(ctx, v.type, freq, v.dt)
    const g = gainNode(ctx, v.amp)
    o.connect(g).connect(amp)
    o.start(when)
    o.stop(when + hold + 0.5)
  })
}

function playOrgan(ctx: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, vel: number): void {
  const freq = midiToFreq(midi)
  const hold = Math.max(0.05, dur)
  const out = gainNode(ctx, vel * 0.7)
  applyEnv(out.gain, when, { a: 0.02, d: 0.05, s: 0.95, r: 0.12, peak: 1, hold })

  const o = ctx.createOscillator()
  o.setPeriodicWave(periodicWave(ctx, ORGAN_PARTIALS, 'organ'))
  o.frequency.value = freq
  const lfo = osc(ctx, 'sine', 5.6)
  const lfoG = gainNode(ctx, 3.5)
  lfo.connect(lfoG).connect(o.detune)
  o.connect(out).connect(dest)
  o.start(when)
  o.stop(when + hold + 0.4)
  lfo.start(when)
  lfo.stop(when + hold + 0.4)
}

function playFlute(ctx: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, vel: number): void {
  const freq = midiToFreq(midi)
  const hold = Math.max(0.08, dur)
  const out = gainNode(ctx, vel * 0.55)
  const amp = gainNode(ctx, 0.0001)
  applyEnv(amp.gain, when, { a: 0.07, d: 0.1, s: 0.88, r: 0.16, peak: 1, hold })
  amp.connect(out).connect(dest)

  const o = osc(ctx, 'sine', freq)
  const o2 = osc(ctx, 'triangle', freq, 4)
  const g2 = gainNode(ctx, 0.16)
  const lfo = osc(ctx, 'sine', 5.2)
  const lfoG = gainNode(ctx, 7)
  lfo.connect(lfoG).connect(o.detune)
  lfo.connect(lfoG).connect(o2.detune)
  o.connect(amp)
  o2.connect(g2).connect(amp)

  // Aire.
  const breath = noiseSource(ctx, when, hold + 0.3)
  const hp = ctx.createBiquadFilter()
  hp.type = 'bandpass'
  hp.frequency.value = freq * 2
  hp.Q.value = 0.7
  const bg = gainNode(ctx, 0.05 * vel)
  breath.connect(hp).connect(bg).connect(amp)

  ;[o, o2].forEach((x) => {
    x.start(when)
    x.stop(when + hold + 0.5)
  })
  lfo.start(when)
  lfo.stop(when + hold + 0.5)
}

function playMarimba(ctx: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, vel: number): void {
  const freq = midiToFreq(midi)
  const out = gainNode(ctx, vel * 0.8)
  out.connect(dest)
  const parts = [
    { ratio: 1, amp: 0.7, decay: Math.max(0.5, 2.2 - midi / 40) },
    { ratio: 4, amp: 0.22, decay: 0.16 },
    { ratio: 9.2, amp: 0.06, decay: 0.08 },
  ]
  parts.forEach((p, i) => {
    const o = osc(ctx, 'sine', freq * p.ratio)
    const g = gainNode(ctx, 0.0001)
    applyEnv(g.gain, when, { a: 0.003, d: p.decay, s: 0.0001, r: 0.12, peak: p.amp, hold: 0.01 })
    o.connect(g).connect(out)
    const d = Math.max(0.15, dur) + p.decay + 0.3
    o.start(when)
    o.stop(when + d)
    if (i === 0) {
      const click = noiseSource(ctx, when, 0.02)
      const cg = gainNode(ctx, 0.12 * vel)
      applyEnv(cg.gain, when, { a: 0.001, d: 0.02, s: 0.0001, r: 0.01, peak: 1, hold: 0.005 })
      click.connect(cg).connect(out)
    }
  })
}

function playBrass(ctx: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, vel: number): void {
  const freq = midiToFreq(midi)
  const hold = Math.max(0.08, dur)
  const out = gainNode(ctx, vel * 0.6)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 1.6
  lp.frequency.setValueAtTime(600, when)
  lp.frequency.linearRampToValueAtTime(Math.min(6500, freq * 12), when + 0.09)
  const amp = gainNode(ctx, 0.0001)
  applyEnv(amp.gain, when, { a: 0.05, d: 0.15, s: 0.85, r: 0.15, peak: 1, hold })
  amp.connect(lp).connect(out).connect(dest)

  const o = ctx.createOscillator()
  o.setPeriodicWave(periodicWave(ctx, BRASS_PARTIALS, 'brass'))
  o.frequency.value = freq
  const o2 = osc(ctx, 'sawtooth', freq, 7)
  const g2 = gainNode(ctx, 0.2)
  const lfo = osc(ctx, 'sine', 5.1)
  const lfoG = gainNode(ctx, 6)
  lfo.connect(lfoG).connect(o.detune)
  o.connect(amp)
  o2.connect(g2).connect(amp)
  ;[o, o2].forEach((x) => {
    x.start(when)
    x.stop(when + hold + 0.4)
  })
  lfo.start(when)
  lfo.stop(when + hold + 0.4)
}

function playBell(ctx: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, vel: number): void {
  const freq = midiToFreq(midi)
  const out = gainNode(ctx, vel * 0.35)
  out.connect(dest)
  const hold = Math.max(0.1, dur)
  // Parciales inarmónicos típicos de campana.
  const partials = [
    { r: 0.56, a: 0.5, d: 3.2 },
    { r: 0.92, a: 0.42, d: 2.6 },
    { r: 1, a: 0.6, d: 3.0 },
    { r: 1.19, a: 0.3, d: 1.9 },
    { r: 1.71, a: 0.24, d: 1.4 },
    { r: 2.0, a: 0.2, d: 1.1 },
    { r: 2.74, a: 0.14, d: 0.8 },
    { r: 3.76, a: 0.09, d: 0.5 },
  ]
  partials.forEach((p) => {
    const o = osc(ctx, 'sine', freq * p.r)
    const g = gainNode(ctx, 0.0001)
    applyEnv(g.gain, when, { a: 0.002, d: p.d, s: 0.0001, r: 0.4, peak: p.a, hold: 0.02 })
    o.connect(g).connect(out)
    o.start(when)
    o.stop(when + p.d + hold + 0.6)
  })
}

/* ------------------------------------------------------------------ */
/* Batería                                                             */
/* ------------------------------------------------------------------ */

function drumKick(ctx: BaseAudioContext, dest: AudioNode, when: number, vel: number): void {
  const o = osc(ctx, 'sine', 150)
  o.frequency.setValueAtTime(160, when)
  o.frequency.exponentialRampToValueAtTime(42, when + 0.11)
  const g = gainNode(ctx, 0.0001)
  applyEnv(g.gain, when, { a: 0.002, d: 0.32, s: 0.0001, r: 0.12, peak: vel, hold: 0.02 })
  o.connect(g).connect(dest)
  o.start(when)
  o.stop(when + 0.6)

  const click = noiseSource(ctx, when, 0.03)
  const hp = ctx.createBiquadFilter()
  hp.type = 'lowpass'
  hp.frequency.value = 1200
  const cg = gainNode(ctx, 0.25 * vel)
  applyEnv(cg.gain, when, { a: 0.001, d: 0.03, s: 0.0001, r: 0.02, peak: 1, hold: 0.005 })
  click.connect(hp).connect(cg).connect(dest)
}

function drumSnare(ctx: BaseAudioContext, dest: AudioNode, when: number, vel: number, electric = false): void {
  const dur = electric ? 0.12 : 0.22
  const n = noiseSource(ctx, when, dur + 0.1)
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = electric ? 1200 : 1400
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 2400
  bp.Q.value = 0.6
  const g = gainNode(ctx, 0.0001)
  applyEnv(g.gain, when, { a: 0.001, d: dur, s: 0.0001, r: 0.06, peak: 0.85 * vel, hold: 0.01 })
  n.connect(hp).connect(bp).connect(g).connect(dest)

  ;[
    { f: 185, a: 0.5 },
    { f: 330, a: 0.32 },
  ].forEach((t) => {
    const o = osc(ctx, 'triangle', t.f)
    const og = gainNode(ctx, 0.0001)
    applyEnv(og.gain, when, { a: 0.001, d: electric ? 0.05 : 0.1, s: 0.0001, r: 0.05, peak: t.a * vel, hold: 0.01 })
    o.connect(og).connect(dest)
    o.start(when)
    o.stop(when + 0.3)
  })
}

function drumHat(ctx: BaseAudioContext, dest: AudioNode, when: number, vel: number, open: boolean): void {
  const dur = open ? 0.42 : 0.055
  const n = noiseSource(ctx, when, dur + 0.05)
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 7000
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 10000
  bp.Q.value = 0.9
  const g = gainNode(ctx, 0.0001)
  applyEnv(g.gain, when, { a: 0.001, d: dur, s: 0.0001, r: 0.04, peak: 0.4 * vel, hold: 0.005 })
  n.connect(hp).connect(bp).connect(g).connect(dest)
}

function drumCymbal(ctx: BaseAudioContext, dest: AudioNode, when: number, vel: number, ride: boolean): void {
  const dur = ride ? 1.2 : 1.8
  const n = noiseSource(ctx, when, dur)
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = ride ? 3500 : 5000
  const g = gainNode(ctx, 0.0001)
  applyEnv(g.gain, when, { a: 0.002, d: dur * 0.7, s: 0.05, r: dur * 0.5, peak: 0.32 * vel, hold: 0.05 })
  n.connect(hp).connect(g).connect(dest)
  // "Ping" metálico del ride.
  if (ride) {
    const o = osc(ctx, 'square', 3200)
    const og = gainNode(ctx, 0.0001)
    applyEnv(og.gain, when, { a: 0.001, d: 0.12, s: 0.0001, r: 0.1, peak: 0.06 * vel, hold: 0.01 })
    o.connect(og).connect(dest)
    o.start(when)
    o.stop(when + 0.3)
  }
}

function drumTom(ctx: BaseAudioContext, dest: AudioNode, when: number, vel: number, freq: number): void {
  const o = osc(ctx, 'sine', freq * 1.4)
  o.frequency.setValueAtTime(freq * 1.4, when)
  o.frequency.exponentialRampToValueAtTime(freq, when + 0.18)
  const g = gainNode(ctx, 0.0001)
  applyEnv(g.gain, when, { a: 0.002, d: 0.36, s: 0.0001, r: 0.14, peak: 0.8 * vel, hold: 0.02 })
  o.connect(g).connect(dest)
  o.start(when)
  o.stop(when + 0.6)
  const n = noiseSource(ctx, when, 0.05)
  const ng = gainNode(ctx, 0.12 * vel)
  applyEnv(ng.gain, when, { a: 0.001, d: 0.05, s: 0.0001, r: 0.03, peak: 1, hold: 0.005 })
  n.connect(ng).connect(dest)
}

function drumClap(ctx: BaseAudioContext, dest: AudioNode, when: number, vel: number): void {
  const offsets = [0, 0.011, 0.022, 0.034]
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 1300
  bp.Q.value = 1.1
  const out = gainNode(ctx, 1)
  out.connect(dest)
  offsets.forEach((off, i) => {
    const n = noiseSource(ctx, when + off, 0.05)
    const g = gainNode(ctx, 0.0001)
    const isLast = i === offsets.length - 1
    applyEnv(g.gain, when + off, {
      a: 0.001,
      d: isLast ? 0.22 : 0.035,
      s: 0.0001,
      r: 0.03,
      peak: (isLast ? 0.5 : 0.32) * vel,
      hold: 0.005,
    })
    n.connect(g).connect(bp)
  })
  bp.connect(out)
}

function playDrum(ctx: BaseAudioContext, dest: AudioNode, midi: number, when: number, _dur: number, vel: number): void {
  switch (midi) {
    case 35:
    case 36:
      return drumKick(ctx, dest, when, vel)
    case 38:
      return drumSnare(ctx, dest, when, vel)
    case 40:
      return drumSnare(ctx, dest, when, vel, true)
    case 37:
      return drumTom(ctx, dest, when, vel * 0.8, 420)
    case 39:
      return drumClap(ctx, dest, when, vel)
    case 41:
      return drumTom(ctx, dest, when, vel, 90)
    case 43:
      return drumTom(ctx, dest, when, vel, 130)
    case 45:
      return drumTom(ctx, dest, when, vel, 170)
    case 47:
      return drumTom(ctx, dest, when, vel, 210)
    case 48:
      return drumTom(ctx, dest, when, vel, 250)
    case 50:
      return drumTom(ctx, dest, when, vel, 290)
    case 42:
      return drumHat(ctx, dest, when, vel, false)
    case 44:
      return drumHat(ctx, dest, when, vel * 0.8, false)
    case 46:
      return drumHat(ctx, dest, when, vel * 0.9, true)
    case 49:
      return drumCymbal(ctx, dest, when, vel, false)
    case 51:
      return drumCymbal(ctx, dest, when, vel, true)
    case 53:
      return drumCymbal(ctx, dest, when, vel * 0.8, true)
    default:
      // Cualquier nota desconocida suena como tom afinado.
      return drumTom(ctx, dest, when, vel, Math.max(60, 220 + (midi - 45) * 22))
  }
}

const VOICES: Record<InstrumentId, Voice> = {
  piano: playPiano,
  epiano: playEPiano,
  guitar: playGuitar,
  bass: playBass,
  strings: playStrings,
  pad: playPad,
  synth: playSynth,
  organ: playOrgan,
  flute: playFlute,
  marimba: playMarimba,
  brass: playBrass,
  bell: playBell,
  drums: playDrum,
}

/** Toca (o programa) una nota de un instrumento. */
export function triggerNote(
  ctx: BaseAudioContext,
  dest: AudioNode,
  instrument: InstrumentId,
  midi: number,
  when: number,
  durationSec: number,
  velocity = 0.85,
): void {
  const voice = VOICES[instrument] ?? VOICES.piano
  try {
    voice(ctx, dest, midi, Math.max(when, 0), Math.max(0.02, durationSec), Math.max(0.02, Math.min(1, velocity)))
  } catch (err) {
    console.warn('No se pudo sintetizar la nota', err)
  }
}

/** Genera una respuesta de impulso de reverberación por síntesis (sin archivos). */
export function createReverbImpulse(ctx: BaseAudioContext, seconds = 2.4, decay = 2.6): AudioBuffer {
  const rate = ctx.sampleRate
  const len = Math.max(1, Math.floor(rate * seconds))
  const buf = ctx.createBuffer(2, len, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      const t = i / len
      // Difusión temprana + cola exponencial, con un poco de "aire" en los agudos.
      const env = Math.pow(1 - t, decay)
      data[i] = (Math.random() * 2 - 1) * env
    }
    // Suavizado muy leve para quitar ruido de alta frecuencia estridente.
    let prev = 0
    for (let i = 0; i < len; i++) {
      prev = prev * 0.35 + data[i] * 0.65
      data[i] = prev
    }
  }
  return buf
}
