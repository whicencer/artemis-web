"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

type AutoplayMode = "prefer-sound" | "muted";

type LiveFeedCardProps = {
  title: string;
  sourceUrl: string;
  autoplayMode: AutoplayMode;
};

type PlayerLike = {
  playVideo?: () => void;
  pauseVideo?: () => void;
  mute?: () => void;
  unMute?: () => void;
  isMuted?: () => boolean;
  getPlayerState?: () => number;
  setSize?: (w: number, h: number) => void;
  destroy?: () => void;
};

type YouTubeFactory = {
  Player: new (elementId: string, options: unknown) => PlayerLike;
};

declare global {
  interface Window {
    YT?: YouTubeFactory;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<YouTubeFactory> | null = null;

function loadYouTubeApi(): Promise<YouTubeFactory> {
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => reject(new Error("Failed to load YouTube IFrame API."));
      document.head.appendChild(script);
    }

    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube API loaded without Player."));
    };
  });

  return youtubeApiPromise;
}

function parseYoutubeId(url: string): string | null {
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
  const match = url.match(/[?&]v=([^&]+)/) ?? url.match(/youtube\.com\/live\/([^?&/]+)/) ?? url.match(/youtu\.be\/([^?&/]+)/);
  return match?.[1] ?? null;
}

function iconVolume(muted: boolean) {
  if (muted) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 10v4h4l5 4V6L7 10H3zM16 9l5 6m0-6-5 6" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 10v4h4l5 4V6L7 10H3zM16 8a6 6 0 010 8m2-11a10 10 0 010 14" />
    </svg>
  );
}

function iconFullscreen(active: boolean) {
  if (active) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 3H3v5m13-5h5v5M8 21H3v-5m18 5h-5v-5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3H3v5m0 8v5h5m8 0h5v-5m0-8V3h-5" />
    </svg>
  );
}

export function LiveFeedCard({ title, sourceUrl, autoplayMode }: LiveFeedCardProps) {
  const cardRef = useRef<HTMLElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<PlayerLike | null>(null);
  const readyRef = useRef(false);
  const id = useId().replace(/[:]/g, "");

  const videoId = useMemo(() => parseYoutubeId(sourceUrl), [sourceUrl]);

  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(autoplayMode === "muted");
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const resizePlayer = useCallback(() => {
    const host = hostRef.current;
    const player = playerRef.current;
    if (!host || !player || typeof player.setSize !== "function") return;
    const rect = host.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    player.setSize(Math.floor(rect.width), Math.floor(rect.height));
  }, []);

  const ensureMutedState = useCallback(() => {
    const player = playerRef.current;
    if (!player || typeof player.isMuted !== "function") return;
    setMuted(Boolean(player.isMuted()));
  }, []);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setPlaying(false);
    setAutoplayBlocked(false);
    setError(null);

    if (!videoId) {
      setLoading(false);
      setError("Invalid YouTube source.");
      return;
    }

    const hostElement = hostRef.current;
    if (!hostElement) return;
    hostElement.innerHTML = "";

    loadYouTubeApi()
      .then((YT) => {
        if (disposed) return;

        const playerRoot = document.createElement("div");
        playerRoot.id = `yt-player-${id}`;
        hostElement.appendChild(playerRoot);

        const player = new YT.Player(playerRoot.id, {
          videoId,
          playerVars: {
            autoplay: 1,
            controls: 0,
            rel: 0,
            playsinline: 1,
            modestbranding: 1,
            mute: autoplayMode === "muted" ? 1 : 0
          },
          events: {
            onReady: () => {
              if (disposed) return;
              readyRef.current = true;
              setLoading(false);
              resizePlayer();

              if (autoplayMode === "muted") {
                player.mute?.();
                player.playVideo?.();
                setMuted(true);
                return;
              }

              player.unMute?.();
              player.playVideo?.();
              setMuted(false);

              window.setTimeout(() => {
                if (disposed) return;
                const state = typeof player.getPlayerState === "function" ? player.getPlayerState() : -1;
                const isPlaying = state === 1 || state === 3;
                if (isPlaying) {
                  ensureMutedState();
                  return;
                }
                player.mute?.();
                player.playVideo?.();
                setMuted(true);
                setAutoplayBlocked(true);
              }, 900);
            },
            onStateChange: (evt: { data: number }) => {
              if (disposed) return;
              const state = evt.data;
              setPlaying(state === 1 || state === 3);
              if (state === 1) {
                setAutoplayBlocked(false);
                ensureMutedState();
              }
            },
            onError: (evt: { data: number }) => {
              if (disposed) return;
              setLoading(false);
              setPlaying(false);
              setError(`YouTube player error (${evt.data}).`);
            }
          }
        });

        playerRef.current = player;
      })
      .catch((err: unknown) => {
        if (disposed) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : "Unable to initialize stream.");
      });

    return () => {
      disposed = true;
      readyRef.current = false;
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, [autoplayMode, ensureMutedState, id, resizePlayer, videoId]);

  useEffect(() => {
    const onResize = () => resizePlayer();
    const onFsChange = () => {
      const active = document.fullscreenElement === cardRef.current;
      setFullscreen(active);
      resizePlayer();
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("fullscreenchange", onFsChange);
    };
  }, [resizePlayer]);

  const toggleMute = useCallback(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;
    if (muted) {
      player.unMute?.();
      player.playVideo?.();
      setMuted(false);
      setAutoplayBlocked(false);
      return;
    }
    player.mute?.();
    setMuted(true);
  }, [muted]);

  const toggleFullscreen = useCallback(async () => {
    const root = cardRef.current;
    if (!root) return;
    try {
      if (document.fullscreenElement === root) {
        await document.exitFullscreen();
      } else {
        await root.requestFullscreen();
      }
    } catch {
      // no-op on browsers that block fullscreen request
    }
  }, []);

  const startFeed = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (autoplayMode === "prefer-sound") {
      player.unMute?.();
      setMuted(false);
    } else {
      player.mute?.();
      setMuted(true);
    }
    player.playVideo?.();
    setAutoplayBlocked(false);
  }, [autoplayMode]);

  return (
    <article className={`feed-card ${playing ? "is-playing" : ""}`} ref={cardRef}>
      <div className="feed-head">
        <div className="feed-title-wrap">
          <span className="live-badge">LIVE</span>
          <h3>{title}</h3>
        </div>
        <div className="feed-controls">
          <button type="button" className="icon-btn" onClick={toggleMute} aria-label={muted ? "Unmute feed" : "Mute feed"}>
            {iconVolume(muted)}
          </button>
          <button type="button" className="icon-btn" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}>
            {iconFullscreen(fullscreen)}
          </button>
        </div>
      </div>

      <div className="feed-player-shell">
        <div className="feed-player-host" ref={hostRef} />

        {loading && <div className="feed-overlay">Initializing live feed…</div>}

        {!loading && autoplayBlocked && !playing && !error && (
          <button type="button" className="feed-overlay-btn" onClick={startFeed}>
            Click to start live feed
          </button>
        )}

        {!loading && error && (
          <div className="feed-overlay error">
            <p>{error}</p>
            <a href={sourceUrl} target="_blank" rel="noreferrer noopener">
              Open official stream
            </a>
          </div>
        )}

        <div className="feed-state">{playing ? (muted ? "MUTED" : "AUDIO ON") : "STANDBY"}</div>
      </div>

      <div className="feed-foot">
        <span>YouTube official</span>
      </div>
    </article>
  );
}
