/**
 * Ejecuta todas las pruebas: `npm test`
 *
 * No hace falta navegador: usa jsdom y dobles de las APIs de audio para poder
 * probar el motor, la transcripción, la notación y la interfaz en Node.
 */

import { installFakeAudio, quietConsole, setupDom, summary } from './harness'

async function main(): Promise<void> {
  console.log('🎵 Tabla Música · pruebas\n')
  quietConsole()
  await setupDom()
  installFakeAudio()

  const domain = await import('./domain.test')
  const transcribe = await import('./transcribe.test')
  const render = await import('./render.test')
  const app = await import('./app.test')

  domain.run()
  await transcribe.run()
  await render.run()
  await app.run()

  process.exit(summary() === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('Las pruebas fallaron al ejecutarse:', error)
  process.exit(1)
})
