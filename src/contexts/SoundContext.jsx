import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Howl, Howler } from 'howler';

const SoundContext = createContext();

export const useSound = () => {
    const context = useContext(SoundContext);
    if (!context) {
        throw new Error('useSound must be used within a SoundProvider');
    }
    return context;
};

export const SoundProvider = ({ children }) => {
    const [isMuted, setIsMuted] = useState(() => {
        const saved = localStorage.getItem('isMuted');
        return saved === 'true';
    });

    const sounds = useRef({});
    const pendingSounds = useRef([]); // sounds that failed to play due to autoplay policy
    const [audioContextState, setAudioContextState] = useState('unknown');
    const isInitialized = useRef(false);

    // --- STABLE INITIALIZATION ---
    useEffect(() => {
        if (isInitialized.current) return;


        if (typeof window !== 'undefined') {
            Howler.html5PoolSize = 100;
            Howler.autoUnlock = true;
        }

        const soundDefinitions = {
            tap: { path: '/sounds/tap.mp3', volume: 0.3, html5: false },
            ding: { path: '/sounds/ding.mp3', volume: 0.6, html5: true },
            whoosh: { path: '/sounds/whoosh.mp3', volume: 0.6, html5: true },
            beep: { path: '/sounds/beep.mp3', volume: 0.6, html5: false },
            buzz: { path: '/sounds/buzz.mp3', volume: 0.6, html5: false },
            sparkle: { path: '/sounds/sparkle.mp3', volume: 0.6, html5: false },
            drumroll: { path: '/sounds/drumroll.mp3', volume: 0.6, html5: true },
            pop: { path: '/sounds/pop.mp3', volume: 0.6, html5: false },
            tick: { path: '/sounds/tick.mp3', volume: 1.0, html5: false },
            coin: { path: '/sounds/coin.mp3', volume: 0.6, html5: false },
            cheer: { path: '/sounds/cheer.mp3', volume: 0.6, html5: true },
            confetti: { path: '/sounds/confetti.mp3', volume: 0.6, html5: true },
            giggle: { path: '/sounds/giggling.mp3', volume: 0.6, html5: false }
        };

        Object.entries(soundDefinitions).forEach(([name, def]) => {
            const absolutePath = def.path.startsWith('/') ? def.path : `/${def.path}`;
            sounds.current[name] = new Howl({
                src: [absolutePath],
                html5: def.html5,
                preload: true,
                format: ['mp3'],
                volume: def.volume,
                onplayerror: (id, error) => {
                    console.warn(`[SoundContext] Blocked: ${name}`, error);
                    if (!pendingSounds.current.includes(name)) pendingSounds.current.push(name);
                    const s = sounds.current[name];
                    if (s) s.once('unlock', () => s.play());
                }
            });
        });

        isInitialized.current = true;
    }, []);


    const isUnlocked = useRef(false);

    // Unlock logic (Mobile Browsers require interaction to start AudioContext)
    useEffect(() => {
        const unlockAudio = (e) => {
            if (isUnlocked.current) return;


            // 1. Force context resume
            if (Howler.ctx) {
                try {
                    if (Howler.ctx.state !== 'running') Howler.ctx.resume();

                    // Buffer priming (Web Audio)
                    const source = Howler.ctx.createBufferSource();
                    source.buffer = Howler.ctx.createBuffer(1, 1, 22050);
                    source.connect(Howler.ctx.destination);
                    source.start(0);

                    setAudioContextState(Howler.ctx.state);
                } catch (err) {
                    console.error("[SoundContext] Resume error:", err);
                }
            }

            // 2. Tactical Double-Prime & Force Load
            // Safari needs network requests + playback window to happen INSIDE the gesture handler.
            const tap = sounds.current['tap']; // WebAudio (html5: false)
            const ding = sounds.current['ding']; // HTML5 (html5: true)

            const primeSound = (s) => {
                if (!s) return;
                try {
                    const originalVol = s.volume();
                    s.volume(0.001);
                    s.play();
                    // Give Safari 100ms of "active audio" to wake the hardware
                    setTimeout(() => {
                        s.stop();
                        s.volume(originalVol);
                    }, 100);
                } catch (err) {
                    console.warn("[SoundContext] Double-Prime Error:", err);
                }
            };

            // Wake both engines
            primeSound(tap);
            primeSound(ding);

            // Force Load ALL sounds (Satisfies network requirement within gesture)
            Object.values(sounds.current).forEach((s) => {
                if (s.state() === 'unloaded') s.load();
            });

            // 3. Cleanup & Run-Once Enforcement
            isUnlocked.current = true;
            events.forEach(ev => window.removeEventListener(ev, unlockAudio, true));

            // Clear pending queue
            while (pendingSounds.current.length > 0) {
                const name = pendingSounds.current.shift();
                sounds.current[name]?.play();
            }
        };

        const events = ['click', 'touchstart', 'touchend', 'mousedown', 'keydown'];
        events.forEach(ev => window.addEventListener(ev, unlockAudio, true));
        return () => events.forEach(ev => window.removeEventListener(ev, unlockAudio, true));
    }, []);

    // Also resume on page visibility change
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && Howler.ctx) {
                if (Howler.ctx.state === 'suspended') Howler.ctx.resume();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    // Sync mute state
    useEffect(() => {
        Howler.mute(isMuted);
        localStorage.setItem('isMuted', isMuted);
    }, [isMuted]);

    const toggleMute = () => setIsMuted(prev => !prev);

    const playSound = useCallback((name) => {
        const sound = sounds.current[name];
        if (!sound) {
            console.warn(`[SoundContext] Sound "${name}" not found.`);
            return;
        }

        // For mobile Safari, ensure context is resumed on EVERY play attempt
        if (Howler.ctx && Howler.ctx.state !== 'running') {
            Howler.ctx.resume();
        }

        // Restart short sounds
        if (name === 'tap' || name === 'tick') {
            sound.stop();
        }

        if (sound.state() === 'loaded') {
            sound.play();
        } else {
            sound.load();
            sound.once('load', () => sound.play());
        }
    }, []);

    const stopSound = useCallback((name) => {
        sounds.current[name]?.stop();
    }, []);

    return (
        <SoundContext.Provider value={{ isMuted, toggleMute, playSound, stopSound, audioContextState }}>
            {children}
        </SoundContext.Provider>
    );
};
