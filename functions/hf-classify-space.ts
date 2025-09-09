
// Netlify Function TS che chiama il tuo Space Hugging Face via @gradio/client
// Dynamic import per evitare problemi di moduli

type JSONValue = any;

function safeJSON(body: string | null | undefined): Record<string, unknown> {
  try { return JSON.parse(body || '{}') } catch { return {} }
}

function json(statusCode: number, obj: JSONValue) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  }
}

export const handler = async (event: any) => {
  try {
    if (event && event.httpMethod !== 'POST') {
      return json(405, { error: 'Method Not Allowed' })
    }

    const payload = safeJSON(event?.body)
    const dataUrl = typeof payload['dataUrl'] === 'string' ? String(payload['dataUrl']) : ''
    if (!(dataUrl && dataUrl.startsWith('data:image'))) {
      return json(400, { error: 'dataUrl immagine mancante/invalid' })
    }

    // dataURL -> Blob
    const base64 = dataUrl.split(',')[1]
    const buf = Buffer.from(base64, 'base64')
    const mime = (() => {
      const i = dataUrl.indexOf(':')
      const j = dataUrl.indexOf(';')
      return (i >= 0 && j > i) ? dataUrl.substring(i + 1, j) : 'image/png'
    })()

    // Node 18+ ha Blob globale. Fallback da 'buffer' se serve.
    let BlobCtor: any = (typeof Blob !== 'undefined') ? Blob : null
    if (!BlobCtor) {
      const bufferMod = await import('buffer')
      BlobCtor = (bufferMod as any).Blob
    }
    const blob = new BlobCtor([buf], { type: mime })

    // Dynamic import del client Gradio
    const gradio = await import('@gradio/client')
    const Client = (gradio as any).Client
    const handle_file = (gradio as any).handle_file

    // Env
    const SPACE_ID = process.env.HF_SPACE_ID ? String(process.env.HF_SPACE_ID) : 'jacopo22295/RESNET50-CORROSION_CLASSIFIER_V1'
    const HF_TOKEN = process.env.HF_API_KEY ? String(process.env.HF_API_KEY) : ''
    const API_NAME = process.env.SPACE_API_NAME ? String(process.env.SPACE_API_NAME) : '/predict'

    let app: any
    try {
      if (HF_TOKEN) app = await Client.connect(SPACE_ID, { hf_token: HF_TOKEN })
      else app = await Client.connect(SPACE_ID)
    } catch (e: any) {
      return json(502, { error: 'ConnectError', detail: e?.message || String(e), space: SPACE_ID })
    }

    let result: any
    try {
      result = await app.predict(API_NAME, [handle_file(blob)])
    } catch (e: any) {
      return json(502, { error: 'PredictError', detail: e?.message || String(e), api: API_NAME })
    }

    // Normalizzazione output (gr.Label e varianti)
    let label = 'unknown'
    let topk: Array<{ label: string; score: number }> = []

    const data = Array.isArray(result?.data) ? (result.data[0] ?? result.data) : result?.data

    if (data && typeof data === 'object' && 'label' in data && Array.isArray((data as any).confidences)) {
      label = String((data as any).label)
      topk = (data as any).confidences.map((c: any) => ({
        label: String(c.label),
        score: Number((c.confidence ?? c.score) || 0)
      }))
    } else if (Array.isArray(data)) {
      topk = (data as any[]).map((d: any) => {
        const lbl = (d && typeof d === 'object' && 'label' in d) ? String(d.label) : String(d?.[0])
        const sc = (d && typeof d === 'object' && 'score' in d) ? Number(d.score) : Number(d?.[1]) || 0
        return { label: lbl, score: sc }
      })
      if (topk.length > 0) {
        topk.sort((a, b) => b.score - a.score)
        label = topk[0].label
      }
    } else if (data && typeof data === 'object') {
      const pairs = Object.entries(data as Record<string, unknown>).map(([k, v]) => ({
        label: String(k),
        score: Number(v) || 0
      }))
      pairs.sort((a, b) => b.score - a.score)
      topk = pairs
      if (pairs.length > 0) label = pairs[0].label
    } else {
      return json(500, { error: 'UnexpectedSpaceOutput', raw: result })
    }

    const topScore = topk.find(t => t.label === label)
    const score = topScore ? topScore.score : (topk[0] ? topk[0].score : 0)

    return json(200, { label, score, topk: topk.slice(0, 5) })
  } catch (err: any) {
    return json(500, { error: 'Unhandled', detail: err?.message || String(err) })
  }
}
