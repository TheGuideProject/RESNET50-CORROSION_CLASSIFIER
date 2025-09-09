import type { Handler } from '@netlify/functions'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const MODEL = 'gpt-4o-mini'

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' }
    }
    if (!OPENAI_API_KEY) {
      return { statusCode: 500, body: 'OPENAI_API_KEY non configurata' }
    }

    const body = JSON.parse(event.body || '{}')
    const { dataUrl, label, score, topk, question, allowed } = body

    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
      return { statusCode: 400, body: 'dataUrl immagine mancante/invalid' }
    }
    if (!label || typeof label !== 'string') {
      return { statusCode: 400, body: 'label mancante' }
    }

    const system = `
Sei un tecnico vernici/anticorrosione. 
Limiti: parla SOLTANTO di corrosione e cicli/prodotti PPG in generale (senza promesse legali).
Dati del modello: label="${label}", confidenza=${(score ?? 0)*100}%.
Classi ammesse: ${(allowed || []).join(', ')}.
Se l'immagine non è chiara o la confidenza < 55%, avvisa con cautela e proponi conferma visiva.
Struttura risposta, in italiano:
1) Sintesi del difetto (1-2 frasi).
2) Possibili cause tipiche (punti).
3) Controlli/diagnostica rapida (punti).
4) Trattamento e ciclo PPG consigliato (generico, es. preparazione, primer e finitura; evita brand claim e specifiche obbligatorie).
5) Note di sicurezza e limiti (1 riga).
Se presente una domanda dell'utente, rispondi in coda.
Tono: tecnico, chiaro, zero fuffa.
`

    const userParts = [
      { type: 'text', text: `Label HF: ${label}\nConfidenza: ${(score ?? 0)*100}%\nTopK: ${JSON.stringify(topk ?? [])}\nDomanda utente: ${question || '(nessuna)'}\n` },
      { type: 'image_url', image_url: { url: dataUrl } }
    ]

    const resp = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userParts as any }
        ]
      })
    })

    if (!resp.ok) {
      const t = await resp.text()
      return { statusCode: resp.status, body: `OpenAI error: ${t}` }
    }

    const data = await resp.json()
    const answer = data.choices?.[0]?.message?.content ?? 'Nessuna risposta utile.'

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer })
    }
  } catch (err: any) {
    return { statusCode: 500, body: `Exception: ${err.message ?? String(err)}` }
  }
}
