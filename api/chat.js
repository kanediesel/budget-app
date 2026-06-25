// Chat agent endpoint (auth-gated). Stateless: the client sends the conversation each time.
const express = require('express');
const { requireAuth } = require('../lib/session');
const chat = require('../lib/chat');

const router = express.Router();

router.post('/', requireAuth, async (req, res) => {
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'messages[] required' });
    const out = await chat.ask(messages);
    res.json(out);
  } catch (e) { console.error('chat POST', e); res.status(500).json({ error: e.message }); }
});

module.exports = router;
