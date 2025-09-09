import React, { useState, useRef } from 'react'

type HFResult = {
  label: string
  score: number
  topk: Array<{ label: string; score: number }>
}

type ExplainResult = {
  answer: string
}

const ALLOWED = [
  'crevice_corrosion',
  'erosion_corrosion',
  'galvanic_corrosion',
  'mic_corrosion',
  'no_corrosion',
  'pitting_corrosion',
  'stress_corrosion',
  'under_insulation_corrosion',
  'uniform_corrosion'
]

export default function App() {
  const [imgDataUrl, setImgDataUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [hf, setHf] = useState<HFResult | null>(null)
  const [explain, setExplain] = useState<ExplainResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [question, setQuestion] = useState<string>('')

  const fileInput = useRef<HTMLInputElement | null>(null)

  function toDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const url = await toDataUrl(f)
    setImgDataUrl(url)
    setHf(null)
    setExplain(null)
    setError(null)
  }

  async function onCaptureClick() {
    fileInput.current?.setAttribute('capture', 'environment')
    fileInput.current?.click()
  }

  const onAnalyze = async () => {
    try {
      if (!imgDataUrl) {
        setError('Carica o scatta una foto prima di analizzare.')
        return
      }
      setLoading(true)
      setError(null)
      setHf(null)
      setExplain(null)

      const hfRes = await fetch('/.netlify/functions/hf-classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: imgDataUrl })
      })
      if (!hfRes.ok) {
        const t = await hfRes.text()
        throw new Error(`HF error: ${t}`)
      }
      const hfJson = (await hfRes.json()) as HFResult
      setHf(hfJson)

      const oaRes = await fetch('/.netlify/functions/openai-explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl: imgDataUrl,
          label: hfJson.label,
          score: hfJson.score,
          topk: hfJson.topk,
          question,
          allowed: ALLOWED
        })
      })
      if (!oaRes.ok) {
        const t = await oaRes.text()
        throw new Error(`OpenAI error: ${t}`)
      }
      const oaJson = (await oaRes.json()) as ExplainResult
      setExplain(oaJson)
    } catch (e: any) {
      setError(e.message ?? 'Errore sconosciuto.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '24px' }}>
      <h1 style={{ margin: 0, fontSize: 28 }}>Corrosion Classifier + AI Explain</h1>
      <p style={{ opacity: 0.8, marginTop: 8 }}>
        Carica o scatta una foto. Il modello HF restituisce tipo di corrosione e confidenza.
        OpenAI aggiunge contesto tecnico coerente.
      </p>

      <div style={container}>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          onChange={onPickFile}
          style={{ display: 'none' }}
        />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => fileInput.current?.click()} style={btn}>Carica immagine</button>
          <button onClick={onCaptureClick} style={btn}>Scatta foto</button>
          <button onClick={onAnalyze} style={{ ...btn, background: '#22c55e' }}>
            {loading ? 'Analizzo…' : 'Analizza immagine'}
          </button>
        </div>

        {imgDataUrl && (
          <img
            src={imgDataUrl}
            alt="preview"
            style={{ width: '100%', maxHeight: 420, objectFit: 'contain', borderRadius: 8, background: '#091126' }}
          />
        )}

        <label style={{ fontSize: 14, opacity: 0.9 }}>
          Domanda facoltativa per l’AI (es. “che ciclo PPG potrei usare?”)
        </label>
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Scrivi qui la tua domanda…"
          style={ta}
        />

        {error && (
          <div style={{ background:'#3b1a1a', border:'1px solid #6b1f1f', color:'#ffd7d7', padding:12, borderRadius:8 }}>
            Errore: {error}
          </div>
        )}

        {hf && (
          <div style={card}>
            <h3 style={{ marginTop: 0 }}>Risultato modello HF</h3>
            <p><b>Label:</b> {hf.label}</p>
            <p><b>Confidenza:</b> {(hf.score * 100).toFixed(1)}%</p>
            <details>
              <summary>Top-K</summary>
              <ul>
                {hf.topk.map((t, i) => (
                  <li key={i}>{t.label}: {(t.score * 100).toFixed(1)}%</li>
                ))}
              </ul>
            </details>
          </div>
        )}

        {explain && (
          <div style={card}>
            <h3 style={{ marginTop: 0 }}>Commento tecnico (OpenAI)</h3>
            <div style={{ whiteSpace: 'pre-wrap' }}>{explain.answer}</div>
          </div>
        )}

        <footer style={{ opacity: 0.7, fontSize: 12, marginTop: 8 }}>
          Classi ammesse: {ALLOWED.join(', ')}
        </footer>
      </div>
    </div>
  )
}

const container: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: 16,
  background: '#0f1a33',
  padding: 16,
  borderRadius: 12,
  border: '1px solid #1f2b4a'
}

const btn: React.CSSProperties = {
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  padding: '10px 14px',
  borderRadius: 10,
  cursor: 'pointer'
}

const ta: React.CSSProperties = {
  width: '100%',
  minHeight: 90,
  borderRadius: 10,
  border: '1px solid #1f2b4a',
  background: '#0b1220',
  color: '#e6eefc',
  padding: 10
}

const card: React.CSSProperties = {
  background: '#0b1220',
  border: '1px solid #1f2b4a',
  borderRadius: 12,
  padding: 12
}
