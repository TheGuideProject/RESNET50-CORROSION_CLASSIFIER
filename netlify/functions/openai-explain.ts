const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

module.exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' })

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY
    const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
    if (!OPENAI_API_KEY) return json(500, { error: 'ConfigError', detail: 'OPENAI_API_KEY non configurata su Netlify' })

    const body = safeJSON(event.body)
    const {
      dataUrl = null,
      label = null,
      score = null,
      topk = null,
      question = '',
      allowed = []
    } = body

    const confPerc = typeof score === 'number' ? (score * 100).toFixed(1) + '%' : 'n/a'
    const hasImage = typeof dataUrl === 'string' && dataUrl.startsWith('data:image')

    const system = `
Sei un tecnico vernici/anticorrosione.
Rispondi SOLO su corrosione e cicli/prodotti PPG in generale (niente promesse legali).
Se c'è una label dal modello HF, usala come ipotesi di partenza con cautela (${label ?? 'nessuna'} @ ${confPerc}).
Classi ammesse: ${(allowed || []).join(', ') || 'non specificate'}.
Se non hai immagine o label, rispondi comunque alla domanda tecnica, mantieni i caveat dove servono.
Struttura:
1) Sintesi (1-2 frasi).
2) Cause tipiche (punti).
3) Verifiche/diagnostica (punti).
4) Trattamento/ciclo PPG (generico: preparazione, primer, intermedio/finito).
5) Sicurezza/limiti (1 riga).
Tono: tecnico, chiaro, zero fuffa.
`.trim()

    const userContent = []
    const header = `Domanda: ${question || '(nessuna)'}\nLabel HF: ${label ?? '(nessuna)'}\nConfidenza: ${confPerc}\nTopK: ${topk ? JSON.stringify(topk) : '(n/a)'}`
    userContent.push({ type: 'text', text: header })
    if (hasImage) {
      userContent.push({ type: 'image_url', image_url: { url: dataUrl } })
    }

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
          { role: 'user', content: userContent }
        ]
      })
    })

    if (!resp.ok) {
      let detail = null
      try { detail = await resp.json() } catch { detail = await resp.text() }
      return json(resp.status, { error: 'OpenAIAPIError', detail })
    }

    const data = await resp.json()
    const answer = data?.choices?.[0]?.message?.content ?? 'Nessuna risposta utile.'
    return json(200, { answer })
  } catch (err) {
    return json(500, { error: 'Unhandled', detail: err?.message || String(err) })
  }
}

function safeJSON(body) {
  try { return JSON.parse(body || '{}') } catch { return {} }
}
function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  }
}

