
// Netlify Function TS per chiamare OpenAI Chat Completions con o senza immagine
type JSONValue = any;

function safeJSON(body: string | null | undefined): Record<string, unknown> {
  try { return JSON.parse(body || '{}') } catch { return {} }
}
function json(statusCode: number, obj: JSONValue) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) }
}

export const handler = async (event: any) => {
  try {
    if (event && event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' })

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY ? String(process.env.OPENAI_API_KEY) : ''
    const MODEL = process.env.OPENAI_MODEL ? String(process.env.OPENAI_MODEL) : 'gpt-4o-mini'
    if (!OPENAI_API_KEY) return json(500, { error: 'ConfigError', detail: 'OPENAI_API_KEY non configurata su Netlify' })

    const body = safeJSON(event?.body)
    const dataUrl = typeof body['dataUrl'] === 'string' ? String(body['dataUrl']) : null
    const label = typeof body['label'] === 'string' ? String(body['label']) : null
    const score = typeof body['score'] === 'number' ? Number(body['score']) : null
    const topk = Array.isArray(body['topk']) ? body['topk'] as any[] : null
    const question = typeof body['question'] === 'string' ? String(body['question']) : ''
    const allowed = Array.isArray(body['allowed']) ? body['allowed'] as string[] : []

    const confPerc = (typeof score === 'number') ? (score * 100).toFixed(1) + '%' : 'n/a'
    const hasImage = (typeof dataUrl === 'string') && dataUrl.startsWith('data:image')

    const classes = (Array.isArray(allowed) && allowed.length > 0) ? allowed.join(', ') : 'non specificate'

    const system =
`Sei un tecnico vernici/anticorrosione.
Rispondi SOLO su corrosione e cicli/prodotti PPG in generale (niente promesse legali).
Se c'è una label dal modello HF, usala come ipotesi di partenza con cautela (${label ?? 'nessuna'} @ ${confPerc}).
Classi ammesse: ${classes}.
Se non hai immagine o label, rispondi comunque alla domanda tecnica, mantieni i caveat dove servono.
Struttura:
1) Sintesi (1-2 frasi).
2) Cause tipiche (punti).
3) Verifiche/diagnostica (punti).
4) Trattamento/ciclo PPG (generico: preparazione, primer, intermedio/finito).
5) Sicurezza/limiti (1 riga).
Tono: tecnico, chiaro, zero fuffa.`

    const userContent: any[] = []
    const header =
      `Domanda: ${question || '(nessuna)'}\n` +
      `Label HF: ${label ?? '(nessuna)'}\n` +
      `Confidenza: ${confPerc}\n` +
      `TopK: ${topk ? JSON.stringify(topk) : '(n/a)'}`
    userContent.push({ type: 'text', text: header })
    if (hasImage) {
      userContent.push({ type: 'image_url', image_url: { url: dataUrl } })
    }

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + OPENAI_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent as any }
        ]
      })
    })

    if (!resp.ok) {
      let detail: any = null
      try { detail = await resp.json() } catch { detail = await resp.text() }
      return json(resp.status, { error: 'OpenAIAPIError', detail })
    }

    const data = await resp.json()
    const answer = (data?.choices?.[0]?.message?.content) ?? 'Nessuna risposta utile.'
    return json(200, { answer })
  } catch (err: any) {
    return json(500, { error: 'Unhandled', detail: err?.message || String(err) })
  }
}
