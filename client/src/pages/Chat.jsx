import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import api from '../api/client';
import { getSocket } from '../socket';

export default function Chat() {
  const me = useSelector((s) => s.auth.user);
  const [convs, setConvs] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [online, setOnline] = useState(new Set());
  const [typing, setTyping] = useState({});
  const [users, setUsers] = useState([]);
  const [file, setFile] = useState(null);
  const activeRef = useRef(null);
  const bottom = useRef();
  const typingTimer = useRef();

  const loadConvs = () => api.get('/chat/conversations').then((r) => setConvs(r.data));
  useEffect(() => { loadConvs(); api.get('/users').then((r) => setUsers(r.data)); }, []);
  useEffect(() => { activeRef.current = active; }, [active]);

  // Realtime listeners
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onNew = (m) => {
      if (m.conversationId === activeRef.current?.id) {
        setMessages((p) => [...p, m]);
        s.emit('message:read', { conversation: m.conversationId });
      }
      loadConvs();
    };
    const onUpd = (m) => setMessages((p) => p.map((x) => (x.id === m.id ? m : x)));
    // someone read the conversation -> mark my sent messages as read
    const onRead = ({ conversation, at }) => {
      if (conversation !== activeRef.current?.id) return;
      setMessages((p) => p.map((x) => (new Date(x.createdAt) <= new Date(at) ? { ...x, readByOthers: true } : x)));
    };
    const onPresList = (ids) => setOnline(new Set(ids));
    const onPres = ({ userId, online: on }) => setOnline((p) => { const n = new Set(p); on ? n.add(userId) : n.delete(userId); return n; });
    const onTyping = ({ conversation, userId, name, typing: t }) =>
      setTyping((p) => ({ ...p, [`${conversation}:${userId}`]: t ? name : undefined }));
    s.on('message:new', onNew); s.on('message:updated', onUpd); s.on('message:read', onRead);
    s.on('presence:list', onPresList); s.on('presence:update', onPres); s.on('typing', onTyping);
    return () => { s.off('message:new', onNew); s.off('message:updated', onUpd); s.off('message:read', onRead); s.off('presence:list', onPresList); s.off('presence:update', onPres); s.off('typing', onTyping); };
  }, []);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const open = async (c) => {
    setActive(c);
    const { data } = await api.get(`/chat/conversations/${c.id}/messages`);
    setMessages(data);
    getSocket()?.emit('conversation:join', c.id);
    getSocket()?.emit('message:read', { conversation: c.id });
    await api.post(`/chat/conversations/${c.id}/read`);
    loadConvs();
  };

  const send = async (e) => {
    e.preventDefault();
    if (!active || (!text.trim() && !file)) return;
    let attachments;
    if (file) {
      const fd = new FormData(); fd.append('file', file);
      attachments = [(await api.post('/chat/upload', fd)).data];
    }
    getSocket().emit('message:send', { conversation: active.id, text, attachments });
    setText(''); setFile(null);
    getSocket().emit('typing', { conversation: active.id, typing: false });
  };

  const onType = (v) => {
    setText(v);
    getSocket()?.emit('typing', { conversation: active.id, typing: true });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => getSocket()?.emit('typing', { conversation: active.id, typing: false }), 1500);
  };

  const startDirect = async (userId) => {
    const { data } = await api.post('/chat/conversations', { type: 'direct', members: [userId] });
    await loadConvs();
    open(data);
  };

  const label = (c) => c.type === 'direct' ? c.members?.find((m) => m.id !== me.id)?.name || 'Direct' : c.name;
  const typers = Object.entries(typing).filter(([k, v]) => v && k.startsWith(`${active?.id}:`)).map(([, v]) => v);

  return (
    <div className="grid h-[calc(100vh-3rem)] gap-4 md:grid-cols-[18rem_1fr]">
      <div className="card flex flex-col overflow-hidden p-0">
        <div className="border-b p-3">
          <select className="input" value="" onChange={(e) => e.target.value && startDirect(e.target.value)}>
            <option value="">+ New direct message…</option>
            {users.filter((u) => u.id !== me.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {convs.map((c) => {
            const other = c.type === 'direct' && c.members.find((m) => m.id !== me.id);
            return (
              <li key={c.id}>
                <button onClick={() => open(c)} className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 ${active?.id === c.id ? 'bg-brand-50' : ''}`}>
                  <span className="flex items-center gap-2">
                    {other && <span className={`h-2 w-2 rounded-full ${online.has(other.id) ? 'bg-green-500' : 'bg-slate-300'}`} />}
                    {label(c)}
                  </span>
                  {c.unread > 0 && <span className="rounded-full bg-brand-500 px-2 text-xs text-white">{c.unread}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="card flex flex-col overflow-hidden p-0">
        {!active ? <p className="m-auto text-slate-500">Select a conversation</p> : (
          <>
            <div className="border-b p-3 font-medium">{label(active)}</div>
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {messages.map((m) => {
                const mine = m.senderId === me.id;
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : ''}`}>
                    <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${mine ? 'bg-brand-500 text-white' : 'bg-slate-100'}`}>
                      {!mine && <p className="text-xs font-semibold opacity-70">{m.sender?.name}</p>}
                      {m.deletedAt ? <em className="opacity-60">Message deleted</em> : <>
                        {m.text}
                        {m.attachments?.map((a) => <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="block underline">📎 {a.name}</a>)}
                      </>}
                      <p className="mt-1 text-right text-[10px] opacity-60">
                        {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {m.editedAt && ' · edited'}{mine && (m.readByOthers ? ' ✓✓' : ' ✓')}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottom} />
            </div>
            <p className="h-5 px-3 text-xs text-slate-500">{typers.length > 0 && `${typers.join(', ')} typing…`}</p>
            <form onSubmit={send} className="flex gap-2 border-t p-3">
              <label className="btn-ghost cursor-pointer">📎<input type="file" hidden onChange={(e) => setFile(e.target.files[0])} /></label>
              <input className="input" placeholder={file ? file.name : 'Type a message'} value={text} onChange={(e) => onType(e.target.value)} />
              <button className="btn">Send</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
