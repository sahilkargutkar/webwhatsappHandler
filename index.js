// Upsert or set a contact's name
app.post('/contacts/set-name', async (req, res) => {
  try {
    const { phone, name } = req.body
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })
    if (!phone || !name) return res.status(400).json({ error: 'phone and name are required' })

    await upsertContact(phone, { name })
    res.json({ ok: true })
  } catch (e) {
    console.error('Set-name error:', e)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// List contacts for dashboard
app.get('/contacts', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })
    const { search = '', limit = 50, page = 1 } = req.query
    const l = Math.min(Number(limit) || 50, 200)


    const p = Math.max(Number(page) || 1, 1)
    const from = (p - 1) * l
    const to = from + l - 1

    let query = supabase
      .from('contacts')
      .select('*', { count: 'exact' })
      .order('updated_at', { ascending: false })

    if (search) {
      query = query.or(`phone.ilike.%${search}%,name.ilike.%${search}%`)
    }

    const { data, error, count } = await query.range(from, to)
    if (error) return res.status(500).json({ error: error.message })
    res.json({ page: p, limit: l, total: count || 0, data })
  } catch (e) {
    console.error('Contacts route error:', e)
    res.status(500).json({ error: 'Internal server error' })
  }
})
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
    const normalized = {
      ...payload,
      // Normalize a single phone field to simplify querying
      phone: payload.kind === 'incoming' ? (payload.from || null) : (payload.to || null),
    }
    const { data, error } = await supabase
      .from('messages')
      .insert(normalized)
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
      name: update.name || null,
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
      
      // Update existing message status instead of inserting new row
      const { data: existingMessage } = await supabase
        .from('messages')
        .select('id, status')
        .eq('message_id', statuses.id)
        .single()
      
      if (existingMessage) {
        // Update the status of existing message
        const { error: updateError } = await supabase
          .from('messages')
          .update({ 
            status: statuses.status,
            updated_at: new Date().toISOString()
          })
          .eq('message_id', statuses.id)
        
        if (updateError) {
          console.error('Status update failed:', updateError)
        } else {
          console.log(`Updated message ${statuses.id} status: ${statuses.status}`)
        }
      } else {
        // No existing message, log as new status entry
        const statusLog = await logMessageToSupabase({
          kind: 'status',
          from: PHONE_NUMBER_ID,
          message_id: statuses.id,
          status: statuses.status,
          to: statuses.recipient_id || null,
          raw: value
        })
        if (!statusLog.ok) console.error('Status log failed:', statusLog.error)
      }
      
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
      // Prevent processing messages from ourselves (loop prevention)
      if (messages.from === PHONE_NUMBER_ID) {
        console.log('Ignoring message from self to prevent loop')
        return res.status(200).send('Webhook processed - self message ignored')
      }

      console.log(`Processing incoming message from ${messages.from}`)
      
      try {
        await handleIncomingMessage(messages)
      } catch (handleError) {
        console.error('Error handling incoming message:', handleError)
      }
      
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

// Track if contact already received welcome message
async function hasReceivedWelcome(phone) {
  if (!supabase) return false
  const { data } = await supabase
    .from('contacts')
    .select('last_kind')
    .eq('phone', phone)
    .single()
  return data?.last_kind === 'reply'
}

async function handleTextMessage(message) {
  console.log('handleTextMessage called for:', message.from)
  
  const alreadyWelcomed = await hasReceivedWelcome(message.from)
  console.log('Already welcomed:', alreadyWelcomed)
  
  if (!alreadyWelcomed) {
    // First message: send welcome
    console.log('Sending welcome message to:', message.from)
    try {
      await replyMessage(message.from, WELCOME_MESSAGE, message.id)
      console.log('Welcome message sent successfully')
    } catch (err) {
      console.error('Failed to send welcome message:', err.response?.data || err.message)
      throw err
    }
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
  } else {
    // Follow-up message: send call/website buttons
    console.log('Sending call/website buttons to:', message.from)
    try {
      await sendCallAndWebsiteButtons(message.from)
      console.log('Buttons sent successfully')
    } catch (err) {
      console.error('Failed to send buttons:', err.response?.data || err.message)
      throw err
    }
    const buttonLog = await logMessageToSupabase({
      kind: 'reply',
      to: message.from,
      from: PHONE_NUMBER_ID,
      type: 'interactive',
      body: 'Get in touch',
      reply_to_message_id: message.id
    })
    if (!buttonLog.ok) console.error('Button log failed:', buttonLog.error)
    await upsertContact(message.from, {
      last_message_id: message.id,
      last_body: 'Call/Website buttons sent',
      last_type: 'interactive',
      last_kind: 'reply',
      last_direction: 'reply',
      last_sender_id: PHONE_NUMBER_ID,
      last_recipient_phone: message.from,
    })
  }
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

async function sendCallAndWebsiteButtons(to) {
  return sendWhatsAppRequest('messages', {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      body: {
        text: 'Thanks for your interest! You can call me or visit my website.'
      },
      action: {
        name: 'cta_url',
        parameters: {
          display_text: 'Visit Website',
          url: 'https://sahilkargutkar.me'
        }
      }
    }
  })
}

// Broadcast message to all contacts or filtered subset
app.post('/broadcast', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })
    
    const { message, filter = {} } = req.body
    if (!message) return res.status(400).json({ error: 'message is required' })

    // Get all contacts (or filtered)
    let query = supabase
      .from('contacts')
      .select('phone, name')
      .order('updated_at', { ascending: false })

    // Optional filters
    if (filter.hasName) {
      query = query.not('name', 'is', null)
    }
    if (filter.lastMessageAfter) {
      query = query.gte('last_timestamp', filter.lastMessageAfter)
    }

    const { data: contacts, error } = await query
    if (error) return res.status(500).json({ error: error.message })

    if (!contacts || contacts.length === 0) {
      return res.json({ success: true, sent: 0, failed: 0, message: 'No contacts found' })
    }

    // Send messages with delay to avoid rate limits
    const results = []
    for (const contact of contacts) {
      try {
        await sendMessage(contact.phone, message)
        results.push({ phone: contact.phone, success: true })
        
        // Log broadcast message
        await logMessageToSupabase({
          kind: 'broadcast',
          to: contact.phone,
          from: PHONE_NUMBER_ID,
          type: 'text',
          body: message,
        })
        
        // Small delay to avoid rate limits (adjust as needed)
        await new Promise(resolve => setTimeout(resolve, 1000))
      } catch (err) {
        console.error(`Failed to send to ${contact.phone}:`, err.message)
        results.push({ phone: contact.phone, success: false, error: err.message })
      }
    }

    const sent = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    res.json({ 
      success: true, 
      sent, 
      failed, 
      total: contacts.length,
      details: results 
    })
  } catch (e) {
    console.error('Broadcast error:', e)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get broadcast-ready contacts count
app.get('/broadcast/preview', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })
    
    const { filter = {} } = req.query
    let query = supabase
      .from('contacts')
      .select('phone, name, last_timestamp', { count: 'exact' })

    if (filter.hasName === 'true') {
      query = query.not('name', 'is', null)
    }
    if (filter.lastMessageAfter) {
      query = query.gte('last_timestamp', filter.lastMessageAfter)
    }

    const { data, error, count } = await query
    if (error) return res.status(500).json({ error: error.message })

    res.json({ 
      count: count || 0,
      contacts: data?.slice(0, 10) || [] // Preview first 10
    })
  } catch (e) {
    console.error('Broadcast preview error:', e)
    res.status(500).json({ error: 'Internal server error' })
  }
})

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
      // Use normalized phone field primarily; fallback to from/to for older rows
      query = query.or(`phone.eq.${phone},from.eq.${phone},to.eq.${phone}`)
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