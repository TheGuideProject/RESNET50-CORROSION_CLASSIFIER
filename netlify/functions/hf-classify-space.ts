import type { Handler } from '@netlify/functions'
import { Client, handle_file } from '@gradio/client'

const SPACE_ID = process.env.HF_SPACE_ID || 'jacopo22295/RESNET50-CORROSION_CLASSIFIER_V1'
const API_NAME = process.env.SPACE_API_NAME || '/predict'
const HF_TOKEN = process.env.HF_API_KEY || ''

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }

    const { dataUrl } = JSON.parse(event.body || '{}')
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image'))
      return { statusCode: 400, body: 'dataUrl immagine mancante/invalid' }

    const base64 = dataUrl.split(',')[1]
    const buf = Buffer.from(base64, 'base64')
    const mime = dataUrl.substring(dataUrl.indexOf(':') + 1, dataUrl.indexOf(';'))
    const blob = new Blob([buf], { type: mime || 'image/png' })

    const app = await Client.connect(SPACE_ID, HF_TOKEN ? { hf_token: HF_TOKEN } : undefined)
    const result: any = await app.predict(API_NAME, [handle_file(blob)])

    let label = 'unknown'
    let topk: Array<{ label: string; score: number }> = []

    const data = Array.isArray(result?.data) ? result.data[0] ?? result.data : result?.data

    if (data?.label && Array.isArray(data.confidences)) {
      label = data.label
      topk = data.confidences.map((c: any) => ({ label: c.label, score: c.confidence ?? c.score ?? 0 }))
    } else if (Array.isArray(data)) {
      topk = data.map((d: any) => ({ label: d.label ?? String(d[0]), score: d.score ?? Number(d[1]) || 0 }))
      if (topk.length) label = topk.sort((a,b)=>b.score-a.score)[0].label
    } else if (data && typeof data === 'object') {
      const pairs = Object.entries(data).map(([k,v]) => ({ label: k, score: Number(v) || 0 }))
      topk = pairs.sort((a,b)=>b.score-a.score)
      if (topk.length) label = topk[0].label
    }

    const score = topk.find(t => t.label === label)?.score ?? (topk[0]?.score ?? 0)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label,
        score,
        topk: topk.slice(0, 5)
      })
    }
  } catch (err: any) {
    return { statusCode: 500, body: `Exception: ${err.message ?? String(err)}` }
  }
}


