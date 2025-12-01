const express = require('express')
const axios = require('axios')
const { createClient } = require('@supabase/supabase-js')

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
      return
    }
    // Insert into table `messages` (adjust if you use a different name)
    const { error } = await supabase
      .from('messages')
      .insert(payload)

    if (error) {
      console.error('Supabase insert error:', error)
    }
  } catch (e) {
    console.error('Supabase logging failed:', e)
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
      await logMessageToSupabase({
        kind: 'status',
        message_id: statuses.id,
        status: statuses.status,
        raw: value
      })
    }

    if (messages) {
      await handleIncomingMessage(messages)
      await logMessageToSupabase({
        kind: 'incoming',
        from: messages.from,
        type: messages.type,
        body: messages.text?.body || null,
        interactive: messages.interactive || null,
        message_id: messages.id,
        timestamp: messages.timestamp || null,
        raw: messages
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
  await logMessageToSupabase({
    kind: 'reply',
    to: message.from,
    type: 'text',
    body: WELCOME_MESSAGE,
    reply_to_message_id: message.id
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
    await logMessageToSupabase({
      kind: 'reply',
      to: message.from,
      type: 'text',
      body: `You selected the option with ID ${reply.id} - Title ${reply.title}`,
      interactive_selection: reply
    })
  }

  if (interactive.type === 'button_reply') {
    const reply = interactive.button_reply
    await sendMessage(
      message.from, 
      `You selected the button with ID ${reply.id} - Title ${reply.title}`
    )
    await logMessageToSupabase({
      kind: 'reply',
      to: message.from,
      type: 'text',
      body: `You selected the button with ID ${reply.id} - Title ${reply.title}`,
      interactive_selection: reply
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