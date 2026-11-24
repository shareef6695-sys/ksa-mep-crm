import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Every VITE_* variable is compiled into the public bundle. Only these two may be exposed; anything that looks
// like a secret (service role, secret, password, token, private key, database URL) stops the build.
const BROWSER_SAFE = new Set(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])
const SENSITIVE = /(SERVICE|SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE|DATABASE_URL|DB_URL|ENC_KEY|AUTH)/i
function guardBrowserEnv(mode) {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('VITE_'))) }
  const bad = Object.keys(env).filter((k) => !BROWSER_SAFE.has(k) && SENSITIVE.test(k))
  if (bad.length) throw new Error(`Refusing to build: ${bad.join(', ')} would be exposed to the browser. Keep secrets server-side.`)
  if (/^sb_secret_/.test(env.VITE_SUPABASE_ANON_KEY || '') || /service_role/.test(decodeJwt(env.VITE_SUPABASE_ANON_KEY))) {
    throw new Error('Refusing to build: VITE_SUPABASE_ANON_KEY is a service-role / secret key.')
  }
}
function decodeJwt(key = '') {
  try { return Buffer.from(key.split('.')[1], 'base64url').toString() } catch { return '' }
}

export default defineConfig(({ mode }) => {
  guardBrowserEnv(mode)
  return {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          // libraries change rarely: separate chunks stay cached across app releases
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            supabase: ['@supabase/supabase-js'],
          },
        },
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.{js,jsx}', 'supabase/tests/**/*.test.ts'],
    },
  }
})
