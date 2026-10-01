/**
 * Utilidades mínimas para las pruebas: contador de comprobaciones, informes y
 * un entorno DOM (jsdom) con las APIs de audio simuladas, para poder ejecutar
 * la aplicación y el motor de audio en Node sin navegador.
 */

export const state = { checks: 0, failures: 0 }

export function section(title: string): void {
  console.log(`\n${title}`)
}

export function check(name: string, condition: boolean, extra = ''): void {
  state.checks++
  if (!condition) {
    state.failures++
    console.log(`  ✗ ${name}${extra ? ` ${extra}` : ''}`)
  } else {
    console.log(`  ✓ ${name}${extra ? ` ${extra}` : ''}`)
  }
}

export function summary(): number {
  console.log('')
  if (state.failures === 0) {
    console.log(`✅ ${state.checks} comprobaciones correctas`)
  } else {
    console.log(`❌ ${state.failures} de ${state.checks} comprobaciones fallidas`)
  }
  return state.failures
}

/* ------------------------------------------------------------------ */
/* Entorno DOM                                                         */
/* ------------------------------------------------------------------ */

let domReady = false
let dom: { window: unknown } | null = null

/** Prepara un DOM mínimo. Es idempotente. */
export async function setupDom(): Promise<void> {
  if (domReady) return
  const { JSDOM } = await import('jsdom')
  const instance = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
    url: 'https://preview.local/',
  })
  const win = instance.window as unknown as Record<string, unknown>
  const g = globalThis as unknown as Record<string, unknown>
  g.window = win
  g.document = win.document
  Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true })
  for (const key of ['HTMLElement', 'SVGElement', 'Node', 'Element', 'XMLSerializer', 'DOMParser', 'localStorage', 'getComputedStyle', 'MouseEvent', 'KeyboardEvent', 'Event', 'Blob', 'FileReader', 'Image']) {
    if (win[key] !== undefined) g[key] = win[key]
  }
  g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number
  g.cancelAnimationFrame = (id: number) => clearTimeout(id)
  win.requestAnimationFrame = g.requestAnimationFrame
  win.cancelAnimationFrame = g.cancelAnimationFrame
  g.IS_REACT_ACT_ENVIRONMENT = true
  g.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  win.ResizeObserver = g.ResizeObserver
  const url = win.URL as unknown as Record<string, unknown>
  url.createObjectURL = () => `blob:test-${Math.random()}`
  url.revokeObjectURL = () => {}
  dom = instance
  domReady = true
}

export function domWindow(): typeof globalThis {
  if (!dom) throw new Error('setupDom() no se ha llamado')
  return dom.window as typeof globalThis
}

/* ------------------------------------------------------------------ */
/* Audio simulado                                                      */
/* ------------------------------------------------------------------ */

export const audioStats = { nodes: 0, started: 0, stopped: 0, offlineRenders: 0 }

class FakeParam {
  value = 0
  setValueAtTime(): this { return this }
  linearRampToValueAtTime(): this { return this }
  exponentialRampToValueAtTime(): this { return this }
  setTargetAtTime(): this { return this }
  cancelScheduledValues(): this { return this }
}

class FakeNode {
  gain = new FakeParam()
  frequency = new FakeParam()
  detune = new FakeParam()
  Q = new FakeParam()
  pan = new FakeParam()
  delayTime = new FakeParam()
  threshold = new FakeParam()
  knee = new FakeParam()
  ratio = new FakeParam()
  attack = new FakeParam()
  release = new FakeParam()
  fftSize = 2048
  smoothingTimeConstant = 0.8
  frequencyBinCount = 1024
  type = 'sine'
  buffer: unknown = null
  loop = false
  loopStart = 0
  constructor() {
    audioStats.nodes++
  }
  connect<T>(node: T): T { return node }
  disconnect(): void {}
  start(): void { audioStats.started++ }
  stop(): void { audioStats.stopped++ }
  setPeriodicWave(): this { return this }
  setValueAtTime(): this { return this }
  getChannelData(): Float32Array { return new Float32Array(64) }
  getFloatTimeDomainData(a: Float32Array): void { a.fill(0.15) }
  getByteFrequencyData(a: Uint8Array): void { a.fill(40) }
}

class FakeAudioContext {
  sampleRate = 44100
  currentTime = 0
  state = 'running'
  destination = new FakeNode()
  createGain(): FakeNode { return new FakeNode() }
  createOscillator(): FakeNode { return new FakeNode() }
  createBiquadFilter(): FakeNode { return new FakeNode() }
  createDelay(): FakeNode { return new FakeNode() }
  createConvolver(): FakeNode { return new FakeNode() }
  createDynamicsCompressor(): FakeNode { return new FakeNode() }
  createAnalyser(): FakeNode { return new FakeNode() }
  createStereoPanner(): FakeNode { return new FakeNode() }
  createBufferSource(): FakeNode { return new FakeNode() }
  createBuffer(channels: number, length: number): unknown {
    return {
      numberOfChannels: channels,
      length,
      sampleRate: this.sampleRate,
      duration: length / this.sampleRate,
      getChannelData: () => new Float32Array(length),
    }
  }
  createPeriodicWave(): unknown { return {} }
  createMediaStreamSource(): FakeNode { return new FakeNode() }
  resume(): Promise<void> { return Promise.resolve() }
  decodeAudioData(): Promise<unknown> { return Promise.resolve(this.createBuffer(1, 4410)) }
  startRendering(): Promise<unknown> {
    audioStats.offlineRenders++
    const length = 44100 * 4
    return Promise.resolve({
      numberOfChannels: 2,
      length,
      sampleRate: 44100,
      duration: 4,
      getChannelData: (channel: number) => {
        const data = new Float32Array(length)
        for (let i = 0; i < length; i++) data[i] = Math.sin(i / 25 + channel) * 0.35
        return data
      },
    })
  }
}

/** Instala los dobles de las APIs de audio en el ámbito global. */
export function installFakeAudio(): void {
  const g = globalThis as unknown as Record<string, unknown>
  g.AudioContext = FakeAudioContext
  g.OfflineAudioContext = FakeAudioContext
  const win = g.window as Record<string, unknown> | undefined
  if (win) {
    win.AudioContext = FakeAudioContext
    win.OfflineAudioContext = FakeAudioContext
  }
}

/** Silencia los avisos esperables de jsdom y React durante las pruebas. */
export function quietConsole(): void {
  const original = console.error
  console.error = (...args: unknown[]) => {
    const text = args.map(String).join(' ')
    if (/not implemented|Not implemented|not wrapped in act/i.test(text)) return
    original(...(args as []))
  }
}
