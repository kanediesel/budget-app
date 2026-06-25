// Chat tab: conversational agent over the whole budget (2019 → now).
// Stateless server — we keep the conversation here and send it each turn.
const $ = (s) => document.querySelector(s);
let history = [];   // [{role:'user'|'assistant', content}]
let busy = false;

const SUGGESTIONS = [
  'How much did we spend on groceries this year?',
  'Eating out: this year vs last year?',
  'What were our 5 biggest expenses last month?',
  'How much have we spent on vacations since 2019?',
];

export function openChat() {
  $('#chatModal').hidden = false;
  if (!history.length) renderSuggestions();
  setTimeout(() => $('#chatInput')?.focus(), 50);
}
const closeChat = () => { $('#chatModal').hidden = true; };

function renderSuggestions() {
  const host = $('#chatSuggest'); if (!host) return;
  host.innerHTML = '';
  if (history.length) return;
  SUGGESTIONS.forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = s;
    b.addEventListener('click', () => { $('#chatInput').value = s; submit(); });
    host.appendChild(b);
  });
}

function bubble(role, content, opts = {}) {
  const el = document.createElement('div');
  el.className = 'msg ' + (role === 'user' ? 'me' : 'bot') + (opts.pending ? ' pending' : '');
  el.innerHTML = `<div class="msg-text"></div>`;
  el.querySelector('.msg-text').textContent = content;
  if (opts.sources && opts.sources.length) {
    const src = document.createElement('div'); src.className = 'msg-src';
    src.innerHTML = 'Sources: ' + opts.sources.map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a>`).join(' · ');
    el.appendChild(src);
  }
  $('#chatLog').appendChild(el);
  $('#chatLog').scrollTop = $('#chatLog').scrollHeight;
  return el;
}
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function submit() {
  if (busy) return;
  const input = $('#chatInput');
  const text = (input.value || '').trim();
  if (!text) return;
  input.value = '';
  $('#chatSuggest').innerHTML = '';
  busy = true; $('#chatSend').disabled = true;

  history.push({ role: 'user', content: text });
  bubble('user', text);
  const thinking = bubble('bot', 'Thinking…', { pending: true });

  try {
    const r = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'request failed');
    thinking.remove();
    bubble('bot', data.reply, { sources: data.sources });
    history.push({ role: 'assistant', content: data.reply });
  } catch (e) {
    thinking.remove();
    bubble('bot', 'Sorry — ' + e.message);
  } finally {
    busy = false; $('#chatSend').disabled = false; input.focus();
  }
}

$('#chatForm')?.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
$('#chatCancel')?.addEventListener('click', closeChat);
