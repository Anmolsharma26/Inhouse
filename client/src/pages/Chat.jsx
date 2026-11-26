import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import api, { errMsg } from '../api/client';
import { getSocket } from '../socket';

const REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '🙏'];

const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDay = (d) => {
  const day = new Date(d); const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
  if (day.toDateString() === today.toDateString()) return 'Today';
  if (day.toDateString() === y.toDateString()) return 'Yesterday';
  return day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: day.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
};
const fmtListTime = (d) => (new Date(d).toDateString() === new Date().toDateString() ? fmtTime(d) : new Date(d).toLocaleDateString([], { day: 'numeric', month: 'short' }));
const isImage = (a) => a.mime?.startsWith('image/');

// Emit with an acknowledgement, rejecting on server error or timeout
const emitAck = (event, payload) => new Promise((resolve, reject) => {
  const s = getSocket();
  if (!s?.connected) return reject(new Error('Not connected to the chat server'));
  s.timeout(8000).emit(event, payload, (err, res) => {
    if (err) return reject(new Error('Chat server did not respond'));
    res?.ok ? resolve(res) : reject(new Error(res?.error || 'Request failed'));
  });
});

export default function Chat() {
  const me = useSelector((s) => s.auth.user);
  const [convs, setConvs] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [sending, setSending] = useState(false);
  const [online, setOnline] = useState(new Set());
  const [typing, setTyping] = useState({});
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(() => !!getSocket()?.connected);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [pickerFor, setPickerFor] = useState(null);

  const activeRef = useRef(null);
  const listRef = useRef();
  const inputRef = useRef();
  const fileRef = useRef();
  const typingTimer = useRef();
  const scrollMode = useRef('bottom'); // 'bottom' | 'keep' | null
  const prevHeight = useRef(0);

  const loadConvs = useCallback(() => api.get('/chat/conversations').then((r) => setConvs(r.data)).catch((e) => setError(errMsg(e))), []);
  useEffect(() => { loadConvs(); api.get('/users').then((r) => setUsers(r.data)).catch(() => {}); }, [loadConvs]);
  useEffect(() => { activeRef.current = active; }, [active]);

  const addMessage = useCallback((m) => {
    setMessages((p) => (p.some((x) => x.id === m.id) ? p.map((x) => (x.id === m.id ? m : x)) : [...p, m]));
  }, []);

  // ---------- Realtime ----------
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onConnect = () => { setConnected(true); setError(''); if (activeRef.current) s.emit('conversation:join', activeRef.current.id); loadConvs(); };
    const onDisconnect = () => setConnected(false);
    const onConnectError = (e) => {
      setConnected(false);
      if (e.message === 'Unauthorized') { localStorage.removeItem('token'); window.location.href = '/login'; }
    };
    const onNew = (m) => {
      if (m.conversationId === activeRef.current?.id) {
        scrollMode.current = 'bottom';
        addMessage(m);
        if (m.senderId !== me.id && document.visibilityState === 'visible') s.emit('message:read', { conversation: m.conversationId });
      }
      setTyping((p) => ({ ...p, [`${m.conversationId}:${m.senderId}`]: undefined }));
      loadConvs();
    };
    const onUpd = (m) => setMessages((p) => p.map((x) => (x.id === m.id ? m : x)));
    const onRead = ({ conversation, userId, at }) => {
      if (conversation !== activeRef.current?.id || userId === me.id) return;
      setMessages((p) => p.map((x) => (x.senderId === me.id && new Date(x.createdAt) <= new Date(at) ? { ...x, readByOthers: true } : x)));
    };
    const onPresList = (ids) => setOnline(new Set(ids));
    const onPres = ({ userId, online: on }) => setOnline((p) => { const n = new Set(p); on ? n.add(userId) : n.delete(userId); return n; });
    const onTyping = ({ conversation, userId, name, typing: t }) => setTyping((p) => ({ ...p, [`${conversation}:${userId}`]: t ? name : undefined }));
    const onConvNew = () => loadConvs();

    const handlers = { connect: onConnect, disconnect: onDisconnect, connect_error: onConnectError, 'message:new': onNew, 'message:updated': onUpd, 'message:read': onRead, 'presence:list': onPresList, 'presence:update': onPres, typing: onTyping, 'conversation:new': onConvNew };
    Object.entries(handlers).forEach(([e, h]) => s.on(e, h));
    setConnected(s.connected);
    return () => Object.entries(handlers).forEach(([e, h]) => s.off(e, h));
  }, [addMessage, loadConvs, me.id]);

  // ---------- Scrolling ----------
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (scrollMode.current === 'bottom') el.scrollTop = el.scrollHeight;
    else if (scrollMode.current === 'keep') el.scrollTop = el.scrollHeight - prevHeight.current; // stay in place after loading older
    scrollMode.current = null;
  }, [messages]);

  // ---------- Actions ----------
  const open = async (c) => {
    if (!c) return;
    setActive(c); setReplyTo(null); setEditing(null); setText(''); setFile(null); setError(''); setPickerFor(null);
    setLoadingConv(true);
    try {
      const { data } = await api.get(`/chat/conversations/${c.id}/messages`);
      if (activeRef.current && activeRef.current.id !== c.id) return;
      scrollMode.current = 'bottom';
      setMessages(data.messages); setHasMore(data.hasMore);
      getSocket()?.emit('conversation:join', c.id);
      getSocket()?.emit('message:read', { conversation: c.id });
      await api.post(`/chat/conversations/${c.id}/read`);
      loadConvs();
    } catch (e) { setError(errMsg(e)); } finally { setLoadingConv(false); }
    inputRef.current?.focus();
  };

  const loadOlder = async () => {
    if (!active || !messages.length || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const { data } = await api.get(`/chat/conversations/${active.id}/messages`, { params: { before: messages[0].id } });
      prevHeight.current = listRef.current.scrollHeight;
      scrollMode.current = 'keep';
      setMessages((p) => [...data.messages, ...p]); setHasMore(data.hasMore);
    } catch (e) { setError(errMsg(e)); } finally { setLoadingOlder(false); }
  };

  const send = async (e) => {
    e.preventDefault();
    if (!active || sending) return;
    const body = text.trim();

    if (editing) {
      if (!body) return;
      try { await emitAck('message:edit', { id: editing.id, text: body }); setEditing(null); setText(''); }
      catch (err) { setError(err.message); }
      return;
    }

    if (!body && !file) return;
    setSending(true); setError('');
    try {
      let attachments;
      if (file) {
        const fd = new FormData(); fd.append('file', file);
        attachments = [(await api.post('/chat/upload', fd)).data];
      }
      const payload = { conversation: active.id, text: body, attachments, replyTo: replyTo?.id };
      let saved;
      if (getSocket()?.connected) saved = (await emitAck('message:send', payload)).message;
      else saved = (await api.post(`/chat/conversations/${active.id}/messages`, payload)).data; // fallback: still saved in MySQL
      scrollMode.current = 'bottom';
      if (saved) addMessage(saved);
      setText(''); setFile(null); setReplyTo(null);
      if (fileRef.current) fileRef.current.value = '';
      getSocket()?.emit('typing', { conversation: active.id, typing: false });
      loadConvs();
    } catch (err) { setError(err.response ? errMsg(err) : err.message); }
    finally { setSending(false); inputRef.current?.focus(); }
  };

  const onType = (v) => {
    setText(v);
    if (!active || editing) return;
    getSocket()?.emit('typing', { conversation: active.id, typing: true });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => getSocket()?.emit('typing', { conversation: active.id, typing: false }), 1500);
  };

  const startEdit = (m) => { setEditing(m); setReplyTo(null); setText(m.text); inputRef.current?.focus(); };
  const cancelCompose = () => { setEditing(null); setReplyTo(null); setText(''); };
  const remove = async (m) => {
    if (!window.confirm('Delete this message?')) return;
    try { await emitAck('message:delete', { id: m.id }); } catch (err) { setError(err.message); }
  };
  const react = async (m, emoji) => {
    setPickerFor(null);
    try { await emitAck('message:react', { id: m.id, emoji }); } catch (err) { setError(err.message); }
  };

  const startDirect = async (userId) => {
    try {
      const { data } = await api.post('/chat/conversations', { type: 'direct', members: [Number(userId)] });
      await loadConvs(); open(data);
    } catch (e) { setError(errMsg(e)); }
  };

  // ---------- Search ----------
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); return; }
    const t = setTimeout(() => api.get('/chat/search', { params: { q } }).then((r) => setResults(r.data)).catch((e) => setError(errMsg(e))), 300);
    return () => clearTimeout(t);
  }, [query]);

  // ---------- Render helpers ----------
  const userName = (id) => users.find((u) => u.id === id)?.name || 'Someone';
  const otherOf = (c) => c.type === 'direct' && c.members?.find((m) => m.id !== me.id);
  const label = (c) => (c.type === 'direct' ? otherOf(c)?.name || 'Direct message' : c.name);
  const typers = Object.entries(typing).filter(([k, v]) => v && k.startsWith(`${active?.id}:`)).map(([, v]) => v);
  const byId = Object.fromEntries(messages.map((m) => [m.id, m]));
  const sections = [['Channels', 'channel'], ['Groups', 'group'], ['Direct messages', 'direct']];

  return (
    <div className="grid h-[calc(100vh-3rem)] gap-4 md:grid-cols-[19rem_1fr]">
      {/* ---------- Sidebar ---------- */}
      <aside className={`card flex min-h-0 flex-col overflow-hidden p-0 ${active ? 'hidden md:flex' : 'flex'}`}>
        <div className="space-y-2 border-b p-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Chat</h2>
            <span className={`flex items-center gap-1 text-xs ${connected ? 'text-green-600' : 'text-amber-600'}`}>
              <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-amber-500'}`} />{connected ? 'Live' : 'Reconnecting…'}
            </span>
          </div>
          <input className="input" placeholder="Search messages…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="flex gap-2">
            <select className="input" value="" onChange={(e) => e.target.value && startDirect(e.target.value)}>
              <option value="">+ Direct message…</option>
              {users.filter((u) => u.id !== me.id && u.isActive !== false).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <button type="button" className="btn-ghost shrink-0" onClick={() => setShowNew(true)} title="New group or channel">+ Group</button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {results ? (
            <div>
              <p className="px-3 py-2 text-xs font-semibold uppercase text-slate-500">{results.length} result{results.length === 1 ? '' : 's'}</p>
              {results.map((m) => {
                const c = convs.find((x) => x.id === m.conversationId);
                return (
                  <button key={m.id} onClick={() => { setQuery(''); open(c); }} className="block w-full border-b px-3 py-2 text-left text-sm hover:bg-slate-50">
                    <p className="text-xs text-slate-500">{c ? label(c) : 'Conversation'} · {m.sender?.name} · {fmtListTime(m.createdAt)}</p>
                    <p className="truncate">{m.text}</p>
                  </button>
                );
              })}
            </div>
          ) : sections.map(([title, type]) => {
            const list = convs.filter((c) => c.type === type);
            if (!list.length) return null;
            return (
              <div key={type}>
                <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase text-slate-500">{title}</p>
                <ul>
                  {list.map((c) => {
                    const other = otherOf(c);
                    return (
                      <li key={c.id}>
                        <button onClick={() => open(c)} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${active?.id === c.id ? 'bg-brand-50' : ''}`}>
                          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
                            {type === 'channel' ? '#' : label(c).slice(0, 1).toUpperCase()}
                            {other && <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${online.has(other.id) ? 'bg-green-500' : 'bg-slate-300'}`} />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className={`truncate ${c.unread ? 'font-semibold' : ''}`}>{label(c)}</span>
                              {c.lastMessage && <span className="shrink-0 text-[10px] text-slate-400">{fmtListTime(c.lastMessage.createdAt)}</span>}
                            </span>
                            <span className="flex items-center justify-between gap-2">
                              <span className="truncate text-xs text-slate-500">
                                {c.lastMessage ? `${c.lastMessage.senderId === me.id ? 'You' : c.lastMessage.senderName.split(' ')[0]}: ${c.lastMessage.text}` : 'No messages yet'}
                              </span>
                              {c.unread > 0 && <span className="shrink-0 rounded-full bg-brand-500 px-2 text-xs text-white">{c.unread}</span>}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {!results && convs.length === 0 && <p className="p-4 text-sm text-slate-500">No conversations yet. Start a direct message above.</p>}
        </div>
      </aside>

      {/* ---------- Conversation ---------- */}
      <section className={`card min-h-0 flex-col overflow-hidden p-0 ${active ? 'flex' : 'hidden md:flex'}`}>
        {!active ? <p className="m-auto text-slate-500">Select a conversation</p> : (
          <>
            <header className="flex items-center gap-2 border-b p-3">
              <button className="btn-ghost px-2 py-1 md:hidden" onClick={() => setActive(null)}>←</button>
              <div className="min-w-0">
                <p className="truncate font-medium">{label(active)}</p>
                <p className="truncate text-xs text-slate-500">
                  {active.type === 'direct'
                    ? (online.has(otherOf(active)?.id) ? 'Online' : 'Offline')
                    : `${active.members?.length || 0} members · ${active.members?.map((m) => m.name.split(' ')[0]).join(', ')}`}
                </p>
              </div>
            </header>

            <div ref={listRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3" onClick={() => setPickerFor(null)}>
              {hasMore && (
                <div className="pb-2 text-center">
                  <button className="btn-ghost py-1 text-xs" onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? 'Loading…' : 'Load older messages'}</button>
                </div>
              )}
              {loadingConv && <p className="text-center text-sm text-slate-400">Loading…</p>}
              {!loadingConv && messages.length === 0 && <p className="mt-8 text-center text-sm text-slate-400">No messages yet. Say hello 👋</p>}

              {messages.map((m, i) => {
                const mine = m.senderId === me.id;
                const prev = messages[i - 1];
                const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
                const grouped = !newDay && prev?.senderId === m.senderId && new Date(m.createdAt) - new Date(prev.createdAt) < 5 * 60000;
                const parent = m.replyToId && (byId[m.replyToId] || m.replyTo);
                const reactions = Object.entries((m.reactions || []).reduce((a, r) => { (a[r.emoji] ||= []).push(r.userId); return a; }, {}));
                return (
                  <div key={m.id}>
                    {newDay && <div className="my-3 flex items-center gap-2 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200" />{fmtDay(m.createdAt)}<span className="h-px flex-1 bg-slate-200" /></div>}
                    <div className={`group flex items-end gap-1 ${mine ? 'flex-row-reverse' : ''} ${grouped ? '' : 'mt-2'}`}>
                      <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${mine ? 'bg-brand-500 text-white' : 'bg-slate-100'}`}>
                        {!mine && !grouped && active.type !== 'direct' && <p className="text-xs font-semibold opacity-70">{m.sender?.name}</p>}
                        {parent && (
                          <div className={`mb-1 rounded border-l-2 px-2 py-1 text-xs ${mine ? 'border-white/70 bg-white/15' : 'border-brand-500 bg-white'}`}>
                            <p className="font-semibold">{userName(parent.senderId)}</p>
                            <p className="truncate opacity-80">{parent.deletedAt ? 'Message deleted' : parent.text || '📎 Attachment'}</p>
                          </div>
                        )}
                        {m.deletedAt ? <em className="opacity-60">Message deleted</em> : <>
                          {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                          {m.attachments?.map((a) => isImage(a)
                            ? <a key={a.url} href={a.url} target="_blank" rel="noreferrer"><img src={a.url} alt={a.name} className="mt-1 max-h-48 rounded" /></a>
                            : <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="mt-1 block underline">📎 {a.name}</a>)}
                        </>}
                        <p className="mt-1 text-right text-[10px] opacity-60">
                          {fmtTime(m.createdAt)}{m.editedAt && !m.deletedAt && ' · edited'}{mine && !m.deletedAt && (m.readByOthers ? ' ✓✓' : ' ✓')}
                        </p>
                        {reactions.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {reactions.map(([emoji, ids]) => (
                              <button key={emoji} onClick={() => react(m, emoji)} title={ids.map(userName).join(', ')}
                                className={`rounded-full border px-1.5 text-xs ${ids.includes(me.id) ? 'border-brand-500 bg-brand-50 text-slate-800' : 'border-slate-300 bg-white text-slate-700'}`}>
                                {emoji} {ids.length}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {!m.deletedAt && (
                        <div className="relative flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                          <button className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100" title="React" onClick={(e) => { e.stopPropagation(); setPickerFor(pickerFor === m.id ? null : m.id); }}>😊</button>
                          <button className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100" title="Reply" onClick={() => { setReplyTo(m); setEditing(null); inputRef.current?.focus(); }}>↩</button>
                          {mine && <button className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100" title="Edit" onClick={() => startEdit(m)}>✎</button>}
                          {mine && <button className="rounded px-1 text-xs text-red-500 hover:bg-red-50" title="Delete" onClick={() => remove(m)}>🗑</button>}
                          {pickerFor === m.id && (
                            <div className={`absolute bottom-6 z-10 flex gap-1 rounded-full border bg-white px-2 py-1 shadow ${mine ? 'right-0' : 'left-0'}`} onClick={(e) => e.stopPropagation()}>
                              {REACTIONS.map((r) => <button key={r} className="text-base hover:scale-125" onClick={() => react(m, r)}>{r}</button>)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="h-5 px-3 text-xs text-slate-500">{typers.length > 0 && `${typers.join(', ')} ${typers.length > 1 ? 'are' : 'is'} typing…`}</p>
            {error && <p className="flex justify-between px-3 text-xs text-red-600">{error}<button onClick={() => setError('')}>✕</button></p>}

            {(replyTo || editing || file) && (
              <div className="mx-3 flex items-center justify-between rounded bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
                <span className="truncate">
                  {editing ? 'Editing message' : replyTo ? <>Replying to <b>{userName(replyTo.senderId)}</b>: {replyTo.text || '📎 Attachment'}</> : null}
                  {file && <>{(editing || replyTo) && ' · '}📎 {file.name}</>}
                </span>
                <button className="ml-2" onClick={() => { cancelCompose(); setFile(null); if (fileRef.current) fileRef.current.value = ''; }}>✕</button>
              </div>
            )}

            <form onSubmit={send} className="flex gap-2 border-t p-3">
              {!editing && (
                <label className="btn-ghost cursor-pointer" title="Attach file">📎
                  <input ref={fileRef} type="file" hidden onChange={(e) => setFile(e.target.files[0] || null)} />
                </label>
              )}
              <input ref={inputRef} className="input" placeholder={editing ? 'Edit message' : 'Type a message'} value={text} maxLength={5000}
                onChange={(e) => onType(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && cancelCompose()} />
              <button className="btn" disabled={sending || (!text.trim() && !file)}>{editing ? 'Save' : sending ? 'Sending…' : 'Send'}</button>
            </form>
          </>
        )}
      </section>

      {showNew && <NewConversation me={me} users={users} onClose={() => setShowNew(false)}
        onCreated={async (c) => { setShowNew(false); await loadConvs(); open(c); }} />}
    </div>
  );
}

function NewConversation({ me, users, onClose, onCreated }) {
  const [type, setType] = useState('group');
  const [name, setName] = useState('');
  const [members, setMembers] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const canChannel = me.role === 'admin' || me.role === 'manager';
  const toggle = (id) => setMembers((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const { data } = await api.post('/chat/conversations', { type, name: type === 'channel' && !name.startsWith('#') ? `# ${name}` : name, members });
      onCreated(data);
    } catch (e2) { setErr(errMsg(e2)); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <form className="card w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3 className="font-semibold">New {type}</h3>
        {canChannel && (
          <div className="flex gap-2 text-sm">
            {['group', 'channel'].map((t) => (
              <label key={t} className="flex items-center gap-1"><input type="radio" checked={type === t} onChange={() => setType(t)} />{t === 'group' ? 'Private group' : 'Channel'}</label>
            ))}
          </div>
        )}
        <input className="input" placeholder={type === 'channel' ? 'Channel name (e.g. design)' : 'Group name'} value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
        <div className="max-h-60 space-y-1 overflow-y-auto rounded border p-2">
          {users.filter((u) => u.id !== me.id && u.isActive !== false).map((u) => (
            <label key={u.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={members.includes(u.id)} onChange={() => toggle(u.id)} />{u.name}
              <span className="text-xs text-slate-400">{u.designation || u.role}</span>
            </label>
          ))}
        </div>
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy || !name.trim() || !members.length}>Create</button>
        </div>
      </form>
    </div>
  );
}
