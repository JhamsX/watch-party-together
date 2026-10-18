import { ChangeEvent, useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type FormEvent } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import {
  ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronDown, ChevronUp, CircleHelp,
  Clapperboard, Clipboard, Copy, Crown, Film, Headphones, Link2, ListVideo, Lock, LogIn, LogOut,
  MessageCircle, MoreHorizontal, Music2, Play, Plus, Radio, Send, Settings2, Shield, Sparkles,
  Users, Video, X, Zap
} from 'lucide-react';
import { api, socketOrigin } from './lib/api';
import VideoPlayer from './components/VideoPlayer';
import type { ChatMessage, Participant, Playback, Room, VideoItem } from './types';

function Brand({ light = false }: { light?: boolean }) {
  return <Link to="/" className={`brand ${light ? 'brand-light' : ''}`}><span className="brand-mark"><Play size={14} fill="currentColor" strokeWidth={1.5} /></span><span>together<span className="brand-dot">.</span></span></Link>;
}
function Button({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`button ${className}`} {...props}>{children}</button>;
}
function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => { const timer = window.setTimeout(onClose, 3500); return () => window.clearTimeout(timer); }, [message, onClose]);
  return <div className="toast"><Check size={16} /><span>{message}</span><button onClick={onClose} aria-label="Dismiss"><X size={15} /></button></div>;
}
type Account = { id: string; email: string; displayName: string };
function AccountDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: (token: string, user: Account) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [displayName, setDisplayName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('');
    try {
      const result = await api<{ token: string; user: Account }>(`/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email, password, ...(mode === 'register' ? { displayName } : {}) }) });
      onSuccess(result.token, result.user); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Please try again.'); }
    finally { setLoading(false); }
  }
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-card account-modal">
    <button className="modal-close" onClick={onClose} aria-label="Close"><X size={19} /></button><div className="modal-icon"><Shield size={21} /></div>
    <p className="eyebrow">YOUR LITTLE CORNER</p><h2>{mode === 'login' ? 'Welcome back.' : 'Save your favorites.'}</h2><p className="muted">{mode === 'login' ? 'Sign in to keep your playlists close.' : 'Create an account for saved playlists and room history.'}</p>
    <form onSubmit={submit} className="form-stack">
      {mode === 'register' && <label>Display name<input required maxLength={48} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="What should we call you?" /></label>}
      <label>Email address<input required type="email" maxLength={191} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
      <label>Password<input required type="password" minLength={8} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" /></label>
      {error && <div className="inline-error">{error}</div>}<Button type="submit" disabled={loading} className="button-primary button-full">{loading ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight size={16} /></Button>
    </form>
    <p className="modal-switch">{mode === 'login' ? 'New around here?' : 'Already have an account?'} <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'Create an account' : 'Sign in instead'}</button></p>
  </div></div>;
}
function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string) => void }) {
  const [roomName, setRoomName] = useState('Friday night movie');
  const [displayName, setDisplayName] = useState(localStorage.getItem('together_display_name') || '');
  const [videoUrl, setVideoUrl] = useState(''); const [isPublic, setIsPublic] = useState(false); const [password, setPassword] = useState('');
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('');
    const name = displayName.trim(); if (!name) { setError('Add a display name to continue.'); setLoading(false); return; }
    try {
      const result = await api<{ room: Room; hostToken: string; inviteUrl: string }>('/rooms', {
        method: 'POST', body: JSON.stringify({ roomName, displayName: name, videoUrl, isPublic, roomPassword: isPublic ? '' : password })
      });
      localStorage.setItem('together_display_name', name);
      sessionStorage.setItem(`together_host_${result.room.code}`, result.hostToken);
      onCreated(result.room.code);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create your room.'); }
    finally { setLoading(false); }
  }
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-card create-modal">
    <button className="modal-close" onClick={onClose} aria-label="Close"><X size={19} /></button>
    <div className="modal-icon lime-icon"><Clapperboard size={22} /></div><p className="eyebrow">LET'S SET THE SCENE</p><h2>Start a watch party.</h2><p className="muted">A room, a link, your favorite people. That's the whole plan.</p>
    <form className="form-stack" onSubmit={submit}>
      <label>Room name<input required minLength={2} maxLength={80} value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Friday night movie" /></label>
      <label>Your name<input required minLength={1} maxLength={48} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="How friends will see you" /></label>
      <label>Video link <span className="optional">optional · can add later</span><input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="Paste a YouTube or direct video URL" /></label>
      <div className="privacy-row"><div className="privacy-icon"><Lock size={17} /></div><div className="privacy-copy"><strong>Private party</strong><span>Only people with your invite can find it.</span></div><button type="button" className={`toggle ${!isPublic ? 'toggle-on' : ''}`} aria-pressed={!isPublic} onClick={() => setIsPublic((v) => !v)}><span /></button></div>
      {!isPublic && <label>Room password <span className="optional">optional extra lock</span><input type="password" maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Leave blank to use invite link only" /></label>}
      {error && <div className="inline-error">{error}</div>}
      <Button type="submit" disabled={loading} className="button-primary button-full">{loading ? 'Creating your room…' : 'Create my room'} <ArrowRight size={16} /></Button>
    </form>
    <p className="form-footnote"><Shield size={13} /> No account needed. You're in control of the room.</p>
  </div></div>;
}
function JoinDialog({ onClose, onJoin }: { onClose: () => void; onJoin: (code: string, name: string) => void }) {
  const [code, setCode] = useState(''); const [name, setName] = useState(localStorage.getItem('together_display_name') || '');
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-card">
    <button className="modal-close" onClick={onClose} aria-label="Close"><X size={19} /></button><div className="modal-icon"><Users size={22} /></div><p className="eyebrow">YOU'RE INVITED</p><h2>Come on in.</h2><p className="muted">Enter the room code your friend shared with you.</p>
    <form className="form-stack" onSubmit={(e) => { e.preventDefault(); if (code.trim() && name.trim()) { localStorage.setItem('together_display_name', name.trim()); onJoin(code.trim().toUpperCase(), name.trim()); } }}>
      <label>Room code<input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. 8K4Q2M7P" maxLength={10} className="room-code-input" /></label>
      <label>Your display name<input required maxLength={48} value={name} onChange={(e) => setName(e.target.value)} placeholder="The name friends know you by" /></label>
      <Button type="submit" className="button-primary button-full">Join party <ArrowRight size={16} /></Button>
    </form>
  </div></div>;
}

function Home() {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false); const [joinOpen, setJoinOpen] = useState(false); const [accountOpen, setAccountOpen] = useState(false);
  const [account, setAccount] = useState<Account | null>(() => { try { return JSON.parse(sessionStorage.getItem('together_user') || 'null'); } catch { return null; } });
  const [toast, setToast] = useState('');
  const saveAccount = (token: string, user: Account) => { sessionStorage.setItem('together_auth_token', token); sessionStorage.setItem('together_user', JSON.stringify(user)); setAccount(user); setToast(`Welcome${user.displayName ? `, ${user.displayName}` : ''}!`); };
  const signOut = () => { sessionStorage.removeItem('together_auth_token'); sessionStorage.removeItem('together_user'); setAccount(null); setToast('You are signed out.'); };
  return <div className="site-shell">
    <header className="topbar"><Brand /><nav className="nav-links"><a href="#how-it-works">How it works</a><a href="#made-for">Why together</a></nav><div className="nav-actions">
      {account ? <><span className="account-name">{account.displayName}</span><button className="nav-login" onClick={signOut}><LogOut size={15} /> Sign out</button></> : <button className="nav-login" onClick={() => setAccountOpen(true)}><LogIn size={15} /> Sign in</button>}
      <Button className="button-primary nav-create" onClick={() => setCreateOpen(true)}>Create a room <ArrowUpRight size={15} /></Button>
    </div></header>
    <main>
      <section className="hero-section">
        <div className="hero-glow" /><div className="hero-grid" />
        <div className="hero-content"><div className="availability-pill"><span className="status-dot" /> YOUR PEOPLE, YOUR SCREEN, ANYWHERE</div>
          <h1>Same moment.<br /><span>Different places.</span></h1>
          <p className="hero-copy">Movie night doesn't need the same couch. Drop a link, invite your people, and press play together — wherever life has you.</p>
          <div className="hero-actions"><Button className="button-primary button-large" onClick={() => setCreateOpen(true)}><Play size={17} fill="currentColor" /> Start a watch party</Button><button className="button-secondary button-large" onClick={() => setJoinOpen(true)}><ArrowDownLeft size={17} /> Join a room</button></div>
          <div className="hero-proof"><div className="avatar-stack"><span>J</span><span>M</span><span>A</span><span>+</span></div><div><strong>Made for your group chat</strong><small>No downloads. No complicated setup.</small></div><div className="proof-divider" /><div className="proof-stat"><strong>in sync</strong><small>play, pause, laugh</small></div></div>
        </div>
        <div className="hero-art" aria-label="Preview of a watch party"><div className="preview-orbit orbit-one" /><div className="preview-orbit orbit-two" />
          <div className="preview-card"><div className="preview-top"><div className="preview-brand"><span className="mini-brand-mark"><Play size={9} fill="currentColor" /></span> together<span className="brand-dot">.</span></div><div className="preview-room"><span className="status-dot" /> ROOM LIVE</div></div>
            <div className="preview-scene"><div className="scene-sun" /><div className="scene-mountain mountain-back" /><div className="scene-mountain mountain-front" /><div className="scene-hill" /><div className="scene-person person-left" /><div className="scene-person person-right" /><div className="scene-label"><span>NOW PLAYING</span><strong>Somewhere, together.</strong></div><div className="scene-play"><Play size={21} fill="currentColor" /></div></div>
            <div className="preview-controls"><div className="preview-bar"><span /></div><div className="preview-control-row"><span><Play size={12} fill="currentColor" /> <span className="preview-time">12:42 / 1:48:06</span></span><span className="preview-synced"><Radio size={11} /> SYNCED</span></div></div>
            <div className="preview-bottom"><div className="preview-attendees"><span>J</span><span>M</span><span>A</span><span className="attendee-count">+2</span></div><div className="preview-chat"><span className="chat-dot" /> <span>Alex: this scene!! 🥹</span><span className="chat-heart">♥</span></div></div>
          </div><div className="float-note note-sync"><span className="note-icon"><Radio size={16} /></span><span><strong>Perfectly in sync</strong><small>give or take a tiny laugh</small></span></div><div className="float-note note-reaction"><span className="reaction-emoji">😂</span><span><strong>Everyone's here</strong><small>the group chat, upgraded</small></span></div>
        </div>
        <div className="hero-bottom-note"><span>01 / WATCH TOGETHER</span><span>BUILT FOR LONG DISTANCE AND CLOSE FRIENDS <ArrowRight size={13} /></span></div>
      </section>
      <section id="how-it-works" className="steps-section section-pad"><div className="section-heading"><p className="eyebrow">NO BIG PRODUCTION</p><h2>Three steps to <span>movie night.</span></h2><p>More time watching, less time figuring things out.</p></div>
        <div className="step-grid"><article className="step-card"><div className="step-number">01 <span>· 10 seconds</span></div><div className="step-icon step-icon-lime"><Link2 size={22} /></div><h3>Bring the link</h3><p>Paste a YouTube URL or supported direct video link. That's the hard part done.</p><div className="mock-input"><Link2 size={14} /><span>youtube.com/watch?v=...</span><Check size={14} /></div></article>
          <article className="step-card"><div className="step-number">02 <span>· one click</span></div><div className="step-icon step-icon-purple"><Users size={22} /></div><h3>Bring your people</h3><p>Your room gets a unique invite. Send it in your chat and let everyone drop in.</p><div className="mock-invite"><div className="mock-invite-icon"><Play size={12} fill="currentColor" /></div><div><strong>friday-night.together</strong><small>Invite link ready</small></div><Copy size={15} /></div></article>
          <article className="step-card"><div className="step-number">03 <span>· all together</span></div><div className="step-icon step-icon-coral"><Radio size={22} /></div><h3>Press play, together</h3><p>Playback follows the host. Chat, react, and share the moment in real time.</p><div className="mock-reactions"><span>😂</span><span>😭</span><span>🍿</span><span>❤️</span><span className="reaction-add">+</span></div></article>
        </div>
      </section>
      <section id="made-for" className="made-section section-pad"><div className="made-copy"><p className="eyebrow">SMALL DETAILS, BIG FEELING</p><h2>It's not just watching.<br /><span>It's being there.</span></h2><p>We built the little things that make a shared screen feel like sharing a couch.</p><div className="feature-list"><div><span className="feature-check"><Check size={14} /></span><span><strong>Playback that follows the host</strong><small>Late arrivals catch up automatically.</small></span></div><div><span className="feature-check"><Check size={14} /></span><span><strong>A chat that stays with the movie</strong><small>Send a thought, a meme, or 17 popcorn emojis.</small></span></div><div><span className="feature-check"><Check size={14} /></span><span><strong>Private by default</strong><small>Your invite stays with the people you share it with.</small></span></div></div><Button className="button-primary" onClick={() => setCreateOpen(true)}>Okay, let's do this <ArrowRight size={16} /></Button></div>
        <div className="made-visual"><div className="made-window"><div className="made-window-top"><span /><span /><span /><div>movie-night / room</div><Users size={14} /></div><div className="made-screen"><div className="made-screen-glow" /><div className="made-screen-mountains" /><div className="made-screen-play"><Play size={21} fill="currentColor" /></div><div className="made-screen-caption">SOME THINGS ARE BETTER SHARED.</div></div><div className="made-window-chat"><div className="chat-person"><span className="chat-avatar avatar-green">J</span><div><strong>Jamie</strong><p>wait the soundtrack is so good</p></div><small>8:42</small></div><div className="chat-person"><span className="chat-avatar avatar-lilac">M</span><div><strong>Morgan</strong><p>🍿️🍿️🍿️</p></div><small>8:43</small></div><div className="chat-person"><span className="chat-avatar avatar-coral">A</span><div><strong>Alex</strong><p>I'm so glad we did this 🥹</p></div><small>8:43</small></div><div className="fake-chat-input">Say something nice… <Send size={13} /></div></div></div><div className="made-floating made-floating-top"><Sparkles size={17} /><span>Everywhere can be movie night.</span></div><div className="made-floating made-floating-bottom"><Headphones size={17} /><span>Just bring yourself.</span></div></div>
      </section>
      <section className="cta-section"><div className="cta-spark cta-spark-one">✳</div><div className="cta-spark cta-spark-two">✳</div><p className="eyebrow">YOUR NEXT FAVORITE MEMORY</p><h2>Who's watching<br />with you tonight?</h2><p>Send the invite. Save them a seat.</p><Button className="button-dark button-large" onClick={() => setCreateOpen(true)}>Create your room <ArrowRight size={16} /></Button><div className="cta-footnote"><Shield size={13} /> Free to start · No account required</div></section>
    </main>
    <footer className="footer"><Brand /><p>For the people you wish were on your couch.</p><span>© {new Date().getFullYear()} together.</span></footer>
    {createOpen && <CreateDialog onClose={() => setCreateOpen(false)} onCreated={(code) => navigate(`/room/${code}`)} />}
    {joinOpen && <JoinDialog onClose={() => setJoinOpen(false)} onJoin={(code, name) => navigate(`/room/${code}?name=${encodeURIComponent(name)}`)} />}
    {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} onSuccess={saveAccount} />}
    {toast && <Toast message={toast} onClose={() => setToast('')} />}
  </div>;
}

function RoomPage() {
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const { code = '' } = useParams(); const navigate = useNavigate();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [room, setRoom] = useState<Room | null>(null); const [participant, setParticipant] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]); const [playback, setPlayback] = useState<Playback>({ playing: false, position: 0, updatedAt: Date.now(), sequence: 0 });
  const [queue, setQueue] = useState<VideoItem[]>([]); const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [displayName, setDisplayName] = useState(new URLSearchParams(window.location.search).get('name') || localStorage.getItem('together_display_name') || '');
  const [password, setPassword] = useState(''); const [joinError, setJoinError] = useState(''); const [joinNeedsPassword, setJoinNeedsPassword] = useState(false); const [joining, setJoining] = useState(true);
  const [messageText, setMessageText] = useState(''); const [videoInput, setVideoInput] = useState(''); const [queueInput, setQueueInput] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'people' | 'queue'>('chat'); const [mobilePanelOpen, setMobilePanelOpen] = useState(true);
  const [toast, setToast] = useState(''); const [kicked, setKicked] = useState(false); const [connection, setConnection] = useState<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>('connecting');
  const [showRoomSettings, setShowRoomSettings] = useState(false); const chatBottomRef = useRef<HTMLDivElement>(null); const toastTimer = useRef<number | null>(null);
  const displayNameRef = useRef(displayName); const passwordRef = useRef(password);
  displayNameRef.current = displayName; passwordRef.current = password;
  const showToast = useCallback((text: string) => { setToast(text); if (toastTimer.current) window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(''), 3200); }, []);
  const hostToken = sessionStorage.getItem(`together_host_${code}`) || '';

  useEffect(() => {
    const sock = io(socketOrigin(), { autoConnect: false, reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 600, reconnectionDelayMax: 5000, timeout: 10_000 });
    setSocket(sock); setJoining(true); setJoinError(''); setKicked(false);
    const attemptJoin = () => {
      setConnection('connected');
      const currentName = displayNameRef.current.trim();
      if (!currentName) { setJoining(false); return; }
      setJoining(true);
      sock.emit('room:join', {
        code, displayName: currentName, password: passwordRef.current, hostToken,
        authToken: sessionStorage.getItem('together_auth_token') || ''
      }, (result: any) => {
        if (!result?.ok) {
          setJoining(false); setJoinError(result?.error || 'Could not join this room.');
          setJoinNeedsPassword(/password|private/i.test(result?.error || ''));
          return;
        }
        setRoom(result.room); setParticipant(result.participant); setParticipants(result.participants || []);
        setPlayback(result.playback); setQueue(result.queue || []); setMessages(result.messages || []);
        setJoinError(''); setJoinNeedsPassword(false); setJoining(false); setConnection('connected');
        localStorage.setItem('together_display_name', currentName);
      });
    };
    sock.on('connect', attemptJoin);
    sock.on('disconnect', () => setConnection('reconnecting'));
    sock.io.on('reconnect_attempt', () => setConnection('reconnecting'));
    sock.on('connect_error', () => { setConnection('reconnecting'); setJoining(false); setJoinError('Connecting to the party… Check that the server is running.'); });
    sock.on('room:participants', (next: Participant[]) => setParticipants(next));
    sock.on('chat:new', (msg: ChatMessage) => setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg].slice(-150)));
    sock.on('playback:updated', (state: Playback) => setPlayback(state));
    sock.on('room:media', ({ room: nextRoom, playback: nextPlayback }: { room: Room; playback: Playback }) => { setRoom(nextRoom); setPlayback(nextPlayback); });
    sock.on('queue:changed', (nextQueue: VideoItem[]) => setQueue(nextQueue));
    sock.on('room:settings', (settings: { allowEveryoneControls: boolean }) => setRoom((prev) => prev ? { ...prev, ...settings } : prev));
    sock.on('room:host-changed', ({ socketId, name }: { socketId: string; name: string }) => { setParticipant((prev) => prev ? { ...prev, isHost: prev.socketId === socketId } : prev); showToast(`${name} is now the host.`); });
    sock.on('room:kicked', ({ message }: { message: string }) => { setKicked(true); setJoinError(message); sock.disconnect(); });
    sock.connect();
    return () => { sock.removeAllListeners(); sock.disconnect(); if (toastTimer.current) window.clearTimeout(toastTimer.current); };
    // We intentionally reconnect if the join credentials change, but not on every render.
    // Keep one socket per room; changing the name or password should not reconnect repeatedly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, activeTab]);
  const canControl = Boolean(participant?.isHost || room?.allowEveryoneControls);
  const onPlaybackCommand = useCallback((action: 'play' | 'pause' | 'seek' | 'sync', position: number, playing?: boolean) => {
    if (!socket || !canControl) return;
    socket.emit('playback:command', { action, position, playing });
  }, [socket, canControl]);

  const submitMessage = (event?: FormEvent, override?: string, kind: 'chat' | 'reaction' = 'chat') => {
    event?.preventDefault(); const content = (override ?? messageText).trim(); if (!content || !socket) return;
    socket.emit('chat:send', { content, kind }, (result: any) => { if (!result?.ok) showToast(result?.error || 'Could not send message.'); });
    setMessageText('');
  };
  const setVideo = (event: FormEvent) => {
    event.preventDefault(); if (!videoInput.trim() || !socket || !participant?.isHost) return;
    socket.emit('room:set-video', { url: videoInput.trim() }, (result: any) => {
      if (!result?.ok) showToast(result?.error || 'Could not load this video.'); else { setVideoInput(''); showToast('Video loaded for everyone.'); }
    });
  };
  
const uploadVideo = async (
  event: ChangeEvent<HTMLInputElement>
) => {
  const input = event.currentTarget;
  const file = input.files?.[0];

  if (!file) return;

  // Keep the initial client-side limit aligned with the server.
  const maxBytes = 2 * 1024 * 1024 * 1024;

  if (file.size > maxBytes) {
    showToast('The video exceeds the 2 GB upload limit.');
    input.value = '';
    return;
  }

  if (!participant?.isHost) {
    showToast('Only the host can upload videos.');
    input.value = '';
    return;
  }

  const hostToken =
    sessionStorage.getItem(`together_host_${code}`) || '';

  if (!hostToken) {
    showToast('Host credentials are missing. Reopen your host session.');
    input.value = '';
    return;
  }

  const formData = new FormData();
  formData.append('video', file);

  setUploadingVideo(true);

  try {
    const response = await fetch(
      `/api/rooms/${encodeURIComponent(code)}/upload`,
      {
        method: 'POST',
        headers: {
          'X-Host-Token': hostToken
        },
        body: formData
      }
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.ok) {
      throw new Error(result.error || 'Video upload failed.');
    }

    showToast('Video uploaded and loaded for everyone.');
  } catch (error) {
    showToast(
      error instanceof Error
        ? error.message
        : 'Could not upload the video.'
    );
  } finally {
    setUploadingVideo(false);
    input.value = '';
  }
};

  const addQueue = (event: FormEvent) => {
    event.preventDefault(); if (!queueInput.trim() || !socket || !participant?.isHost) return;
    socket.emit('queue:add', { url: queueInput.trim() }, (result: any) => {
      if (!result?.ok) showToast(result?.error || 'Could not add video.'); else { setQueueInput(''); showToast('Added to the queue.'); }
    });
  };
  const shareRoom = async () => {
    const invite = `${window.location.origin}/room/${code}`;
    try { await navigator.clipboard.writeText(invite); showToast('Invite link copied to clipboard.'); }
    catch { window.prompt('Copy your invite link:', invite); }
  };
  const sendReaction = (emoji: string) => submitMessage(undefined, emoji, 'reaction');
  const kickParticipant = (p: Participant) => { if (socket && window.confirm(`Remove ${p.name} from this room?`)) socket.emit('room:kick', { socketId: p.socketId }, (r: any) => r?.ok ? showToast(`${p.name} was removed.`) : showToast(r?.error || 'Could not remove participant.')); };
  const transferHost = (p: Participant) => { if (socket && window.confirm(`Make ${p.name} the host?`)) socket.emit('room:transfer-host', { socketId: p.socketId }, (r: any) => r?.ok ? showToast(`Host privileges transferred to ${p.name}.`) : showToast(r?.error || 'Could not transfer host.')); };
  const roomAge = room ? new Date(room.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  if (!displayName.trim() || joinError || joining || !room || !participant || kicked) {
    return <div className="join-screen"><header className="topbar room-topbar"><Brand /><button className="nav-login" onClick={() => navigate('/')}><ArrowLeft size={16} /> Back home</button></header>
      <div className="join-card"><div className="join-illustration"><div className="join-illustration-stars">✳ · ✧</div><div className="join-illustration-circle"><Play size={28} fill="currentColor" /></div><span className="join-orbit join-orbit-a" /><span className="join-orbit join-orbit-b" /></div>
        <p className="eyebrow">{kicked ? 'PARTY UPDATE' : joinError ? 'ONE LITTLE THING' : "YOU'RE ALMOST THERE"}</p>
        <h1>{kicked ? 'Party ended for you.' : joining ? 'Finding your room…' : joinNeedsPassword ? 'A password, please.' : joinError ? 'Let’s get you in.' : 'Grab your seat.'}</h1>
        <p className="muted">{kicked ? joinError : joining ? 'Getting the room ready and syncing the popcorn.' : joinError && !joinNeedsPassword ? joinError : 'Add your name, and you’re right where you need to be.'}</p>
        {!kicked && <form className="form-stack join-form" onSubmit={(e) => { e.preventDefault(); const name = displayName.trim() || 'Guest'; displayNameRef.current = name; passwordRef.current = password; setDisplayName(name); setJoinError(''); setJoining(true); const current = socket; if (current?.connected) current.emit('room:join', { code, displayName: name, password, hostToken, authToken: sessionStorage.getItem('together_auth_token') || '' }, (result: any) => { if (!result?.ok) { setJoining(false); setJoinError(result?.error || 'Could not join.'); setJoinNeedsPassword(/password|private/i.test(result?.error || '')); } else { setRoom(result.room); setParticipant(result.participant); setParticipants(result.participants || []); setPlayback(result.playback); setQueue(result.queue || []); setMessages(result.messages || []); setJoinError(''); setJoinNeedsPassword(false); setJoining(false); setConnection('connected'); } }); else if (current) { current.connect(); } }}>
          <label>Display name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="How friends will see you" maxLength={48} required /></label>
          {joinNeedsPassword && <label>Room password<input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Ask the host for the password" type="password" maxLength={72} required /></label>}
          {joinError && !joinNeedsPassword && !joining && <div className="inline-error">{joinError}</div>}
          <Button type="submit" className="button-primary button-full" disabled={joining && connection === 'connecting'}>{joining ? 'Connecting…' : 'Join watch party'} <ArrowRight size={16} /></Button>
        </form>}
        <button className="back-link" onClick={() => navigate('/')}><ArrowLeft size={14} /> Head back home</button>
      </div>
    </div>;
  }

  return <div className="room-app">
    <header className="room-header"><div className="room-header-left"><Brand /><div className="header-separator" /><div className="room-breadcrumb"><span className="room-breadcrumb-label">WATCH PARTY</span><strong>{room.name}</strong></div></div>
      <div className="room-header-actions"><span className={`connection-pill ${connection}`}><span className="status-dot" /> {connection === 'connected' ? 'Connected' : connection === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</span><div className="room-code-pill"><span>ROOM CODE</span><strong>{room.code}</strong></div><Button className="button-primary share-button" onClick={shareRoom}><Copy size={14} /> Invite friends</Button><button className="icon-button room-settings-button" onClick={() => setShowRoomSettings((v) => !v)} title="Room settings"><Settings2 size={18} /></button></div>
    </header>
    <main className="room-main">
      <section className="watch-column">
        <div className="watch-heading"><div><div className="watch-title-line"><span className="live-pulse" /> <span className="eyebrow">NOW WATCHING</span></div><h1>{room.currentVideoTitle || 'Your movie night starts here'}</h1><p>{room.currentVideoUrl ? 'The host keeps everyone in sync.' : 'Add a video link below to start the party.'}</p></div><div className="watch-heading-meta"><div className="tiny-avatar-stack">{participants.slice(0, 4).map((p, i) => <span key={p.socketId} className={`tiny-avatar color-${i % 4}`}>{p.name.charAt(0).toUpperCase()}</span>)}{participants.length > 4 && <span className="tiny-avatar tiny-more">+{participants.length - 4}</span>}</div><strong>{participants.length} <span>{participants.length === 1 ? 'person' : 'people'} here</span></strong></div></div>
        <VideoPlayer url={room.currentVideoUrl} title={room.currentVideoTitle} canControl={canControl} isHost={Boolean(participant.isHost)} playback={playback} onCommand={onPlaybackCommand} />
        <div className="media-info-row"><div className="media-info-left"><span className="media-type-icon"><Film size={17} /></span><div><strong>{room.currentVideoUrl ? (room.currentVideoTitle || 'Untitled video') : 'Nothing playing just yet'}</strong><span>{room.currentVideoUrl ? `${playback.playing ? 'Playing' : 'Paused'} · ${playback.playing ? 'everyone is in sync' : 'waiting for the host'}` : 'Host can add a video link below'}</span></div></div><span className="sync-status"><Radio size={13} /> {playback.playing ? 'SYNCING LIVE' : 'READY WHEN YOU ARE'}</span></div>
        {participant.isHost ? <form className="video-add-form" onSubmit={setVideo}><div className="video-add-icon"><Plus size={18} /></div><input value={videoInput} onChange={(e) => setVideoInput(e.target.value)} placeholder="Paste a YouTube or direct video URL…" aria-label="Video URL" /><Button type="submit" className="button-primary" disabled={!videoInput.trim()}><Play size={14} fill="currentColor" /> Load for everyone</Button></form> : <div className="host-message"><Lock size={14} /><span>The host controls what's playing. Have a suggestion? Drop the link in chat.</span></div>}
        <div className="room-bottom-meta"><span><Lock size={13} /> {room.isPublic ? 'Public room' : 'Invite-only room'}</span><span><Users size={13} /> {participants.length} connected</span><span><Radio size={13} /> Room started {roomAge}</span><span className="room-meta-code">#{room.code}</span></div>
        {participant.isHost && (
  <div className="video-upload-row">
    <label className="video-upload-control">
      <Film size={17} />

      <span>
        {uploadingVideo
          ? 'Uploading video…'
          : 'Upload a video from your device'}
      </span>

      <input
        type="file"
        accept="video/mp4,video/webm,video/ogg,video/quicktime,.m4v,.ogv"
        disabled={uploadingVideo}
        onChange={uploadVideo}
      />
    </label>

    <span className="video-upload-hint">
      MP4, WebM, OGG, OGV, M4V or MOV · Max 2 GB
    </span>
  </div>
)}
      </section>
      <aside className={`party-panel ${mobilePanelOpen ? 'panel-open' : 'panel-closed'}`}>
        <div className="panel-top"><div className="panel-title-group"><span className="panel-online-dot" /><div><h2>Your party</h2><p>{participants.length} here right now</p></div></div><button className="icon-button panel-mobile-close" onClick={() => setMobilePanelOpen(false)} aria-label="Close party panel"><X size={18} /></button><button className="icon-button panel-options" onClick={() => setShowRoomSettings((v) => !v)} aria-label="Room options"><MoreHorizontal size={19} /></button></div>
        <div className="panel-tabs"><button className={activeTab === 'chat' ? 'active' : ''} onClick={() => { setActiveTab('chat'); setMobilePanelOpen(true); }}><MessageCircle size={15} /> Chat <span>{messages.filter((m) => m.kind !== 'system').length > 99 ? '99+' : messages.filter((m) => m.kind !== 'system').length}</span></button><button className={activeTab === 'people' ? 'active' : ''} onClick={() => { setActiveTab('people'); setMobilePanelOpen(true); }}><Users size={15} /> People <span>{participants.length}</span></button><button className={activeTab === 'queue' ? 'active' : ''} onClick={() => { setActiveTab('queue'); setMobilePanelOpen(true); }}><ListVideo size={15} /> Queue</button></div>
        {showRoomSettings && <div className="settings-popover"><div className="settings-popover-head"><strong>Room settings</strong><button className="icon-button" onClick={() => setShowRoomSettings(false)}><X size={15} /></button></div><label className="settings-toggle-row"><span><strong>Everyone can control playback</strong><small>Allow people to play, pause, and seek.</small></span><button type="button" aria-label="Toggle shared controls" className={`toggle ${room.allowEveryoneControls ? 'toggle-on' : ''}`} onClick={() => socket?.emit('room:update-settings', { allowEveryoneControls: !room.allowEveryoneControls }, (r: any) => { if (!r?.ok) showToast(r?.error || 'Could not update settings.'); })}><span /></button></label><div className="settings-note"><Shield size={14} /> Only the host can manage videos and participants.</div></div>}
        {activeTab === 'chat' && <><div className="chat-log" aria-live="polite">{messages.length === 0 && <div className="chat-empty"><div className="chat-empty-icon"><MessageCircle size={22} /></div><strong>It's quiet in here.</strong><span>Be the first to say something.</span></div>}{messages.map((m) => <ChatBubble key={m.id} message={m} own={m.displayName === participant.name && m.kind !== 'system'} />)}<div ref={chatBottomRef} /></div><div className="chat-composer-wrap"><div className="quick-reactions">{['❤️', '😂', '😭', '🍿', '😮', '🔥'].map((emoji) => <button key={emoji} onClick={() => sendReaction(emoji)} aria-label={`React ${emoji}`}>{emoji}</button>)}</div><form className="chat-composer" onSubmit={(e) => submitMessage(e)}><input value={messageText} onChange={(e) => setMessageText(e.target.value)} placeholder="Say something…" maxLength={500} aria-label="Message" /><button type="submit" disabled={!messageText.trim()} aria-label="Send message"><Send size={16} /></button></form><div className="chat-footnote">Be nice. The best bits are shared. <span>↵ to send</span></div></div></>}
        {activeTab === 'people' && <div className="people-list">{participants.map((p, index) => <div className="person-row" key={p.socketId}><div className={`person-avatar color-${index % 4}`}>{p.name.charAt(0).toUpperCase()}</div><div className="person-copy"><strong>{p.name}{p.socketId === participant.socketId ? ' (you)' : ''}</strong><span>{p.isHost ? <><Crown size={11} /> Host</> : 'Watching along'}</span></div>{p.isHost && <span className="host-tag">HOST</span>}{participant.isHost && p.socketId !== participant.socketId && <div className="person-actions"><button title="Make host" onClick={() => transferHost(p)}><Crown size={14} /></button><button title="Remove participant" onClick={() => kickParticipant(p)}><X size={14} /></button></div>}</div>)}<div className="people-invite"><div className="people-invite-icon"><Plus size={18} /></div><div><strong>More the merrier.</strong><span>Invite someone to join you.</span></div><button onClick={shareRoom}>Copy invite</button></div></div>}
        {activeTab === 'queue' && <div className="queue-view"><div className="queue-heading"><div><strong>Up next</strong><span>{queue.length} {queue.length === 1 ? 'video' : 'videos'} in this room</span></div>{participant.isHost && <span className="queue-host-pill"><Crown size={11} /> Host managed</span>}</div>{queue.length === 0 ? <div className="queue-empty"><ListVideo size={22} /><strong>Queue's looking fresh.</strong><span>Add something to watch next.</span></div> : <div className="queue-list">{queue.map((v, index) => <div className={`queue-item ${room.currentVideoUrl === v.url ? 'queue-current' : ''}`} key={v.id}><div className="queue-thumb">{v.provider === 'youtube' ? <img src={`https://img.youtube.com/vi/${getThumbId(v.url)}/mqdefault.jpg`} alt="" /> : <span><Film size={19} /></span>}<small>{String(index + 1).padStart(2, '0')}</small></div><div className="queue-copy"><strong>{v.title}</strong><span>{v.provider === 'youtube' ? 'YouTube' : 'Direct video'}{v.addedBy ? ` · added by ${v.addedBy}` : ''}</span></div>{participant.isHost && <div className="queue-actions"><button title="Move up" disabled={index === 0} onClick={() => socket?.emit('queue:move', { videoId: v.id, direction: 'up' }, (r: any) => { if (!r?.ok) showToast(r?.error || 'Could not reorder item.'); })}><ChevronUp size={13} /></button><button title="Move down" disabled={index === queue.length - 1} onClick={() => socket?.emit('queue:move', { videoId: v.id, direction: 'down' }, (r: any) => { if (!r?.ok) showToast(r?.error || 'Could not reorder item.'); })}><ChevronDown size={13} /></button><button title="Play now" onClick={() => socket?.emit('queue:play', { videoId: v.id }, (r: any) => { if (!r?.ok) showToast(r?.error || 'Could not play item.'); })}><Play size={13} fill="currentColor" /></button><button title="Remove" onClick={() => socket?.emit('queue:remove', { videoId: v.id }, (r: any) => { if (!r?.ok) showToast(r?.error || 'Could not remove item.'); })}><X size={13} /></button></div>}</div>)}</div>}{participant.isHost && <form className="queue-add-form" onSubmit={addQueue}><input value={queueInput} onChange={(e) => setQueueInput(e.target.value)} placeholder="Add a video link…" aria-label="Add video to queue" /><button type="submit" disabled={!queueInput.trim()}><Plus size={15} /> Add</button></form>}</div>}
        <div className="panel-footer"><div className="panel-footer-brand"><span className="footer-dot" /> <span>{participants.length > 1 ? 'A little closer, even from far away.' : 'Waiting for your people to arrive.'}</span></div><button onClick={shareRoom}><Link2 size={13} /> Invite link</button></div>
      </aside>
      {!mobilePanelOpen && <button className="mobile-chat-launch" onClick={() => { setMobilePanelOpen(true); setActiveTab('chat'); }}><MessageCircle size={17} /> Open party chat</button>}
    </main>
    {toast && <Toast message={toast} onClose={() => setToast('')} />}
  </div>;
}
function getThumbId(url: string) {
  try { const u = new URL(url); return u.hostname.includes('youtu.be') ? u.pathname.split('/').filter(Boolean)[0] : u.searchParams.get('v') || u.pathname.split('/').pop() || ''; } catch { return ''; }
}
function ChatBubble({ message, own }: { message: ChatMessage; own: boolean }) {
  if (message.kind === 'system') return <div className="system-message"><span />{message.content}<span /></div>;
  if (message.kind === 'reaction') return <div className={`reaction-message ${own ? 'own' : ''}`}><div className="reaction-message-avatar">{message.displayName.charAt(0).toUpperCase()}</div><div><strong>{message.displayName}</strong><span className="reaction-big">{message.content}</span><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div></div>;
  return <div className={`chat-message ${own ? 'own' : ''}`}><div className={`chat-message-avatar color-${message.displayName.length % 4}`}>{message.displayName.charAt(0).toUpperCase()}</div><div className="chat-message-main"><div className="chat-message-head"><strong>{message.displayName}</strong><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{own && <CheckCheck size={12} className="message-check" />}</div><p>{message.content}</p></div></div>;
}

export default function App() {
  return <Routes><Route path="/" element={<Home />} /><Route path="/room/:code" element={<RoomPage />} /><Route path="*" element={<Home />} /></Routes>;
}
