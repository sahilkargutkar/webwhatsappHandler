const express = require('express')
const axios = require('axios')
const cors = require('cors')
const { createClient } = require('@supabase/supabase-js')
const dotenv = require('dotenv')

// Load env vars from .env.local (fallback to process env if missing)
dotenv.config({ path: '.env.local' })

// Environment variables
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID
const PORT = process.env.PORT || 5444
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_KEY

// Initialize Supabase
const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null

async function logMessageToSupabase(payload) {
  try {
    if (!supabase) {
      console.warn('Supabase not configured: set SUPABASE_URL and SUPABASE_KEY')
      return { ok: false, error: 'supabase_not_configured' }
    }
    const { data, error } = await supabase
      .from('messages')
      .insert(payload)
      .select()

    if (error) {
      console.error('Supabase insert error:', error)
      return { ok: false, error }
    }
    return { ok: true, data }
  } catch (e) {
    console.error('Supabase logging failed:', e)
    return { ok: false, error: e }
  }
}

async function upsertContact(phone, update) {
  try {
    if (!supabase) return
    const now = new Date().toISOString()
    const payload = {
      phone,
      last_message_id: update.last_message_id || null,
      last_body: update.last_body || null,
      last_type: update.last_type || null,
      last_kind: update.last_kind || null,
      last_direction: update.last_direction || null,
      last_sender_id: update.last_sender_id || null,
      last_recipient_phone: update.last_recipient_phone || null,
      last_timestamp: update.last_timestamp || now,
      updated_at: now,
    }
    const { error } = await supabase
      .from('contacts')
      .upsert(payload, { onConflict: 'phone' })
      .select()

    if (error) {
      console.error('Supabase contact upsert error:', error)
    } else {
      // Increment total_messages separately to avoid overwriting
      await supabase.rpc('increment_contact_messages', { p_phone: phone })
        .catch(err => console.warn('RPC increment failed (define function):', err.message))
    }
  } catch (e) {
    console.error('Supabase contact upsert failed:', e)
  }
}

// Welcome message template
const WELCOME_MESSAGE = `Hi! 👋

Thanks for reaching out.

I help businesses grow with:

🌐 Website Development
🎨 UI/UX & Website Design
🚀 SEO & Search Ranking Improvement
📈 Google Analytics & Tracking Setup
⚙️ Website Speed Optimization
💼 E-commerce & Custom Web Solutions

How can I help you today? 🙂`

const app = express()
app.use(express.json())
// Allow your Next.js frontend to consume this API
app.use(cors({
  origin: '*',
  methods: ['GET','POST'],
}))

// Routes
app.get('/', (req, res) => {
  res.send('Whatsapp with Node.js and Webhooks')
})

// Webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode']
  const challenge = req.query['hub.challenge']
  const token = req.query['hub.verify_token']

  if (mode && token === WEBHOOK_VERIFY_TOKEN) {
    res.status(200).send(challenge)
  } else {
    res.sendStatus(403)
  }
})

// Send custom message endpoint
app.post('/send-message', async (req, res) => {
  const { to, message } = req.body

  if (!to || !message) {
    return res.status(400).json({ 
      error: 'Phone number (to) and message are required' 
    })
  }

  try {
    await sendMessage(to, message)
    res.status(200).json({ 
      success: true, 
      message: 'Message sent successfully' 
    })
  } catch (error) {
    console.error('Error sending message:', error.response?.data || error.message)
    res.status(500).json({ 
      error: 'Failed to send message', 
      details: error.response?.data || error.message 
    })
  }
})

// Webhook handler
app.post('/webhook', async (req, res) => {
  console.log('Incoming Webhook:', JSON.stringify(req.body, null, 2))
  
  try {
    const { entry } = req.body

    if (!entry || entry.length === 0) {
      return res.status(400).send('Invalid Request')
    }

    const changes = entry[0].changes

    if (!changes || changes.length === 0) {
      return res.status(400).send('Invalid Request')
    }

    const value = changes[0].value
    const statuses = value.statuses?.[0]
    const messages = value.messages?.[0]

    if (statuses) {
      handleMessageStatus(statuses)
      const statusLog = await logMessageToSupabase({
        kind: 'status',
        from: PHONE_NUMBER_ID,
        message_id: statuses.id,
        status: statuses.status,
        to: statuses.recipient_id || null,
        raw: value
      })
      if (!statusLog.ok) console.error('Status log failed:', statusLog.error)
      await upsertContact(statuses.recipient_id || statuses.from || messages?.from || null, {
        last_message_id: statuses.id,
        last_body: statuses.status,
        last_type: 'status',
        last_kind: 'status',
        last_direction: 'incoming',
        last_sender_id: PHONE_NUMBER_ID,
        last_recipient_phone: statuses.recipient_id || null,
      })
    }

    if (messages) {
      await handleIncomingMessage(messages)
      const incomingLog = await logMessageToSupabase({
        kind: 'incoming',
        from: messages.from,
        to: messages.to || null,
        type: messages.type,
        body: messages.text?.body || null,
        interactive: messages.interactive || null,
        message_id: messages.id,
        timestamp: messages.timestamp || null,
        raw: messages
      })
      if (!incomingLog.ok) console.error('Incoming log failed:', incomingLog.error)
      await upsertContact(messages.from, {
        last_message_id: messages.id,
        last_body: messages.text?.body || null,
        last_type: messages.type,
        last_kind: 'incoming',
        last_direction: 'incoming',
        last_sender_id: messages.from,
        last_recipient_phone: null,
        last_timestamp: messages.timestamp ? new Date(Number(messages.timestamp) * 1000).toISOString() : undefined,
      })
    }
    
    res.status(200).send('Webhook processed')
  } catch (error) {
    console.error('Webhook error:', error)
    res.status(500).send('Internal server error')
  }
})

// Message handlers
function handleMessageStatus(status) {
  console.log(`MESSAGE STATUS UPDATE:
    ID: ${status.id}
    STATUS: ${status.status}`)
}

async function handleIncomingMessage(message) {
  console.log('Message type:', message.type)
  console.log('Message body:', message.text?.body)
  console.log('Full message:', JSON.stringify(message, null, 2))

  if (message.type === 'text') {
    await handleTextMessage(message)
  }

  if (message.type === 'interactive') {
    await handleInteractiveMessage(message)
  }
}

async function handleTextMessage(message) {
  console.log('Sending welcome message...')
  await replyMessage(message.from, WELCOME_MESSAGE, message.id)
  const replyLog = await logMessageToSupabase({
    kind: 'reply',
    to: message.from,
    from: PHONE_NUMBER_ID,
    type: 'text',
    body: WELCOME_MESSAGE,
    reply_to_message_id: message.id
  })
  if (!replyLog.ok) console.error('Reply log failed:', replyLog.error)
  await upsertContact(message.from, {
    last_message_id: message.id,
    last_body: WELCOME_MESSAGE,
    last_type: 'text',
    last_kind: 'reply',
    last_direction: 'reply',
    last_sender_id: PHONE_NUMBER_ID,
    last_recipient_phone: message.from,
  })
}

async function handleInteractiveMessage(message) {
  const { interactive } = message

  if (interactive.type === 'list_reply') {
    const reply = interactive.list_reply
    await sendMessage(
      message.from, 
      `You selected the option with ID ${reply.id} - Title ${reply.title}`
    )
    const listReplyLog = await logMessageToSupabase({
      kind: 'reply',
      to: message.from,
      from: PHONE_NUMBER_ID,
      type: 'text',
      body: `You selected the option with ID ${reply.id} - Title ${reply.title}`,
      interactive_selection: reply
    })
    if (!listReplyLog.ok) console.error('List-reply log failed:', listReplyLog.error)
    await upsertContact(message.from, {
      last_message_id: message.id,
      last_body: `You selected the option with ID ${reply.id} - Title ${reply.title}`,
      last_type: 'text',
      last_kind: 'reply',
      last_direction: 'reply',
      last_sender_id: PHONE_NUMBER_ID,
      last_recipient_phone: message.from,
    })
  }

  if (interactive.type === 'button_reply') {
    const reply = interactive.button_reply
    await sendMessage(
      message.from, 
      `You selected the button with ID ${reply.id} - Title ${reply.title}`
    )
    const btnReplyLog = await logMessageToSupabase({
      kind: 'reply',
      to: message.from,
      from: PHONE_NUMBER_ID,
      type: 'text',
      body: `You selected the button with ID ${reply.id} - Title ${reply.title}`,
      interactive_selection: reply
    })
    if (!btnReplyLog.ok) console.error('Button-reply log failed:', btnReplyLog.error)
    await upsertContact(message.from, {
      last_message_id: message.id,
      last_body: `You selected the button with ID ${reply.id} - Title ${reply.title}`,
      last_type: 'text',
      last_kind: 'reply',
      last_direction: 'reply',
      last_sender_id: PHONE_NUMBER_ID,
      last_recipient_phone: message.from,
    })
  }
}

// WhatsApp API helper functions
async function sendWhatsAppRequest(endpoint, data) {
  try {
    const response = await axios({
      url: `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/${endpoint}`,
      method: 'post',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      data: JSON.stringify(data)
    })
    return response.data
  } catch (error) {
    console.error(`WhatsApp API Error (${endpoint}):`, error.response?.data || error.message)
    throw error
  }
}

async function sendMessage(to, body) {
  return sendWhatsAppRequest('messages', {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body }
  })
}

async function replyMessage(to, body, messageId) {
  return sendWhatsAppRequest('messages', {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body },
    context: { message_id: messageId }
  })
}

async function sendList(to) {
  return sendWhatsAppRequest('messages', {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: {
        type: 'text',
        text: 'Message Header'
      },
      body: {
        text: 'This is a interactive list message'
      },
      footer: {
        text: 'This is the message footer'
      },
      action: {
        button: 'Tap for the options',
        sections: [
          {
            title: 'First Section',
            rows: [
              {
                id: 'first_option',
                title: 'First option',
                description: 'This is the description of the first option'
              },
              {
                id: 'second_option',
                title: 'Second option',
                description: 'This is the description of the second option'
              }
            ]
          },
          {
            title: 'Second Section',
            rows: [
              {
                id: 'third_option',
                title: 'Third option'
              }
            ]
          }
        ]
      }
    }
  })
}

async function sendReplyButtons(to) {
  return sendWhatsAppRequest('messages', {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      header: {
        type: 'text',
        text: 'Message Header'
      },
      body: {
        text: 'This is a interactive reply buttons message'
      },
      footer: {
        text: 'This is the message footer'
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: 'first_button',
              title: 'First Button'
            }
          },
          {
            type: 'reply',
            reply: {
              id: 'second_button',
              title: 'Second Button'
            }
          }
        ]
      }
    }
  })
}

// Start server
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`)
})

// List all messages (with basic pagination and filtering)
app.get('/logs', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured' })
    }

    const { phone, kind, type, limit = 50, page = 1 } = req.query
    const l = Math.min(Number(limit) || 50, 200)
    const p = Math.max(Number(page) || 1, 1)
    const from = (p - 1) * l
    const to = from + l - 1

    let query = supabase
      .from('messages')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (phone) {
      query = query.or(`from.eq.${phone},to.eq.${phone}`)
    }
    if (kind) {
      query = query.eq('kind', kind)
    }
    if (type) {
      query = query.eq('type', type)
    }

    const { data, error, count } = await query.range(from, to)
    if (error) {
      return res.status(500).json({ error: error.message })
    }

    res.json({ page: p, limit: l, total: count || 0, data })
  } catch (e) {
    console.error('Logs route error:', e)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Note: No dashboard route. This backend only serves data via JSON.