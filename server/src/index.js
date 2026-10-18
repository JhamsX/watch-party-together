import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import cors from 'cors';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import multer from 'multer';
import path from 'node:path';

const prisma = new PrismaClient();
const app = express();
const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);

const UPLOAD_DIR = path.resolve(
  currentDirectory,
  '../uploads'
);

mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_VIDEO_SIZE = Number(
  process.env.MAX_VIDEO_SIZE || 2147483648
); // 2 GiB default

const allowedExtensions = new Set([
  '.mp4',
  '.webm',
  '.ogg',
  '.ogv',
  '.m4v',
  '.mov'
]);

const videoStorage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, UPLOAD_DIR);
  },

  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();

    // Never use the original filename as the disk filename.
    callback(null, `${crypto.randomUUID()}${extension}`);
  }
});

const videoUpload = multer({
  storage: videoStorage,
  limits: {
    fileSize: MAX_VIDEO_SIZE,
    files: 1
  },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();

    if (!allowedExtensions.has(extension)) {
      return callback(
        new Error('Unsupported video format. Use MP4, WebM, OGG, OGV, M4V, or MOV.')
      );
    }

    if (
      !file.mimetype.startsWith('video/') &&
      file.mimetype !== 'application/octet-stream'
    ) {
      return callback(new Error('The uploaded file must be a video.'));
    }

    callback(null, true);
  }
});

// Serve video files with HTTP byte-range support for seeking.
app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    acceptRanges: true,
    fallthrough: false,
    index: false,
    maxAge: '1h',
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
  })
);

const server = http.createServer(app);
const PORT = Number(process.env.PORT || 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set to a random secret with at least 32 characters.');
}

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1); // only behind a single trusted reverse proxy
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: CLIENT_ORIGIN.split(',').map((s) => s.trim()), credentials: false }));
app.use(express.json({ limit: '32kb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again in a few minutes.' } });
const roomCreateLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many room creation attempts. Try again shortly.' } });

const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN.split(',').map((s) => s.trim()), methods: ['GET', 'POST'] },
  connectionStateRecovery: { maxDisconnectionDuration: 120_000, skipMiddlewares: true },
  pingInterval: 25_000,
  pingTimeout: 20_000
});

const roomParticipants = new Map(); // roomId -> Map(socketId, participant); presence is deliberately transient.
const playbackStates = new Map(); // roomId -> live server-authoritative state; not persisted to MySQL.
const activityRate = new Map();
const joinAttemptsByIp = new Map();
const codeAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const roomCreateSchema = z.object({
  roomName: z.string().trim().min(2).max(80),
  displayName: z.string().trim().min(1).max(48),
  videoUrl: z.string().trim().max(2048).optional().default(''),
  isPublic: z.boolean().optional().default(false),
  roomPassword: z.string().max(72).optional().default(''),
  allowEveryoneControls: z.boolean().optional().default(false)
});
const joinSchema = z.object({
  code: z.string().trim().min(4).max(10).transform((v) => v.toUpperCase()),
  displayName: z.string().trim().min(1).max(48),
  password: z.string().max(72).optional().default(''),
  hostToken: z.string().max(128).optional().default(''),
  authToken: z.string().max(4096).optional().default('')
});
const authSchema = z.object({
  email: z.string().trim().email().max(191).transform((v) => v.toLowerCase()),
  password: z.string().min(8).max(72),
  displayName: z.string().trim().min(1).max(48).optional()
});

class InputError extends Error {}

function publicRoom(room) {
  return {
    id: room.id, code: room.code, name: room.name, isPublic: room.isPublic,
    hasPassword: Boolean(room.passwordHash), allowEveryoneControls: room.allowEveryoneControls,
    currentVideoUrl: room.currentVideoUrl, currentVideoTitle: room.currentVideoTitle,
    createdAt: room.createdAt
  };
}
function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function makeCode() {
  let code = '';
  for (let i = 0; i < 8; i++) code += codeAlphabet[crypto.randomInt(0, codeAlphabet.length)];
  return code;
}

function parseVideoUrl(input) {
  let url;

  try {
    url = new URL(input);
  } catch {
    throw new InputError(
      'Enter a valid video or player URL.'
    );
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new InputError(
      'Only HTTP and HTTPS links are supported.'
    );
  }

  if (url.username || url.password) {
    throw new InputError(
      'URLs containing embedded credentials are not supported.'
    );
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  // YouTube: supported through the official player API.
  let youtubeId = null;

  if (
    ['youtube.com', 'm.youtube.com', 'youtube-nocookie.com']
      .includes(host)
  ) {
    if (url.pathname === '/watch') {
      youtubeId = url.searchParams.get('v');
    } else if (/^\/(embed|shorts|live)\//.test(url.pathname)) {
      youtubeId = url.pathname.split('/')[2];
    }
  } else if (host === 'youtu.be') {
    youtubeId = url.pathname.split('/').filter(Boolean)[0];
  }

  if (youtubeId) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) {
      throw new InputError('Invalid YouTube video ID.');
    }

    return {
      url: `https://www.youtube.com/watch?v=${youtubeId}`,
      provider: 'youtube',
      title: 'YouTube video',
      youtubeId
    };
  }

  if (
    ['youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'youtu.be']
      .includes(host)
  ) {
    throw new InputError(
      'We could not recognize a valid YouTube video.'
    );
  }

  // Direct media files: native HTML5 playback.
  if (/\.(mp4|webm|ogv|ogg|m4v|mov|mp3|m4a|aac|wav|oga)$/i.test(url.pathname)) {
    const segment = url.pathname.split('/').pop() || 'Media';
    let title = segment;

    try {
      title = decodeURIComponent(segment);
    } catch {
      // Keep the original filename.
    }

    return {
      url: url.toString(),
      provider: 'direct',
      title: title.slice(0, 200),
      youtubeId: null
    };
  }

  // Other pages: attempt an ordinary iframe embed.
  // This does NOT bypass the source website's embedding restrictions.
  return {
    url: url.toString(),
    provider: 'embed',
    title: host,
    youtubeId: null
  };
}

function parseToken(req) {
  const raw = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  if (!raw) return null;
  try { return jwt.verify(raw, JWT_SECRET); } catch { return null; }
}
function requireAuth(req, res, next) {
  const token = parseToken(req);
  if (!token?.sub) return res.status(401).json({ error: 'Sign in to use this feature.' });
  req.user = { id: String(token.sub), email: token.email };
  next();
}
function sendError(res, err, fallback = 'Something went wrong.') {
  if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues[0]?.message || 'Invalid input.' });
  if (err instanceof InputError) return res.status(400).json({ error: err.message });
  if (err?.name === 'PrismaClientInitializationError' || err?.code === 'P1000' || err?.code === 'P1010') {
    console.error(err);
    return res.status(503).json({ error: 'Database access failed. Check DATABASE_URL credentials and ensure the MySQL user can access the watchparty database.' });
  }
  console.error(err);
  return res.status(500).json({ error: fallback });
}
function participantsFor(roomId) { return [...(roomParticipants.get(roomId)?.values() || [])]; }
function broadcastParticipants(roomId) {
  io.to(roomId).emit('room:participants', participantsFor(roomId).map(({ socketId, ...p }) => ({ ...p, socketId })));
}
async function normalizedRoomQueue(roomId) {
  const items = await prisma.roomVideo.findMany({ where: { roomId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
  if (items.some((item, index) => item.position !== index)) {
    await prisma.$transaction(items.map((item, index) => prisma.roomVideo.update({ where: { id: item.id }, data: { position: index } })));
  }
  return items.map((item, index) => ({ ...item, position: index }));
}

function liveState(roomId, room) {
  let state = playbackStates.get(roomId);
  if (!state) {
    state = { playing: false, position: 0, updatedAt: Date.now(), sequence: 0, videoUrl: room.currentVideoUrl || '', videoTitle: room.currentVideoTitle || '' };
    playbackStates.set(roomId, state);
  }
  return state;
}
function socketClientIp(socket) {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim().slice(0, 100);
  }
  return String(socket.handshake.address || 'unknown').slice(0, 100);
}
function allowJoinAttempt(socket, max = 30, windowMs = 60_000) {
  const ip = socketClientIp(socket); const now = Date.now();
  const recent = (joinAttemptsByIp.get(ip) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { joinAttemptsByIp.set(ip, recent); return false; }
  recent.push(now); joinAttemptsByIp.set(ip, recent); return true;
}

function allowSocketEvent(socket, max = 35, windowMs = 10_000) {
  const now = Date.now();
  const current = activityRate.get(socket.id) || [];
  const recent = current.filter((t) => now - t < windowMs);
  if (recent.length >= max) { activityRate.set(socket.id, recent); return false; }
  recent.push(now); activityRate.set(socket.id, recent); return true;
}
function ackError(ack, error) { if (typeof ack === 'function') ack({ ok: false, error }); }
function requireParticipant(socket, ack) {
  const p = socket.data.participant;
  if (!p) { ackError(ack, 'Join a room first.'); return null; }
  return p;
}
function canControl(socket, participant) {
  const room = socket.data.room;
  return participant.isHost || Boolean(room?.allowEveryoneControls);
}

app.get('/api/health', async (_req, res) => {
  try { await prisma.$queryRaw`SELECT 1`; res.json({ status: 'ok', database: 'connected' }); }
  catch { res.status(503).json({ status: 'error', database: 'unavailable' }); }
});

app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const data = authSchema.parse(req.body);
    if (!data.displayName) return res.status(400).json({ error: 'A display name is required for registration.' });
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) return res.status(409).json({ error: 'An account with that email already exists.' });
    const user = await prisma.user.create({ data: {
      email: data.email, displayName: data.displayName, passwordHash: await bcrypt.hash(data.password, 12), isGuest: false
    } });
    const token = jwt.sign({ email: user.email }, JWT_SECRET, { subject: user.id, expiresIn: '7d', issuer: 'together-watch-party' });
    res.status(201).json({ token, user: { id: user.id, email: user.email, displayName: user.displayName } });
  } catch (err) { sendError(res, err, 'Could not create the account.'); }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const data = authSchema.omit({ displayName: true }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user?.passwordHash || !(await bcrypt.compare(data.password, user.passwordHash))) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    const token = jwt.sign({ email: user.email }, JWT_SECRET, { subject: user.id, expiresIn: '7d', issuer: 'together-watch-party' });
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.displayName } });
  } catch (err) { sendError(res, err, 'Could not sign in.'); }
});

app.post('/api/rooms', roomCreateLimiter, async (req, res) => {
  let data;
  try { data = roomCreateSchema.parse(req.body); }
  catch (err) { return sendError(res, err); }
  try {
    let video = null;
    if (data.videoUrl) {
      try { video = parseVideoUrl(data.videoUrl); }
      catch (err) { return res.status(400).json({ error: err.message }); }
    }
    const existingUser = parseToken(req);
    let owner;
    if (existingUser?.sub) {
      owner = await prisma.user.findUnique({ where: { id: String(existingUser.sub) } });
    }
    if (!owner) owner = await prisma.user.create({ data: { displayName: data.displayName, isGuest: true } });
    let code;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = makeCode();
      if (!(await prisma.room.findUnique({ where: { code: candidate }, select: { id: true } }))) { code = candidate; break; }
    }
    if (!code) throw new Error('Could not generate a room code. Please retry.');
    const hostToken = crypto.randomBytes(32).toString('base64url');
    const room = await prisma.room.create({
      data: {
        code, name: data.roomName, isPublic: data.isPublic,
        passwordHash: data.roomPassword ? await bcrypt.hash(data.roomPassword, 12) : null,
        hostTokenHash: sha256(hostToken), allowEveryoneControls: data.allowEveryoneControls,
        currentVideoUrl: video?.url || null, currentVideoTitle: video?.title || null, ownerId: owner.id,
        ...(video ? { videos: { create: { url: video.url, title: video.title, provider: video.provider, addedBy: data.displayName, position: 0 } } } : {})
      }
    });
    res.status(201).json({ room: publicRoom(room), hostToken, inviteUrl: `${CLIENT_ORIGIN.split(',')[0].trim().replace(/:\/\//, '://')}/room/${room.code}` });
  } catch (err) { sendError(res, err, 'Could not create the room.'); }
});


app.post(
  '/api/rooms/:code/upload',
  rateLimit({
    windowMs: 60_000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false
  }),
  async (req, res) => {
    let uploadedFile = null;

    try {
      const code = String(req.params.code || '').toUpperCase();

      // Only the original host, identified by their secret host token,
      // can upload to this room.
      const room = await prisma.room.findUnique({
        where: { code }
      });

      if (!room) {
        return res.status(404).json({ error: 'Room not found.' });
      }

      const hostToken = req.get('X-Host-Token') || '';

      if (
        !hostToken ||
        !constantTimeEqual(
          sha256(hostToken),
          room.hostTokenHash
        )
      ) {
        return res.status(403).json({
          error: 'Only the host can upload videos.'
        });
      }

      // Parse the multipart upload only after checking host access.
      await new Promise((resolve, reject) => {
        videoUpload.single('video')(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      uploadedFile = req.file;

      if (!uploadedFile) {
        return res.status(400).json({
          error: 'Choose a video file to upload.'
        });
      }

      const roomId = room.id;
      const title = path
        .parse(uploadedFile.originalname)
        .name
        .replace(/[\x00-\x1f]/g, '')
        .trim()
        .slice(0, 200) || 'Uploaded video';

      const videoUrl = `/uploads/${uploadedFile.filename}`;

      const position = await prisma.roomVideo.count({
        where: { roomId }
      });

      // Save metadata in MySQL. The video bytes stay on disk.
      const video = await prisma.roomVideo.create({
        data: {
          roomId,
          url: videoUrl,
          title,
          provider: 'upload',
          addedBy: 'Host',
          position
        }
      });

      const updatedRoom = await prisma.room.update({
        where: { id: roomId },
        data: {
          currentVideoUrl: videoUrl,
          currentVideoTitle: title
        }
      });

      // Uploaded videos start paused. The host can press Play.
      const state = {
        playing: false,
        position: 0,
        updatedAt: Date.now(),
        sequence:
          (playbackStates.get(roomId)?.sequence || 0) + 1,
        videoUrl,
        videoTitle: title
      };

      playbackStates.set(roomId, state);

      // Notify everyone currently connected to this room.
      io.to(roomId).emit('room:media', {
        room: publicRoom(updatedRoom),
        video,
        playback: state
      });

      io.to(roomId).emit(
        'queue:changed',
        await normalizedRoomQueue(roomId)
      );

      return res.status(201).json({
        ok: true,
        video,
        message: 'Video uploaded and loaded for everyone.'
      });
    } catch (err) {
      // Remove an uploaded file if processing failed before completion.
      if (uploadedFile?.path) {
        const { unlink } = await import('node:fs/promises');
        await unlink(uploadedFile.path).catch(() => {});
      }

      if (err instanceof multer.MulterError) {
        const message =
          err.code === 'LIMIT_FILE_SIZE'
            ? `Video exceeds the ${Math.round(MAX_VIDEO_SIZE / 1024 / 1024)} MB upload limit.`
            : 'Upload failed. Check the file and try again.';

        return res.status(400).json({ error: message });
      }

      if (err.message?.startsWith('Unsupported video format') ||
          err.message === 'The uploaded file must be a video.') {
        return res.status(400).json({ error: err.message });
      }

      console.error('Video upload failed:', err);

      return res.status(500).json({
        error: 'Could not upload the video. Check server storage and database connectivity.'
      });
    }
  }
);

app.get('/api/rooms/public', async (_req, res) => {
  try {
    const rooms = await prisma.room.findMany({ where: { isPublic: true }, orderBy: { createdAt: 'desc' }, take: 30, select: {
      id: true, code: true, name: true, createdAt: true, currentVideoTitle: true, currentVideoUrl: true
    } });
    res.json({ rooms: rooms.map((r) => ({ ...r, hasVideo: Boolean(r.currentVideoUrl) })) });
  } catch (err) { sendError(res, err, 'Could not load public rooms.'); }
});

// A private playlist API demonstrates authenticated, owner-scoped persistent saved playlists.
app.get('/api/playlists', requireAuth, async (req, res) => {
  try {
    const playlists = await prisma.playlist.findMany({ where: { userId: req.user.id }, orderBy: { updatedAt: 'desc' }, include: { videos: { orderBy: { position: 'asc' } } } });
    res.json({ playlists });
  } catch (err) { sendError(res, err, 'Could not load playlists.'); }
});
app.post('/api/playlists', requireAuth, async (req, res) => {
  try {
    const data = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
    const playlist = await prisma.playlist.create({ data: { name: data.name, userId: req.user.id } });
    res.status(201).json({ playlist });
  } catch (err) { sendError(res, err, 'Could not create playlist.'); }
});
app.post('/api/playlists/:id/videos', requireAuth, async (req, res) => {
  try {
    const data = z.object({ url: z.string().trim().min(1).max(2048), title: z.string().trim().min(1).max(200).optional() }).parse(req.body);
    const video = parseVideoUrl(data.url);
    const playlist = await prisma.playlist.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!playlist) return res.status(404).json({ error: 'Playlist not found.' });
    const position = await prisma.playlistVideo.count({ where: { playlistId: playlist.id } });
    const saved = await prisma.playlistVideo.create({ data: { playlistId: playlist.id, url: video.url, provider: video.provider, title: data.title || video.title, position } });
    res.status(201).json({ video: saved });
  } catch (err) { sendError(res, err, 'Could not add video.'); }
});
app.delete('/api/playlists/:id', requireAuth, async (req, res) => {
  try {
    const playlist = await prisma.playlist.findFirst({ where: { id: req.params.id, userId: req.user.id }, select: { id: true } });
    if (!playlist) return res.status(404).json({ error: 'Playlist not found.' });
    await prisma.playlist.delete({ where: { id: playlist.id } });
    res.status(204).end();
  } catch (err) { sendError(res, err, 'Could not delete playlist.'); }
});

io.on('connection', (socket) => {
  socket.on('room:join', async (rawPayload, ack) => {
    try {
      if (!allowSocketEvent(socket, 10, 10_000) || !allowJoinAttempt(socket)) return ackError(ack, 'Too many attempts. Please wait a moment.');
      const data = joinSchema.parse(rawPayload);
      const room = await prisma.room.findUnique({ where: { code: data.code }, include: {
        videos: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }
      } });
      if (!room) return ackError(ack, 'Room not found. Check the room code or invitation link.');
      const isHostTokenValid = Boolean(data.hostToken) && constantTimeEqual(sha256(data.hostToken), room.hostTokenHash);
      if (room.passwordHash && !isHostTokenValid) {
        const passwordValid = Boolean(data.password) && await bcrypt.compare(data.password, room.passwordHash);
        if (!passwordValid) return ackError(ack, 'This room is private. Enter the correct room password.');
      }
      if (!room.isPublic && !room.passwordHash && !isHostTokenValid) {
        // Unlisted private rooms can still be joined by anyone holding their 8-character invite code.
      }
      if (socket.data.participant) {
        const old = socket.data.participant;
        socket.leave(old.roomId);
        const set = roomParticipants.get(old.roomId); set?.delete(socket.id);
        broadcastParticipants(old.roomId);
      }
      const signedIn = data.authToken ? (() => { try { return jwt.verify(data.authToken, JWT_SECRET); } catch { return null; } })() : null;
      const participant = {
        socketId: socket.id,
        roomId: room.id,
        participantId: crypto.randomUUID(),
        name: data.displayName,
        isHost: isHostTokenValid,
        userId: signedIn?.sub ? String(signedIn.sub) : null,
        joinedAt: new Date().toISOString()
      };
      socket.data.participant = participant;
      socket.data.room = { id: room.id, code: room.code, allowEveryoneControls: room.allowEveryoneControls };
      socket.join(room.id);
      if (!roomParticipants.has(room.id)) roomParticipants.set(room.id, new Map());
      roomParticipants.get(room.id).set(socket.id, participant);
      await prisma.room.update({ where: { id: room.id }, data: { lastActivityAt: new Date() } });
      const messages = await prisma.roomMessage.findMany({ where: { roomId: room.id }, orderBy: { createdAt: 'desc' }, take: 50 });
      const playback = liveState(room.id, room);
      ack?.({ ok: true, room: publicRoom(room), participant: { ...participant }, participants: participantsFor(room.id), playback, queue: room.videos, messages: messages.reverse() });
      broadcastParticipants(room.id);
      const systemMessage = await prisma.roomMessage.create({ data: { roomId: room.id, displayName: 'together.', content: `${data.displayName} joined the party`, kind: 'system' } });
      io.to(room.id).emit('chat:new', systemMessage);
    } catch (err) {
      if (err instanceof z.ZodError) return ackError(ack, err.issues[0]?.message || 'Invalid join details.');
      console.error('room:join error', err);
      ackError(ack, 'Could not join the room. Please try again.');
    }
  });

  socket.on('chat:send', async (payload, ack) => {
    try {
      const p = requireParticipant(socket, ack); if (!p) return;
      if (!allowSocketEvent(socket, 8, 10_000)) return ackError(ack, 'You are sending messages too quickly.');
      const data = z.object({ content: z.string().trim().min(1).max(500), kind: z.enum(['chat', 'reaction']).optional().default('chat') }).parse(payload);
      const message = await prisma.roomMessage.create({ data: {
        roomId: socket.data.room.id, userId: p.userId, displayName: p.name, content: data.content, kind: data.kind
      } });
      io.to(socket.data.room.id).emit('chat:new', message);
      ack?.({ ok: true, messageId: message.id });
    } catch (err) { ackError(ack, err instanceof z.ZodError ? err.issues[0]?.message : 'Message could not be sent.'); }
  });

  socket.on('playback:command', async (payload, ack) => {
    try {
      const p = requireParticipant(socket, ack); if (!p) return;
      if (!canControl(socket, p)) return ackError(ack, 'Only the host can control playback.');
      if (!allowSocketEvent(socket, 30, 10_000)) return ackError(ack, 'Playback updates are arriving too quickly.');
      const data = z.object({ action: z.enum(['play', 'pause', 'seek', 'sync']), position: z.number().finite().min(0).max(1_000_000).optional(), playing: z.boolean().optional() }).parse(payload);
      const roomId = socket.data.room.id;
      const state = playbackStates.get(roomId) || { playing: false, position: 0, updatedAt: Date.now(), sequence: 0, videoUrl: '', videoTitle: '' };
      if (data.position !== undefined) state.position = data.position;
      if (data.action === 'play') state.playing = true;
      else if (data.action === 'pause') state.playing = false;
      else if (data.action === 'sync' && data.playing !== undefined) state.playing = data.playing;
      state.updatedAt = Date.now(); state.sequence += 1;
      playbackStates.set(roomId, state);
      socket.to(roomId).emit('playback:updated', { ...state, action: data.action });
      ack?.({ ok: true, sequence: state.sequence });
    } catch (err) { ackError(ack, err instanceof z.ZodError ? err.issues[0]?.message : 'Playback update failed.'); }
  });

  socket.on('room:set-video', async (payload, ack) => {
    try {
      const p = requireParticipant(socket, ack); if (!p) return;
      if (!p.isHost) return ackError(ack, 'Only the host can change the video.');
      const data = z.object({ url: z.string().trim().min(1).max(2048), title: z.string().trim().max(200).optional() }).parse(payload);
      if (!allowSocketEvent(socket, 10, 10_000)) return ackError(ack, 'Too many video changes. Please wait a moment.');
      const video = parseVideoUrl(data.url);
      const roomId = socket.data.room.id;
      const room = await prisma.room.update({ where: { id: roomId }, data: { currentVideoUrl: video.url, currentVideoTitle: data.title || video.title } });
      const position = await prisma.roomVideo.count({ where: { roomId } });
      const queueItem = await prisma.roomVideo.create({ data: { roomId, url: video.url, title: data.title || video.title, provider: video.provider, addedBy: p.name, position } });
      const state = { playing: false, position: 0, updatedAt: Date.now(), sequence: (playbackStates.get(roomId)?.sequence || 0) + 1, videoUrl: room.currentVideoUrl, videoTitle: room.currentVideoTitle };
      playbackStates.set(roomId, state);
      io.to(roomId).emit('room:media', { room: publicRoom(room), video: queueItem, playback: state });
      io.to(roomId).emit('queue:changed', await normalizedRoomQueue(roomId));
      ack?.({ ok: true, video: queueItem });
    } catch (err) {
      if (err instanceof z.ZodError) return ackError(ack, err.issues[0]?.message || 'Invalid video details.');
      if (err instanceof InputError) return ackError(ack, err.message);
      console.error('room:set-video failed', err); ackError(ack, 'Could not change video.');
    }
  });

  socket.on('queue:add', async (payload, ack) => {
    try {
      const p = requireParticipant(socket, ack); if (!p) return;
      if (!p.isHost) return ackError(ack, 'Only the host can manage the queue.');
      const data = z.object({ url: z.string().trim().min(1).max(2048), title: z.string().trim().max(200).optional() }).parse(payload);
      if (!allowSocketEvent(socket, 10, 10_000)) return ackError(ack, 'Too many queue changes. Please wait a moment.');
      const video = parseVideoUrl(data.url); const roomId = socket.data.room.id;
      const position = await prisma.roomVideo.count({ where: { roomId } });
      const item = await prisma.roomVideo.create({ data: { roomId, url: video.url, title: data.title || video.title, provider: video.provider, addedBy: p.name, position } });
      io.to(roomId).emit('queue:changed', await normalizedRoomQueue(roomId));
      ack?.({ ok: true, video: item });
    } catch (err) {
      if (err instanceof z.ZodError) return ackError(ack, err.issues[0]?.message || 'Invalid video details.');
      if (err instanceof InputError) return ackError(ack, err.message);
      console.error('queue:add failed', err); ackError(ack, 'Could not add video.');
    }
  });

  socket.on('queue:play', async (payload, ack) => {
    try {
      const p = requireParticipant(socket, ack); if (!p) return;
      if (!p.isHost) return ackError(ack, 'Only the host can play queue items.');
      if (!allowSocketEvent(socket, 20, 10_000)) return ackError(ack, 'Too many queue changes. Please wait a moment.');
      const data = z.object({ videoId: z.string().min(1).max(30) }).parse(payload);
      const roomId = socket.data.room.id;
      const video = await prisma.roomVideo.findFirst({ where: { id: data.videoId, roomId } });
      if (!video) return ackError(ack, 'That queue item no longer exists.');
      const room = await prisma.room.update({ where: { id: roomId }, data: { currentVideoUrl: video.url, currentVideoTitle: video.title } });
      const state = { playing: false, position: 0, updatedAt: Date.now(), sequence: (playbackStates.get(roomId)?.sequence || 0) + 1, videoUrl: video.url, videoTitle: video.title };
      playbackStates.set(roomId, state);
      io.to(roomId).emit('room:media', { room: publicRoom(room), video, playback: state });
      ack?.({ ok: true });
    } catch (err) { ackError(ack, 'Could not play that queue item.'); }
  });

  socket.on('queue:remove', async (payload, ack) => {
    try {
      const p = requireParticipant(socket, ack); if (!p) return;
      if (!p.isHost) return ackError(ack, 'Only the host can remove queue items.');
      if (!allowSocketEvent(socket, 20, 10_000)) return ackError(ack, 'Too many queue changes. Please wait a moment.');
      const data = z.object({ videoId: z.string().min(1).max(30) }).parse(payload);
      const roomId = socket.data.room.id;
      await prisma.roomVideo.deleteMany({ where: { id: data.videoId, roomId } });
      const videos = await normalizedRoomQueue(roomId);
      io.to(roomId).emit('queue:changed', videos); ack?.({ ok: true });
    } catch { ackError(ack, 'Could not remove that queue item.'); }
  });

  socket.on('queue:move', async (payload, ack) => {
    try {
      const p = requireParticipant(socket, ack); if (!p) return;
      if (!p.isHost) return ackError(ack, 'Only the host can reorder the queue.');
      if (!allowSocketEvent(socket, 20, 10_000)) return ackError(ack, 'Too many queue changes. Please wait a moment.');
      const data = z.object({ videoId: z.string().min(1).max(30), direction: z.enum(['up', 'down']) }).parse(payload);
      const roomId = socket.data.room.id;
      const videos = await normalizedRoomQueue(roomId);
      const currentIndex = videos.findIndex((video) => video.id === data.videoId);
      if (currentIndex < 0) return ackError(ack, 'That queue item no longer exists.');
      const targetIndex = currentIndex + (data.direction === 'up' ? -1 : 1);
      if (targetIndex < 0 || targetIndex >= videos.length) return ackError(ack, 'That item is already at the edge of the queue.');
      const current = videos[currentIndex]; const neighbor = videos[targetIndex];
      await prisma.$transaction([
        prisma.roomVideo.update({ where: { id: current.id }, data: { position: neighbor.position } }),
        prisma.roomVideo.update({ where: { id: neighbor.id }, data: { position: current.position } })
      ]);
      io.to(roomId).emit('queue:changed', await normalizedRoomQueue(roomId));
      ack?.({ ok: true });
    } catch (err) { ackError(ack, err instanceof z.ZodError ? err.issues[0]?.message : 'Could not reorder the queue.'); }
  });

  socket.on('room:update-settings', async (payload, ack) => {
    try {
      const p = requireParticipant(socket, ack); if (!p) return;
      if (!p.isHost) return ackError(ack, 'Only the host can change room settings.');
      if (!allowSocketEvent(socket, 10, 10_000)) return ackError(ack, 'Too many settings changes. Please wait a moment.');
      const data = z.object({ allowEveryoneControls: z.boolean() }).parse(payload);
      const room = await prisma.room.update({ where: { id: socket.data.room.id }, data });
      for (const peer of io.sockets.sockets.values()) {
        if (peer.data.room?.id === room.id) peer.data.room.allowEveryoneControls = room.allowEveryoneControls;
      }
      io.to(room.id).emit('room:settings', { allowEveryoneControls: room.allowEveryoneControls });
      ack?.({ ok: true });
    } catch (err) { ackError(ack, 'Could not update room settings.'); }
  });

  socket.on('room:kick', (payload, ack) => {
    const p = requireParticipant(socket, ack); if (!p) return;
    if (!p.isHost) return ackError(ack, 'Only the host can remove participants.');
    const data = z.object({ socketId: z.string().min(1).max(80) }).safeParse(payload);
    if (!data.success) return ackError(ack, 'Invalid participant.');
    const target = io.sockets.sockets.get(data.data.socketId);
    if (!target || target.data.participant?.roomId !== p.roomId || target.id === socket.id) return ackError(ack, 'Participant not found.');
    target.emit('room:kicked', { message: 'The host removed you from this room.' });
    target.disconnect(true); ack?.({ ok: true });
  });

  socket.on('room:transfer-host', (payload, ack) => {
    const p = requireParticipant(socket, ack); if (!p) return;
    if (!p.isHost) return ackError(ack, 'Only the host can transfer host privileges.');
    const data = z.object({ socketId: z.string().min(1).max(80) }).safeParse(payload);
    if (!data.success) return ackError(ack, 'Invalid participant.');
    const participants = roomParticipants.get(p.roomId);
    const target = participants?.get(data.data.socketId);
    if (!target || target.socketId === socket.id) return ackError(ack, 'Choose another participant.');
    p.isHost = false; target.isHost = true;
    const targetSocket = io.sockets.sockets.get(target.socketId);
    if (targetSocket) targetSocket.data.participant.isHost = true;
    io.to(p.roomId).emit('room:host-changed', { socketId: target.socketId, name: target.name });
    broadcastParticipants(p.roomId); ack?.({ ok: true });
  });

  socket.on('disconnect', async () => {
    activityRate.delete(socket.id);
    const p = socket.data.participant;
    if (!p) return;
    const roomId = p.roomId || socket.data.room?.id;
    const participants = roomParticipants.get(roomId);
    participants?.delete(socket.id);
    if (participants?.size === 0) {
      roomParticipants.delete(roomId);
      playbackStates.delete(roomId);
    } else {
      broadcastParticipants(roomId);
      try {
        const msg = await prisma.roomMessage.create({ data: { roomId, displayName: 'together.', content: `${p.name} left the party`, kind: 'system' } });
        io.to(roomId).emit('chat:new', msg);
      } catch (err) { console.error('Unable to store leave event', err); }
    }
  });
});

// Expire rooms that have been inactive for 30 days. Active rooms have their activity
// timestamp refreshed hourly; participants and live playback state remain in memory only.
async function cleanupExpiredRooms() {
  const activeIds = [...roomParticipants.keys()];
  if (activeIds.length) {
    await prisma.room.updateMany({ where: { id: { in: activeIds } }, data: { lastActivityAt: new Date() } });
  }
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  for (const [ip, attempts] of joinAttemptsByIp) {
    const recent = attempts.filter((t) => Date.now() - t < 60_000);
    if (recent.length) joinAttemptsByIp.set(ip, recent); else joinAttemptsByIp.delete(ip);
  }
  const result = await prisma.room.deleteMany({ where: { lastActivityAt: { lt: cutoff } } });
  if (result.count) console.log(`Expired ${result.count} inactive room(s).`);
  await prisma.user.deleteMany({
    where: { isGuest: true, updatedAt: { lt: cutoff }, rooms: { none: {} }, messages: { none: {} }, playlists: { none: {} } }
  });
}
const maintenanceTimer = setInterval(() => cleanupExpiredRooms().catch((err) => console.error('Room cleanup failed:', err)), 60 * 60 * 1000);
maintenanceTimer.unref();

// Serve the built React frontend in production.
const clientDistPath = path.resolve(
  currentDirectory,
  '../../client/dist'
);

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDistPath));

  // Return the React application for frontend routes.
  app.use((req, res, next) => {
    if (
      req.method !== 'GET' ||
      req.path.startsWith('/api/') ||
      req.path === '/socket.io'
    ) {
      return next();
    }

    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Watch Party API and Socket.IO listening on :${PORT}`);
  cleanupExpiredRooms().catch((err) => console.error('Initial room cleanup failed:', err));
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down...`);
  clearInterval(maintenanceTimer);
  setTimeout(() => process.exit(1), 10_000).unref();
  io.close(async () => { await prisma.$disconnect(); process.exit(0); });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
