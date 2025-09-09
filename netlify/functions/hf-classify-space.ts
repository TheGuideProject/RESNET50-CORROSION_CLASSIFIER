import type { Handler } from '@netlify/functions'
import { Client, handle_file } from '@gradio/client'

const SPACE_ID = process.env.HF_SPACE_ID || 'jacopo22295/RESNET50-CORROSION_CLASSIFIER_V1'
const API_NAME = process.env.SPACE_API_NAME || '/predict'
const HF_TOKEN = process.env.HF_API_KEY || '' // se lo Space è privato

function json(statusCode: number, obj: any) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  }
}

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' })

    const { dataUrl } = JSON.parse(event.body || '{}')
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
      return json(400, { error: 'dataUrl immagine mancante/invalid' })
    }

    // dataURL -> Blob
    const base64 = dataUrl.split(',')[1]
    const buf = Buffer.from(base64, 'base64')
    const mime = dataUrl.substring(dataUrl.indexOf(':') + 1, dataUrl.indexOf(';')) || 'image/png'
    const blob = new Blob([buf], { type: mime })

    // Connetti allo Space
    let app
    try {
      app = await Client.connect(SPACE_ID, HF_TOKEN ? { hf_token: HF_TOKEN } : undefined)
    } catch (e: any) {
      return json(502, { error: 'ConnectError', detail: e?.message || String(e), space: SPACE_ID })
    }

    // Esegui predict
    let result: any
    try {
      result = await app.predict(API_NAME, [handle_file(blob)])
    } catch (e: any) {
      return json(502, { error: 'PredictError', detail: e?.message || String(e), api: API_NAME })
    }

    // Normalizza output
    let label = 'unknown'
    let topk: Array<{ label: string; score: number }> = []
    const data = Array.isArray(result?.data) ? (result.data[0] ?? result.data) : result?.data

    if (data?.label && Array.isArray(data.confidences)) {
      label = data.label
      topk = data.confidences.map((c: any) => ({ label: c.label, score: c.confidence ?? c.score ?? 0 }))
    } else if (Array.isArray(data)) {
      topk = data.map((d: any) => ({ label: d.label ?? String(d[0]), score: d.score ?? Number(d[1]) || 0 }))
      if (topk.length) label = topk.sort((a,b)=>b.score-a.score)[0].label
    } else if (data && typeof data === 'object') {
      const pairs = Object.entries(data).map(([k,v]) => ({ label: String(k), score: Number(v) || 0 }))
      topk = pairs.sort((a,b)=>b.score-a.score)
      if (topk.length) label = topk[0].label
    } else {
      return json(500, { error: 'UnexpectedSpaceOutput', raw: result })
    }

    const score = topk.find(t => t.label === label)?.score ?? (topk[0]?.score ?? 0)
    return json(200, { label, score, topk: topk.slice(0, 5) })
  } catch (err: any) {
    return json(500, { error: 'Unhandled', detail: err?.message || String(err) })
  }
}
