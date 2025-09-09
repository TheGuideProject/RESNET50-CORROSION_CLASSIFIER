import type { Handler } from '@netlify/functions'

const HF_API_KEY = process.env.HF_API_KEY
const MODEL = 'jacopo22295/RESNET50-CORROSION_CLASSIFIER_V1'

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' }
    }
    if (!HF_API_KEY) {
      return { statusCode: 500, body: 'HF_API_KEY non configurata' }
    }

    const { dataUrl } = JSON.parse(event.body || '{}')
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
      return { statusCode: 400, body: 'dataUrl immagine mancante/invalid' }
    }

    const base64 = dataUrl.split(',')[1]
    const imgBuf = Buffer.from(base64, 'base64')

    const resp = await fetch(`https://api-inference.huggingface.co/models/${MODEL}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        'Content-Type': 'application/octet-stream'
      },
      body: imgBuf
    })

    if (!resp.ok) {
      const txt = await resp.text()
      return { statusCode: resp.status, body: `HF API error: ${txt}` }
    }

    const data = await resp.json() as Array<{ label: string; score: number }>
    if (!Array.isArray(data) || data.length === 0) {
      return { statusCode: 500, body: 'Risposta HF vuota o non valida' }
    }

    const topSorted = data.sort((a,b) => b.score - a.score)
    const top1 = topSorted[0]

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: top1.label,
        score: top1.score,
        topk: topSorted.slice(0, Math.min(5, topSorted.length))
      })
    }
  } catch (err: any) {
    return { statusCode: 500, body: `Exception: ${err.message ?? String(err)}` }
  }
}import type { Handler } from '@netlify/functions'
import { Client, handle_file } from '@gradio/client'

const SPACE_ID = process.env.HF_SPACE_ID || 'jacopo22295/RESNET50-CORROSION_CLASSIFIER_V1' // cambia se diverso
const API_NAME = process.env.SPACE_API_NAME || '/predict' // controlla "View API" nello Space
const HF_TOKEN = process.env.HF_API_KEY || '' // opzionale (solo per Space privati)

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }

    const { dataUrl } = JSON.parse(event.body || '{}')
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image'))
      return { statusCode: 400, body: 'dataUrl immagine mancante/invalid' }

    // dataURL -> Blob
    const base64 = dataUrl.split(',')[1]
    const buf = Buffer.from(base64, 'base64')
    const mime = dataUrl.substring(dataUrl.indexOf(':') + 1, dataUrl.indexOf(';'))
    const blob = new Blob([buf], { type: mime || 'image/png' })

    // Connetti allo Space
    const app = await Client.connect(SPACE_ID, HF_TOKEN ? { hf_token: HF_TOKEN } : undefined)

    // Predici (l'endpoint di default spesso è '/predict'; verifica nel link "View API")
    const result: any = await app.predict(API_NAME, [handle_file(blob)])

    // Normalizza varie forme di output comuni di gr.Label:
    // - {label: "xxx", confidences: [{label, confidence}, ...]}
    // - {"label1": prob, "label2": prob, ...}
    // - [{"label":"xxx","score":0.9}, ...]
    let label = 'unknown'
    let topk: Array<{ label: string; score: number }> = []

    const data = Array.isArray(result?.data) ? result.data[0] ?? result.data : result?.data

    if (data?.label && Array.isArray(data.confidences)) {
      label = data.label
      topk = data.confidences.map((c: any) => ({ label: c.label, score: c.confidence ?? c.score ?? 0 }))
    } else if (Array.isArray(data)) {
      // es. lista di {label, score}
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

