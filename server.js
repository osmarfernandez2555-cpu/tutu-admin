// ═══════════════════════════════════════════════════════════════════════════
//  TUTU ADMIN — Panel de Adrián
// ───────────────────────────────────────────────────────────────────────────
//  GET  /                 panel (public/index.html)
//  POST /api/login        { pass }                       → { ok }
//  GET  /api/apps         (header x-admin-pass)          → lista de apps
//  POST /api/asistente    (header x-admin-pass) { mensajes:[{role,content}] }
//                                                        → { texto, acciones }
//  GET  /salud            → { ok, ia, referidos }
//
//  Variables de entorno (Railway → Variables):
//    ADMIN_PASS             contraseña del panel                         [obligatoria]
//    ANTHROPIC_API_KEY      key de Anthropic para el asistente           [obligatoria para el asistente]
//    ANTHROPIC_MODEL        modelo (def: claude-sonnet-5-5)
//    REFERIDOS_URL          def: https://tutu-referidos.up.railway.app
//    REFERIDOS_PANEL_PASS   la misma contraseña del panel de referidos   [para consultar referidos]
//    URL_<ID_DE_APP>        link de una app que en apps.json está vacío
//                           ej: URL_CALCULADOR, URL_CONSULTA_CREDITOS, URL_PANEL_APP_VENTAS
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express')
const path = require('path')
const crypto = require('crypto')
const fs = require('fs')

const app = express()
app.use(express.json({ limit: '200kb' }))

const PORT = process.env.PORT || 8080
const ADMIN_PASS = process.env.ADMIN_PASS || ''
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5'
const REFERIDOS_URL = (process.env.REFERIDOS_URL || 'https://tutu-referidos.up.railway.app').replace(/\/$/, '')

// ── apps ────────────────────────────────────────────────────────────────────
function envKey(id) { return 'URL_' + id.toUpperCase().replace(/[^A-Z0-9]/g, '_') }
function cargarApps() {
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'apps.json'), 'utf8'))
  return base.map(a => ({ ...a, url: process.env[envKey(a.id)] || a.url || '' }))
}

// ── auth ────────────────────────────────────────────────────────────────────
function passOk(p) {
  if (!ADMIN_PASS || typeof p !== 'string') return false
  const a = crypto.createHash('sha256').update(p).digest()
  const b = crypto.createHash('sha256').update(ADMIN_PASS).digest()
  return crypto.timingSafeEqual(a, b)
}
const intentos = new Map()
function auth(req, res, next) {
  if (!ADMIN_PASS) return res.status(503).json({ error: 'Falta configurar ADMIN_PASS en Railway' })
  if (!passOk(req.get('x-admin-pass'))) return res.status(401).json({ error: 'Contraseña incorrecta' })
  next()
}

app.post('/api/login', (req, res) => {
  if (!ADMIN_PASS) return res.status(503).json({ error: 'Falta configurar ADMIN_PASS en Railway' })
  const ip = req.ip
  const n = intentos.get(ip) || { c: 0, t: Date.now() }
  if (Date.now() - n.t > 10 * 60 * 1000) { n.c = 0; n.t = Date.now() }
  if (n.c >= 10) return res.status(429).json({ error: 'Demasiados intentos, esperá unos minutos' })
  if (!passOk(req.body && req.body.pass)) {
    n.c++; intentos.set(ip, n)
    return res.status(401).json({ error: 'Contraseña incorrecta' })
  }
  intentos.delete(ip)
  res.json({ ok: true })
})

app.get('/api/apps', auth, (req, res) => res.json(cargarApps()))

// ── herramientas del asistente ──────────────────────────────────────────────
async function consultarReferidos({ estado, buscar } = {}) {
  const pass = process.env.REFERIDOS_PANEL_PASS
  if (!pass) return { error: 'Falta la variable REFERIDOS_PANEL_PASS en el panel de Adrián.' }
  const qs = new URLSearchParams()
  if (estado) qs.set('estado', estado)
  if (buscar) qs.set('q', buscar)
  const r = await fetch(`${REFERIDOS_URL}/api/referidos?${qs}`, { headers: { 'x-referidos-pass': pass } })
  if (!r.ok) return { error: `El club de referidos respondió ${r.status}` }
  const data = await r.json()
  const lista = Array.isArray(data) ? data : (data.referidos || data.rows || data.items || [])
  const porEstado = {}
  for (const x of lista) porEstado[x.estado || 'sin_estado'] = (porEstado[x.estado || 'sin_estado'] || 0) + 1
  const vendidos = lista.filter(x => x.estado === 'vendido').length
  return {
    total: lista.length,
    por_estado: porEstado,
    a_pagar_pesos: vendidos * 100000,
    ultimos: lista.slice(0, 20).map(x => ({
      id: x.id, fecha: x.creado, estado: x.estado,
      comprador: x.comp_nombre, tel_comprador: x.comp_tel,
      refiere: x.ref_nombre, auto: [x.marca, x.modelo, x.anio].filter(Boolean).join(' '),
      presupuesto: x.presupuesto, financia: x.financia, entrega_usado: x.entrega,
      vendedor: x.vendedor || null
    }))
  }
}

function herramientas(apps) {
  return [
    {
      name: 'abrir_app',
      description: 'Abre una de las apps de Tutu en una pestaña nueva del navegador de Adrián. Usala cuando pida abrir, entrar, ir a, mostrar o ver una app.',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string', enum: apps.map(a => a.id), description: 'id de la app' } },
        required: ['id']
      }
    },
    {
      name: 'consultar_referidos',
      description: 'Trae los referidos del Club de Referidos (datos reales): totales por estado, total a pagar y los últimos cargados. Estados: nuevo, contactado, en_gestion, vendido, pagado, descartado.',
      input_schema: {
        type: 'object',
        properties: {
          estado: { type: 'string', enum: ['nuevo', 'contactado', 'en_gestion', 'vendido', 'pagado', 'descartado'] },
          buscar: { type: 'string', description: 'nombre o teléfono a buscar' }
        }
      }
    }
  ]
}

function sistema(apps) {
  const hoy = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Cordoba', dateStyle: 'full', timeStyle: 'short' })
  const lista = apps.map(a => `- ${a.id}: ${a.nombre} (${a.cat}) — ${a.desc}${a.url ? '' : ' [SIN LINK CARGADO]'}`).join('\n')
  return `Sos el asistente del panel de administración de Adrián, CEO de Tutu Automotores (concesionaria en Córdoba, Argentina; Polo 52, Autopista Córdoba–Rosario).
Hoy es ${hoy}.

Respondé en español rioplatense, corto y directo: Adrián muchas veces te habla por voz y escucha la respuesta, así que evitá tablas, markdown y listas largas. Máximo 3 o 4 oraciones salvo que pida detalle. Montos en pesos con punto de miles ($100.000).

Apps disponibles:
${lista}

Reglas:
- Si pide abrir o ver una app, usá abrir_app y confirmá en una frase. Si la app dice [SIN LINK CARGADO], no la abras: avisale que falta cargar el link (variable URL_<ID> en Railway).
- Para preguntas sobre referidos usá consultar_referidos; no inventes números.
- Para datos que no tenés (ventas del mes, stock, créditos de un cliente) decí qué app abrir para verlo y ofrecé abrirla.
- Equipo: Jorge jefe de ventas (Polo 52, vendedores Luciano, Ariel e Ismael); José vendedor San Francisco; Fabricio créditos; Ruth fotos y publicaciones; Mariana gestoría y entregas; Piki RRHH; Franco contable, taller y posventa; Cone peritaje, implementaciones y proyectos.`
}

async function llamarClaude(body) {
  const r = await fetch((process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  })
  const data = await r.json()
  if (!r.ok) throw new Error((data.error && data.error.message) || `Anthropic ${r.status}`)
  return data
}

app.post('/api/asistente', auth, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Falta ANTHROPIC_API_KEY en Railway' })
  try {
    const apps = cargarApps()
    const entrada = Array.isArray(req.body.mensajes) ? req.body.mensajes.slice(-20) : []
    const mensajes = entrada
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }))
    if (!mensajes.length || mensajes[mensajes.length - 1].role !== 'user') return res.status(400).json({ error: 'Mensaje vacío' })
    while (mensajes[0].role !== 'user') mensajes.shift()

    const acciones = []
    let texto = ''
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      const r = await llamarClaude({ model: MODEL, max_tokens: 1024, system: sistema(apps), tools: herramientas(apps), messages: mensajes })
      texto = r.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
      const usos = r.content.filter(b => b.type === 'tool_use')
      if (r.stop_reason !== 'tool_use' || !usos.length) break

      mensajes.push({ role: 'assistant', content: r.content })
      const resultados = []
      for (const u of usos) {
        let salida
        try {
          if (u.name === 'abrir_app') {
            const a = apps.find(x => x.id === u.input.id)
            if (!a) salida = { error: 'No existe esa app' }
            else if (!a.url) salida = { error: `${a.nombre} no tiene link cargado (variable ${envKey(a.id)})` }
            else { acciones.push({ tipo: 'abrir', id: a.id, url: a.url, nombre: a.nombre }); salida = { ok: true, abierta: a.nombre } }
          } else if (u.name === 'consultar_referidos') {
            salida = await consultarReferidos(u.input)
          } else salida = { error: 'Herramienta desconocida' }
        } catch (e) { salida = { error: e.message } }
        resultados.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(salida) })
      }
      mensajes.push({ role: 'user', content: resultados })
    }
    res.json({ texto: texto || 'Listo.', acciones })
  } catch (e) {
    console.error('❌ Asistente:', e.message)
    res.status(502).json({ error: e.message })
  }
})

app.get('/salud', (req, res) => res.json({
  ok: true,
  admin_pass: !!ADMIN_PASS,
  ia: !!process.env.ANTHROPIC_API_KEY,
  referidos: !!process.env.REFERIDOS_PANEL_PASS
}))

app.use(express.static(path.join(__dirname, 'public')))

app.listen(PORT, () => {
  console.log(`🚗 Tutu Admin corriendo en :${PORT}`)
  if (!ADMIN_PASS) console.log('⚠️  Falta ADMIN_PASS')
  if (!process.env.ANTHROPIC_API_KEY) console.log('⚠️  Falta ANTHROPIC_API_KEY (el asistente no va a responder)')
  if (!process.env.REFERIDOS_PANEL_PASS) console.log('⚠️  Falta REFERIDOS_PANEL_PASS (el asistente no va a poder leer referidos)')
})
