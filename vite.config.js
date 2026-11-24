import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { browserEnvProblems } from './scripts/browser-env-guard.mjs'

function guardBrowserEnv(mode) {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
  const problems = browserEnvProblems(env)
  if (problems.length) throw new Error(`Refusing to build: ${problems.join(' ')}`)
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
