import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, LockKeyhole, Play, Radio } from 'lucide-react';
import type { Playback } from '../types';

declare global {
  interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void; }
}

type Props = {
  url: string | null;
  title: string | null;
  canControl: boolean;
  isHost: boolean;
  playback: Playback;
  onCommand: (action: 'play' | 'pause' | 'seek' | 'sync', position: number, playing?: boolean) => void;
};
let youtubeApiPromise: Promise<void> | null = null;
function loadYoutubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-youtube-iframe-api]');
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(); };
    if (!existing) {
      const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api';
      script.dataset.youtubeIframeApi = 'true'; document.head.appendChild(script);
    }
    const started = Date.now();
    const poll = window.setInterval(() => {
      if (window.YT?.Player) { window.clearInterval(poll); resolve(); }
      if (Date.now() - started > 15_000) { window.clearInterval(poll); resolve(); }
    }, 100);
  });
  return youtubeApiPromise;
}
function getYoutubeId(url: string) {
  try {
    const parsed = new URL(url); const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0];
    if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) {
      if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
      if (/^\/(embed|shorts|live)\//.test(parsed.pathname)) return parsed.pathname.split('/')[2];
    }
  } catch { /* URL is validated by the server; keep the player error friendly. */ }
  return null;
}
function desiredPosition(state: Playback) {
  return Math.max(0, state.position + (state.playing ? Math.max(0, Date.now() - state.updatedAt) / 1000 : 0));
}

export default function VideoPlayer({ url, title, canControl, isHost, playback, onCommand }: Props) {
  const iframeMountRef = useRef<HTMLDivElement>(null);
  const ytRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const syncGuard = useRef(false);
  const [ready, setReady] = useState(false);
  const [playerError, setPlayerError] = useState('');
  const [playerKey, setPlayerKey] = useState(0);
  const youtubeId = url ? getYoutubeId(url) : null;
  const isYoutube = Boolean(youtubeId);

  const isDirectVideo = (() => {
    if (!url) return false;

    try {
      return /\.(mp4|webm|ogv|ogg|m4v|mov|mp3|m4a|aac|wav|oga)$/i
        .test(new URL(url).pathname);
    } catch {
      return false;
    }
  })();

  const isGenericEmbed = Boolean(url) && !isYoutube && !isDirectVideo;

  useEffect(() => {
    setReady(false); setPlayerError(''); setPlayerKey((k) => k + 1);
    ytRef.current?.destroy?.(); ytRef.current = null;
  }, [url]);

  useEffect(() => {
    if (!isYoutube || !youtubeId || !iframeMountRef.current) return;
    let disposed = false;
    loadYoutubeApi().then(() => {
      if (disposed || !iframeMountRef.current || !window.YT?.Player) return;
      ytRef.current?.destroy?.();
      ytRef.current = new window.YT.Player(iframeMountRef.current, {
        videoId: youtubeId,
        playerVars: { autoplay: 0, controls: canControl ? 1 : 0, rel: 0, playsinline: 1, enablejsapi: 1, origin: window.location.origin, iv_load_policy: 3 },
        events: {
          onReady: (event: any) => {
            if (disposed) return;
            setReady(true);
            syncGuard.current = true;
            const target = desiredPosition(playback);
            if (target > 0.6) event.target.seekTo(target, true);
            if (playback.playing) event.target.playVideo();
            else event.target.pauseVideo();
            window.setTimeout(() => { syncGuard.current = false; }, 450);
          },
          onStateChange: (event: any) => {
            if (disposed || !canControl || syncGuard.current) return;
            const time = Number(event.target.getCurrentTime?.() || 0);
            if (event.data === window.YT?.PlayerState?.PLAYING) onCommand('play', time);
            if (event.data === window.YT?.PlayerState?.PAUSED) onCommand('pause', time);
          },
          onError: (event: any) => {
            const messages: Record<number, string> = { 2: 'The video URL is invalid.', 5: 'This video cannot be played in the embedded player.', 100: 'This video is unavailable or private.', 101: 'The owner does not allow this video to be embedded.', 150: 'The owner does not allow this video to be embedded.' };
            setPlayerError(messages[event.data] || 'The video could not be loaded. It may be unavailable or restricted.');
          }
        }
      });
    });
    return () => { disposed = true; try { ytRef.current?.destroy?.(); } catch { /* no-op */ } ytRef.current = null; };
    // Playback changes are applied in the dedicated effect below, not by recreating the iframe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isYoutube, youtubeId, canControl, isHost, playerKey]);

  useEffect(() => {
    if (!ready || !isYoutube || !ytRef.current) return;
    const player = ytRef.current;
    const target = desiredPosition(playback);
    try {
      const current = Number(player.getCurrentTime?.() || 0);
      syncGuard.current = true;
      if (Math.abs(current - target) > 1.8) player.seekTo(target, true);
      if (playback.playing && player.getPlayerState?.() !== window.YT?.PlayerState?.PLAYING) player.playVideo();
      if (!playback.playing && player.getPlayerState?.() !== window.YT?.PlayerState?.PAUSED && player.getPlayerState?.() !== window.YT?.PlayerState?.CUED) player.pauseVideo();
      window.setTimeout(() => { syncGuard.current = false; }, 450);
    } catch { /* iframe can be in a transient loading state */ }
  }, [playback, canControl, isHost, ready, isYoutube]);

  useEffect(() => {
    if (!isHost || !ready || !isYoutube) return;
    const timer = window.setInterval(() => {
      const player = ytRef.current;
      if (!player || player.getPlayerState?.() !== window.YT?.PlayerState?.PLAYING) return;
      onCommand('sync', Number(player.getCurrentTime?.() || 0), true);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [isHost, ready, isYoutube, onCommand]);

  useEffect(() => {
    if (!isHost || isYoutube || !url) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused || video.ended) return;
      onCommand('sync', video.currentTime, true);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [isHost, isYoutube, url, onCommand]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || isYoutube || !url) return;
    syncGuard.current = true;
    const target = desiredPosition(playback);
    if (Number.isFinite(target) && Math.abs(video.currentTime - target) > 1.8) video.currentTime = target;
    if (playback.playing) void video.play().catch(() => setPlayerError('Your browser blocked autoplay. Press play to continue.'));
    else video.pause();
    const release = window.setTimeout(() => { syncGuard.current = false; }, 300);
    return () => window.clearTimeout(release);
  }, [playback, canControl, isHost, isYoutube, url, playerKey]);

  const handleVideoTime = useCallback(() => {
    const video = videoRef.current;
    if (canControl && video && !syncGuard.current) onCommand('seek', video.currentTime, !video.paused);
  }, [canControl, onCommand]);

  if (!url) {
    return <div className="player-empty"><div className="empty-play"><Play size={30} fill="currentColor" /></div><p className="eyebrow">YOUR SCREEN IS READY</p><h3>Pick something to watch</h3><p>Paste a YouTube link or a direct video URL to get the party started.</p></div>;
  }
  return <div className="player-frame" key={playerKey}>

    {isYoutube ? (
      <div className="youtube-shell">
        <div
          className="youtube-mount"
          ref={iframeMountRef}
        />
      </div>
    ) : isDirectVideo ? (
      <video
        ref={videoRef}
        src={url}
        controls={canControl}
        playsInline
        preload="metadata"
        onLoadedData={() => setReady(true)}
        onPlay={() => {
          if (canControl && !syncGuard.current && videoRef.current) {
            onCommand('play', videoRef.current.currentTime);
          }
        }}
        onPause={() => {
          if (canControl && !syncGuard.current && videoRef.current) {
            onCommand('pause', videoRef.current.currentTime);
          }
        }}
        onSeeked={handleVideoTime}
        onError={() => {
          setPlayerError(
            'This media file could not be played. Check its URL, format, and server permissions.'
          );
        }}
      />
    ) : (
      <div className="external-player">
        <iframe
          src={url!}
          title={title || 'Embedded media'}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setReady(true)}
        />

        <div className="external-player-notice">
          <strong>Third-party player</strong>
          <span>
            Playback synchronization depends on the source site.
            If embedding is blocked, open the link on its original website.
          </span>
          <a
            href={url!}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open original site
          </a>
        </div>
      </div>
    )}

    {!ready && !playerError && <div className="player-loading"><span className="loading-orbit" /><span>{isYoutube ? 'Connecting to YouTube…' : 'Loading video…'}</span></div>}
    {!canControl && <div className="viewer-note"><LockKeyhole size={13} /> Host-controlled playback</div>}
    {playerError && <div className="player-error"><AlertTriangle size={18} /><div><strong>Playback issue</strong><span>{playerError}</span></div><button onClick={() => { setPlayerError(''); setPlayerKey((k) => k + 1); }}>Retry</button></div>}
    <div className="player-live">
      <Radio size={12} />
      {isGenericEmbed ? 'EMBED ONLY' : 'LIVE SYNC'}
    </div>
    {title && <div className="player-title">{title}</div>}
  </div>;
}
