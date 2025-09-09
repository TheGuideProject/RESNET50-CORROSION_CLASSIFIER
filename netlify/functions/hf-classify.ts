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
}
