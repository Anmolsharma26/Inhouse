import { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import api, { errMsg } from '../api/client';
import { getSocket } from '../socket';

const STATUS = { pending: 'Pending', in_progress: 'In Progress', completed: 'Completed' };
const PRIORITY_STYLE = { high: 'bg-red-100 text-red-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-slate-100 text-slate-600' };

const dateOnly = (d) => (d ? String(d).slice(0, 10) : '');
const fmtDate = (d) => (d ? new Date(dateOnly(d) + 'T00:00:00').toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtWhen = (d) => new Date(d).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const isOverdue = (t) => t.dueDate && t.status !== 'completed' && new Date(dateOnly(t.dueDate) + 'T23:59:59') < new Date();
const initials = (n = '') => n.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

async function uploadFile(file) {
  const fd = new FormData(); fd.append('file', file);
  return (await api.post('/chat/upload', fd)).data; // shared upload endpoint -> {url,name,mime,size}
}

export default function Tasks() {
  const me = useSelector((s) => s.auth.user);
  const canCreate = me.role !== 'employee';
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({ q: '', priority: '', assigneeId: '', overdue: false });
  const [openId, setOpenId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [err, setErr] = useState('');
  const openRef = useRef(null);
  const [detailTick, setDetailTick] = useState(0); // bump to make the open task reload
  const [liveComment, setLiveComment] = useState(null);

  const load = useCallback(() => {
    const params = { ...filters, overdue: filters.overdue ? 'true' : undefined };
    Object.keys(params).forEach((k) => !params[k] && delete params[k]);
    return api.get('/tasks', { params }).then((r) => setTasks(r.data)).catch((e) => setErr(errMsg(e)));
  }, [filters]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { if (canCreate) api.get('/users').then((r) => setUsers(r.data.filter((u) => u.isActive))).catch(() => {}); }, [canCreate]);
  useEffect(() => { openRef.current = openId; }, [openId]);

  // Realtime: the other person changed the task or commented
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onChanged = ({ id }) => { load(); if (id === openRef.current) setDetailTick((n) => n + 1); };
    const onComment = ({ taskId, comment }) => { load(); if (taskId === openRef.current) setLiveComment(comment); };
    s.on('task:changed', onChanged); s.on('task:comment', onComment);
    return () => { s.off('task:changed', onChanged); s.off('task:comment', onComment); };
  }, [load]);

  const setStatus = async (id, status) => {
    try { await api.patch(`/tasks/${id}`, { status }); load(); } catch (e) { setErr(errMsg(e)); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Tasks</h2>
        {canCreate && <button className="btn" onClick={() => setShowCreate(true)}>+ New task</button>}
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <input className="input max-w-xs" placeholder="Search title, description, project…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <select className="input w-auto" value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}>
          <option value="">All priorities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        {canCreate && (
          <select className="input w-auto" value={filters.assigneeId} onChange={(e) => setFilters({ ...filters, assigneeId: e.target.value })}>
            <option value="">Everyone</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={filters.overdue} onChange={(e) => setFilters({ ...filters, overdue: e.target.checked })} />Overdue only</label>
      </div>
      {err && <p className="flex justify-between text-sm text-red-600">{err}<button onClick={() => setErr('')}>✕</button></p>}

      <div className="grid gap-4 md:grid-cols-3">
        {Object.entries(STATUS).map(([key, label]) => {
          const list = tasks.filter((t) => t.status === key);
          return (
            <div key={key} className="card bg-slate-50 p-3">
              <h3 className="mb-2 font-medium">{label} <span className="text-slate-400">({list.length})</span></h3>
              <div className="space-y-2">
                {list.length === 0 && <p className="py-4 text-center text-xs text-slate-400">No tasks</p>}
                {list.map((t) => {
                  const done = (t.checklist || []).filter((i) => i.done).length;
                  return (
                    <div key={t.id} role="button" tabIndex={0} onClick={() => setOpenId(t.id)} onKeyDown={(e) => e.key === 'Enter' && setOpenId(t.id)}
                      className="cursor-pointer rounded-md border bg-white p-3 text-sm shadow-sm hover:border-brand-500">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium">{t.title}</p>
                        <span className={`shrink-0 rounded px-1.5 text-[10px] font-semibold uppercase ${PRIORITY_STYLE[t.priority]}`}>{t.priority}</span>
                      </div>
                      {t.project && <p className="text-xs text-slate-500">📁 {t.project}</p>}
                      {t.tags?.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{t.tags.map((g) => <span key={g} className="rounded bg-brand-50 px-1.5 text-[10px] text-brand-700">#{g}</span>)}</div>}
                      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                        <span className="flex items-center gap-1" title={t.assignee?.name}>
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[9px] font-semibold">{initials(t.assignee?.name)}</span>
                          {t.assignee?.name?.split(' ')[0]}
                        </span>
                        <span className="flex items-center gap-2">
                          {t.checklist?.length > 0 && <span title="Checklist">☑ {done}/{t.checklist.length}</span>}
                          {Number(t.commentCount) > 0 && <span title="Comments">💬 {t.commentCount}</span>}
                          {t.dueDate && <span className={isOverdue(t) ? 'font-medium text-red-600' : ''}>📅 {fmtDate(t.dueDate)}</span>}
                        </span>
                      </div>
                      <select className="mt-2 w-full rounded border text-xs" value={t.status} onClick={(e) => e.stopPropagation()} onChange={(e) => setStatus(t.id, e.target.value)}>
                        {Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} title="New task">
          <TaskForm users={users} onCancel={() => setShowCreate(false)}
            onSave={async (data) => { const r = await api.post('/tasks', data); setShowCreate(false); await load(); setOpenId(r.data.id); }} />
        </Modal>
      )}

      {openId && (
        <TaskDetail key={openId} id={openId} me={me} users={users} tick={detailTick} liveComment={liveComment}
          onClose={() => setOpenId(null)} onChanged={load} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onClick={onClose}>
      <div className="card my-8 w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">{title}</h3><button onClick={onClose}>✕</button></div>
        {children}
      </div>
    </div>
  );
}

// Create / edit form with every task field
function TaskForm({ users, initial, onSave, onCancel }) {
  const [f, setF] = useState(() => ({
    title: initial?.title || '', description: initial?.description || '', assigneeId: initial?.assigneeId || '',
    priority: initial?.priority || 'medium', status: initial?.status || 'pending', project: initial?.project || '',
    startDate: dateOnly(initial?.startDate), dueDate: dateOnly(initial?.dueDate),
    estimatedHours: initial?.estimatedHours ?? '', tags: (initial?.tags || []).join(', '),
    checklist: initial?.checklist || [], attachments: initial?.attachments || [],
  }));
  const [newItem, setNewItem] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const addItem = () => { if (!newItem.trim()) return; setF({ ...f, checklist: [...f.checklist, { text: newItem.trim(), done: false }] }); setNewItem(''); };
  const attach = async (file) => {
    if (!file) return;
    try { const a = await uploadFile(file); setF((p) => ({ ...p, attachments: [...p.attachments, a] })); } catch (e) { setErr(errMsg(e)); }
  };

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await onSave({ ...f, estimatedHours: f.estimatedHours === '' ? null : f.estimatedHours }); }
    catch (e2) { setErr(errMsg(e2)); setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3 text-sm">
      <input className="input" placeholder="Task title *" value={f.title} onChange={set('title')} required maxLength={200} />
      <textarea className="input min-h-[100px]" placeholder="Description: what needs to be done, acceptance criteria, links…" value={f.description} onChange={set('description')} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Assign to *">
          <select className="input" value={f.assigneeId} onChange={set('assigneeId')} required>
            <option value="">Select…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Project"><input className="input" value={f.project} onChange={set('project')} maxLength={120} placeholder="e.g. Website redesign" /></Field>
        <Field label="Priority">
          <select className="input" value={f.priority} onChange={set('priority')}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
        </Field>
        <Field label="Status">
          <select className="input" value={f.status} onChange={set('status')}>{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <Field label="Start date"><input className="input" type="date" value={f.startDate} onChange={set('startDate')} /></Field>
        <Field label="Due date"><input className="input" type="date" value={f.dueDate} onChange={set('dueDate')} min={f.startDate || undefined} /></Field>
        <Field label="Estimated hours"><input className="input" type="number" min="0" step="0.5" value={f.estimatedHours} onChange={set('estimatedHours')} /></Field>
        <Field label="Tags (comma separated)"><input className="input" value={f.tags} onChange={set('tags')} placeholder="frontend, bug" /></Field>
      </div>

      <Field label="Checklist">
        <ul className="space-y-1">
          {f.checklist.map((i, idx) => (
            <li key={i.id || idx} className="flex items-center gap-2">
              <input type="checkbox" checked={i.done} onChange={() => setF({ ...f, checklist: f.checklist.map((x, j) => (j === idx ? { ...x, done: !x.done } : x)) })} />
              <span className={`flex-1 ${i.done ? 'text-slate-400 line-through' : ''}`}>{i.text}</span>
              <button type="button" className="text-xs text-red-500" onClick={() => setF({ ...f, checklist: f.checklist.filter((_, j) => j !== idx) })}>Remove</button>
            </li>
          ))}
        </ul>
        <div className="mt-1 flex gap-2">
          <input className="input" placeholder="Add a checklist item" value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }} />
          <button type="button" className="btn-ghost" onClick={addItem}>Add</button>
        </div>
      </Field>

      <Field label="Attachments">
        <Attachments list={f.attachments} onRemove={(url) => setF({ ...f, attachments: f.attachments.filter((a) => a.url !== url) })} />
        <label className="btn-ghost mt-1 cursor-pointer">📎 Attach file<input type="file" hidden onChange={(e) => { attach(e.target.files[0]); e.target.value = ''; }} /></label>
      </Field>

      {err && <p className="text-red-600">{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save task'}</button>
      </div>
    </form>
  );
}

const Field = ({ label, children }) => <div><p className="mb-1 text-xs font-medium text-slate-500">{label}</p>{children}</div>;

function Attachments({ list, onRemove }) {
  if (!list?.length) return <p className="text-xs text-slate-400">No attachments</p>;
  return (
    <ul className="space-y-1">
      {list.map((a) => (
        <li key={a.url} className="flex items-center gap-2 text-sm">
          <a href={a.url} target="_blank" rel="noreferrer" className="truncate text-brand-600 underline">📎 {a.name}</a>
          {onRemove && <button type="button" className="text-xs text-red-500" onClick={() => onRemove(a.url)}>Remove</button>}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Slide-over panel: full task info + checklist + comments & activity
function TaskDetail({ id, me, users, tick, liveComment, onClose, onChanged }) {
  const [task, setTask] = useState(null);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState('');
  const [comment, setComment] = useState('');
  const [file, setFile] = useState(null);
  const [posting, setPosting] = useState(false);
  const [editC, setEditC] = useState(null);
  const [showActivity, setShowActivity] = useState(true);
  const bottom = useRef();

  const reload = useCallback(() => api.get(`/tasks/${id}`).then((r) => setTask(r.data)).catch((e) => setErr(errMsg(e))), [id]);
  useEffect(() => { reload(); }, [reload, tick]);
  useEffect(() => {
    if (!liveComment) return;
    setTask((t) => t && ({ ...t, comments: t.comments.some((c) => c.id === liveComment.id) ? t.comments.map((c) => (c.id === liveComment.id ? liveComment : c)) : [...t.comments, liveComment] }));
  }, [liveComment]);
  useEffect(() => { const k = (e) => e.key === 'Escape' && !editing && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [editing, onClose]);

  if (!task) return <Panel onClose={onClose}><p className="text-sm text-slate-500">{err || 'Loading…'}</p></Panel>;

  const isAssignee = task.assigneeId === me.id;
  const canEditStatus = task.canManage || isAssignee;

  const patch = async (data) => {
    setErr('');
    try { await api.patch(`/tasks/${id}`, data); await reload(); onChanged(); } catch (e) { setErr(errMsg(e)); }
  };
  const toggleItem = (item) => patch({ checklist: task.checklist.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)) });

  const postComment = async (e) => {
    e.preventDefault();
    if (!comment.trim() && !file) return;
    setPosting(true); setErr('');
    try {
      const attachments = file ? [await uploadFile(file)] : [];
      const { data } = await api.post(`/tasks/${id}/comments`, { text: comment, attachments });
      setTask((t) => ({ ...t, comments: t.comments.some((c) => c.id === data.id) ? t.comments : [...t.comments, data] }));
      setComment(''); setFile(null); onChanged();
      setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e2) { setErr(errMsg(e2)); } finally { setPosting(false); }
  };
  const saveEdit = async () => {
    try {
      const { data } = await api.patch(`/tasks/${id}/comments/${editC.id}`, { text: editC.text });
      setTask((t) => ({ ...t, comments: t.comments.map((c) => (c.id === data.id ? data : c)) })); setEditC(null);
    } catch (e) { setErr(errMsg(e)); }
  };
  const deleteComment = async (c) => {
    if (!window.confirm('Delete this comment?')) return;
    try {
      const { data } = await api.delete(`/tasks/${id}/comments/${c.id}`);
      setTask((t) => ({ ...t, comments: t.comments.map((x) => (x.id === data.id ? data : x)) })); onChanged();
    } catch (e) { setErr(errMsg(e)); }
  };
  const deleteTask = async () => {
    if (!window.confirm(`Delete task "${task.title}" and all its comments? This cannot be undone.`)) return;
    try { await api.delete(`/tasks/${id}`); onChanged(); onClose(); } catch (e) { setErr(errMsg(e)); }
  };

  if (editing) {
    return (
      <Modal title="Edit task" onClose={() => setEditing(false)}>
        <TaskForm users={users.length ? users : [task.assignee]} initial={task} onCancel={() => setEditing(false)}
          onSave={async (data) => { await api.patch(`/tasks/${id}`, data); setEditing(false); await reload(); onChanged(); }} />
      </Modal>
    );
  }

  const done = task.checklist?.filter((i) => i.done).length || 0;
  const timeline = task.comments.filter((c) => showActivity || c.kind === 'comment');
  const commentTotal = task.comments.filter((c) => c.kind === 'comment' && !c.deletedAt).length;

  return (
    <Panel onClose={onClose}>
      <div className="space-y-4">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-lg font-semibold">{task.title}</h3>
            {task.canManage && (
              <div className="flex shrink-0 gap-1">
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(true)}>Edit</button>
                <button className="btn-ghost px-2 py-1 text-xs text-red-600" onClick={deleteTask}>Delete</button>
              </div>
            )}
          </div>
          <p className="text-xs text-slate-500">Created by {task.creator?.name} · {fmtWhen(task.createdAt)} · updated {fmtWhen(task.updatedAt)}</p>
        </div>

        {err && <p className="text-sm text-red-600">{err}</p>}

        <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
          <Info label="Status">
            {canEditStatus
              ? <select className="rounded border bg-white px-1 text-sm" value={task.status} onChange={(e) => patch({ status: e.target.value })}>{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              : STATUS[task.status]}
          </Info>
          <Info label="Priority"><span className={`rounded px-1.5 text-xs font-semibold uppercase ${PRIORITY_STYLE[task.priority]}`}>{task.priority}</span></Info>
          <Info label="Assignee">{task.assignee?.name}{task.assignee?.designation && <span className="text-slate-400"> · {task.assignee.designation}</span>}</Info>
          <Info label="Project">{task.project || '—'}</Info>
          <Info label="Start date">{fmtDate(task.startDate)}</Info>
          <Info label="Due date"><span className={isOverdue(task) ? 'font-medium text-red-600' : ''}>{fmtDate(task.dueDate)}{isOverdue(task) && ' (overdue)'}</span></Info>
          <Info label="Estimated">{task.estimatedHours != null ? `${Number(task.estimatedHours)} h` : '—'}</Info>
          <Info label="Completed">{task.completedAt ? fmtWhen(task.completedAt) : '—'}</Info>
          {task.tags?.length > 0 && <div className="col-span-2 flex flex-wrap gap-1">{task.tags.map((g) => <span key={g} className="rounded bg-brand-50 px-1.5 text-xs text-brand-700">#{g}</span>)}</div>}
        </div>

        <section>
          <h4 className="mb-1 text-sm font-semibold">Description</h4>
          {task.description ? <p className="whitespace-pre-wrap text-sm text-slate-700">{task.description}</p> : <p className="text-sm text-slate-400">No description</p>}
        </section>

        {task.checklist?.length > 0 && (
          <section>
            <h4 className="mb-1 text-sm font-semibold">Checklist <span className="font-normal text-slate-400">{done}/{task.checklist.length}</span></h4>
            <div className="mb-2 h-1.5 overflow-hidden rounded bg-slate-200"><div className="h-full bg-green-500" style={{ width: `${(done / task.checklist.length) * 100}%` }} /></div>
            <ul className="space-y-1 text-sm">
              {task.checklist.map((i) => (
                <li key={i.id}><label className="flex items-center gap-2">
                  <input type="checkbox" checked={i.done} disabled={!canEditStatus} onChange={() => toggleItem(i)} />
                  <span className={i.done ? 'text-slate-400 line-through' : ''}>{i.text}</span>
                </label></li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h4 className="mb-1 text-sm font-semibold">Attachments</h4>
          <Attachments list={task.attachments} />
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold">Comments <span className="font-normal text-slate-400">({commentTotal})</span></h4>
            <label className="flex items-center gap-1 text-xs text-slate-500"><input type="checkbox" checked={showActivity} onChange={(e) => setShowActivity(e.target.checked)} />Show activity</label>
          </div>
          <ul className="space-y-3">
            {timeline.length === 0 && <li className="text-sm text-slate-400">No comments yet. Start the conversation below.</li>}
            {timeline.map((c) => c.kind === 'activity' ? (
              <li key={c.id} className="text-xs text-slate-500">• <b>{c.author?.name}</b> {c.text} <span className="text-slate-400">· {fmtWhen(c.createdAt)}</span></li>
            ) : (
              <li key={c.id} className="flex gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold">{initials(c.author?.name)}</span>
                <div className="min-w-0 flex-1 rounded-lg border bg-white p-2">
                  <p className="text-xs text-slate-500">
                    <b className="text-slate-700">{c.author?.name}</b>
                    {c.authorId === task.assigneeId ? ' · assignee' : c.authorId === task.createdBy ? ' · task owner' : ''}
                    {' · '}{fmtWhen(c.createdAt)}{c.editedAt && !c.deletedAt && ' · edited'}
                  </p>
                  {c.deletedAt ? <em className="text-sm text-slate-400">Comment deleted</em>
                    : editC?.id === c.id ? (
                      <div className="mt-1 space-y-1">
                        <textarea className="input" value={editC.text} onChange={(e) => setEditC({ ...editC, text: e.target.value })} />
                        <div className="flex gap-2"><button className="btn px-2 py-1 text-xs" onClick={saveEdit}>Save</button><button className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditC(null)}>Cancel</button></div>
                      </div>
                    ) : <>
                      {c.text && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{c.text}</p>}
                      <Attachments list={c.attachments?.length ? c.attachments : null} />
                      {(c.authorId === me.id || me.role === 'admin') && (
                        <div className="mt-1 flex gap-3 text-xs text-slate-400">
                          {c.authorId === me.id && <button onClick={() => setEditC({ id: c.id, text: c.text })}>Edit</button>}
                          <button className="hover:text-red-600" onClick={() => deleteComment(c)}>Delete</button>
                        </div>
                      )}
                    </>}
                </div>
              </li>
            ))}
          </ul>
          <div ref={bottom} />

          <form onSubmit={postComment} className="mt-3 space-y-2">
            <textarea className="input min-h-[70px]" placeholder="Write a comment… (Ctrl+Enter to send)" value={comment} maxLength={5000}
              onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) postComment(e); }} />
            <div className="flex items-center justify-between gap-2">
              <label className="btn-ghost cursor-pointer px-2 py-1 text-xs">📎 {file ? file.name : 'Attach'}<input type="file" hidden onChange={(e) => setFile(e.target.files[0] || null)} /></label>
              <button className="btn" disabled={posting || (!comment.trim() && !file)}>{posting ? 'Posting…' : 'Comment'}</button>
            </div>
          </form>
        </section>
      </div>
    </Panel>
  );
}

const Info = ({ label, children }) => <div><p className="text-xs text-slate-500">{label}</p><div>{children}</div></div>;

function Panel({ onClose, children }) {
  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button className="float-right text-slate-500" onClick={onClose} aria-label="Close">✕</button>
        {children}
      </aside>
    </div>
  );
}
