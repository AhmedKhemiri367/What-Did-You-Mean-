import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useRoom } from '../contexts/RoomContext';
import { useSound } from '../contexts/SoundContext';

import SpectatorView from '../components/SpectatorView';

function TextPhase({ isDarkMode }) {
    const navigate = useNavigate();
    const { t } = useLanguage();
    const { playSound } = useSound();
    const { room, players, currentPlayer, submitAnswer, saveDraft, isHost, gameState, error, onlinePlayerIds } = useRoom();
    const [timeLeft, setTimeLeft] = useState(room?.settings?.roundTime || 60);

    // Spectator Check
    const playingIds = room?.settings?.player_order || [];
    const isSpectatorMode = !!(currentPlayer?.id && playingIds.length > 0 && !playingIds.includes(currentPlayer.id));



    const [answer, setAnswer] = useState('');
    const [hasInteracted, setHasInteracted] = useState(false);
    const [hasSubmitted, setHasSubmitted] = useState(false);
    const lastTickRef = useRef(0);
    const darkPurple = '#4C1D95';
    const [isAdvancing, setIsAdvancing] = useState(false);
    const isSubmittingRef = useRef(false); // New: Prevent duplicate submissions
    const answerRef = useRef(''); // New: Avoid stale closure in timer interval

    const hasPlayedWhoosh = useRef(false);
    useEffect(() => {
        setAnswer('');
        setHasSubmitted(false);
        isSubmittingRef.current = false;
        setIsAdvancing(false);
        if (gameState?.phase === 'text' && !hasPlayedWhoosh.current) {
            playSound('whoosh');
            hasPlayedWhoosh.current = true;
        }
    }, [gameState?.phase]);

    // RECONNECTION RESCUE: Restore state from server if we just joined/refreshed
    useEffect(() => {
        if (!currentPlayer?.last_answer || answer || hasSubmitted || hasInteracted) return;

        const last = currentPlayer.last_answer;

        if (last.startsWith('text:')) {
            const restored = last.substring(5);
            setAnswer(restored);
            setHasSubmitted(true);
        } else if (last.startsWith('draft:')) {
            const restored = last.substring(6);
            setAnswer(restored);
        }
    }, [currentPlayer?.last_answer, answer, hasSubmitted]);

    // Update ref whenever answer changes
    useEffect(() => {
        answerRef.current = answer;
    }, [answer]);

    // Autosave Draft (Debounced)
    useEffect(() => {
        if (hasSubmitted) return;
        const timeoutId = setTimeout(() => {
            // Save draft (even if empty, if the user has interacted, so we don't restore old ones)
            if (answer.trim() || hasInteracted) {
                saveDraft(answer, 'text');
            }
        }, 300);
        return () => clearTimeout(timeoutId);
    }, [answer, hasSubmitted, saveDraft]);

    // SILENT DRAFT RE-SYNC: If server draft doesn't match local state, re-submit
    useEffect(() => {
        // ALLOW empty strings if user has interacted (to fix the deletion bug)
        if (hasSubmitted || (!answer.trim() && !hasInteracted)) return;

        const expected = `draft:${answer.trim()}`;
        const actual = currentPlayer?.last_answer;

        if (actual !== expected) {
            const timer = setTimeout(() => {
                // Re-check after 0.35s of inactivity/mismatch
                if (currentPlayer?.last_answer !== expected && answerRef.current === answer) {
                    saveDraft(answer, 'text');
                }
            }, 350);
            return () => clearTimeout(timer);
        }
    }, [answer, currentPlayer?.last_answer, hasSubmitted, saveDraft, hasInteracted]);

    // Final Draft Save on Unload (Last effort)
    useEffect(() => {
        const handleUnload = () => {
            if (!hasSubmitted && answer.trim()) {
                saveDraft(answer, 'text');
            }
        };
        window.addEventListener('beforeunload', handleUnload);
        window.addEventListener('pagehide', handleUnload); // Safer for mobile
        return () => {
            window.removeEventListener('beforeunload', handleUnload);
            window.removeEventListener('pagehide', handleUnload);
        };
    }, [answer, hasSubmitted, saveDraft]);

    // Readiness Check: Stable counts that don't flicker with connection jitters
    // Updated Logic: Count only online players OR those who have already submitted.
    const totalPlayers = playingIds.filter(id =>
        onlinePlayerIds.has(id) ||
        players.find(p => p.id === id)?.last_answer?.startsWith('text:')
    ).length;

    const playersReadyCount = players.filter(p =>
        playingIds.includes(p.id) &&
        p.last_answer && p.last_answer.startsWith('text:')
    ).length;

    // Sync local hasSubmitted with DB state (last_answer exists)
    useEffect(() => {
        if (currentPlayer?.last_answer && currentPlayer.last_answer.startsWith('text:')) {
            setHasSubmitted(true);
        } else if (!isSubmittingRef.current) {
            // Only revert to false if we aren't currently in the middle of a submission
            setHasSubmitted(false);
        }
    }, [currentPlayer?.last_answer]);

    // IMMEDIATE Timer Sync on mount/update
    useEffect(() => {
        const expirySource = gameState?.phase_expiry || room?.settings?.phase_expiry;
        if (expirySource) {
            const now = Date.now();
            const expiryTime = new Date(expirySource).getTime();
            const secondsLeft = Math.max(0, Math.ceil((expiryTime - now) / 1000));
            setTimeLeft(secondsLeft);
        }
    }, [gameState?.phase_expiry, room?.settings?.phase_expiry]);

    // Stable reference for expiry to prevent interval resets on noisy state updates
    const expiryRef = useRef(gameState?.phase_expiry || room?.settings?.phase_expiry);
    useEffect(() => {
        const source = gameState?.phase_expiry || room?.settings?.phase_expiry;
        if (source) expiryRef.current = source;
    }, [gameState?.phase_expiry, room?.settings?.phase_expiry]);

    // Sync Timer with Server (High-Precision Polling)
    useEffect(() => {
        const interval = setInterval(() => {
            const expirySource = expiryRef.current;

            if (expirySource) {
                const now = Date.now();
                const expiryTime = new Date(expirySource).getTime();
                const secondsLeft = Math.max(0, Math.ceil((expiryTime - now) / 1000));

                setTimeLeft(prev => prev !== secondsLeft ? secondsLeft : prev);

                // Auto-Submit for self if time is up
                if (secondsLeft === 0 && !hasSubmitted) {
                    if (!isSpectatorMode) playSound('buzz');
                    handleSubmit();
                }

                // Tension: Tick during the final 10 seconds (Plays for everyone until 0)
                if (secondsLeft > 0 && secondsLeft <= 10) {
                    if (lastTickRef.current !== secondsLeft) {
                        playSound('tick');
                        lastTickRef.current = secondsLeft;
                    }
                }
            }
        }, 200);

        return () => clearInterval(interval);
    }, [hasSubmitted, isSpectatorMode, playSound]);

    // Format time from seconds to M:SS
    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };


    const handleSubmit = (e) => {
        if (e) e.preventDefault();
        if (hasSubmitted || isSubmittingRef.current) return;
        isSubmittingRef.current = true;

        // Use ref value to avoid stale closure in timer intervals
        let finalAnswer = answerRef.current.trim();
        // REMOVED: Client-side random fallbacks. 
        // We now allow empty submissions so the Host can pick up the Draft.

        setHasSubmitted(true);
        if (!isSpectatorMode) playSound('giggle');
        submitAnswer(`text:${finalAnswer}`).finally(() => {
            // Keep marked as submitted even after promise resolves
        });
    };

    // FIX: Transition Fallback Alignment
    // Prevent rendering wrong assignments when gameState.phase updates before room.settings.assignments
    const currentPhase = gameState?.phase || 'text';
    const isPhaseAligned = room?.settings?.assignments?.[currentPhase] !== undefined;
    const isCorrectPhaseType = currentPhase === 'text';

    // Wait gracefully for DB sync if active player and phase hasn't physically aligned yet
    if ((!isPhaseAligned || !isCorrectPhaseType) && !isSpectatorMode) {
        return <div className="app-container" style={{ minHeight: '100dvh' }} />;
    }

    if (isSpectatorMode) {
        return (
            <div className="app-container" style={{ padding: '1.5rem', minHeight: '100dvh', overflowY: 'auto' }}>
                <SpectatorView players={players} room={room} gameState={gameState} t={t} isDarkMode={isDarkMode} onlinePlayerIds={onlinePlayerIds} />

                {/* Keep Timer Visible for Host */}
                <div style={{
                    textAlign: 'center', marginTop: '30px',
                    color: timeLeft < 10 ? '#EF4444' : 'var(--phase-title)',
                    fontSize: '1.8rem', fontWeight: '800'
                }}>
                    ⏱️ {(gameState?.phase_expiry || room?.settings?.phase_expiry) ? formatTime(timeLeft) : '...'}
                </div>

                <div style={{
                    marginTop: '20px', textAlign: 'center',
                    color: 'var(--phase-ready-text)', fontWeight: 'bold'
                }}>
                    {t('playersReady')}: {playersReadyCount}/{totalPlayers}
                </div>
            </div>
        );
    }



    const containerStyle = {
        width: '100%',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: '20px',
        paddingBottom: '40px'
    };

    return (
        <div className="app-container" style={{ padding: '1.5rem', minHeight: '100dvh', overflowY: 'auto' }}>

            <div style={containerStyle}>

                {/* Title Section */}
                <h1 style={{
                    color: 'var(--phase-title)',
                    fontSize: '2.2rem',
                    fontWeight: '900',
                    textAlign: 'center',
                    marginBottom: '10px',
                    textShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}>
                    {t('phase1Title')}
                </h1>

                {/* Timer Subtitle */}
                <div style={{
                    color: timeLeft < 10 ? '#EF4444' : 'var(--phase-title)',
                    fontSize: '1.8rem',
                    fontWeight: '800',
                    marginBottom: '40px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}>
                    ⏱️ {(gameState?.phase_expiry || room?.settings?.phase_expiry) ? formatTime(timeLeft) : 'Syncing...'}
                </div>

                {/* Main Content Area */}
                <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    width: '100%',
                    maxWidth: '450px',
                    justifyContent: 'center',
                    gap: '20px'
                }}>

                    {!hasSubmitted ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            <textarea
                                value={answer}
                                onChange={(e) => {
                                    setAnswer(e.target.value);
                                    if (!hasInteracted) setHasInteracted(true);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey && answer.trim().length > 0) {
                                        e.preventDefault();
                                        handleSubmit();
                                    }
                                }}
                                placeholder={t('typeHere')}
                                maxLength={100}
                                style={{
                                    width: '100%',
                                    padding: '25px',
                                    borderRadius: '25px',
                                    border: '4px solid var(--input-border)',
                                    backgroundColor: 'var(--input-bg)',
                                    fontSize: '1.4rem',
                                    fontWeight: '700',
                                    fontFamily: 'var(--font-family)',
                                    minHeight: '160px',
                                    resize: 'none',
                                    outline: 'none',
                                    color: 'var(--input-text)',
                                    boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
                                    textAlign: 'inherit'
                                }}
                            />

                            <button
                                onClick={handleSubmit}
                                className="action-btn"
                                style={{
                                    width: '100%',
                                    padding: '20px',
                                    borderRadius: '20px',
                                    fontSize: '1.5rem',
                                    marginTop: '10px',
                                    opacity: answer.length > 0 ? 1 : 0.7
                                }}
                                disabled={answer.length === 0}
                            >
                                {t('submitAnswer')} 📤
                            </button>
                        </div>
                    ) : (
                        <div style={{
                            textAlign: 'center',
                            background: 'white',
                            padding: '40px',
                            borderRadius: '30px',
                            boxShadow: '0 15px 35px rgba(0,0,0,0.15)',
                            animation: 'bounce-in 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                        }}>
                            <div style={{ fontSize: '3.5rem', marginBottom: '15px' }}>✅</div>
                            <h2 style={{ color: '#6C63FF', fontWeight: '900', fontSize: '1.8rem', marginBottom: '10px' }}>{t('phraseSent')}</h2>
                            <p style={{ color: '#6B7280', fontSize: '1.1rem', fontWeight: '600' }}>{t('waitingRest')}</p>
                        </div>
                    )}
                </div>

                {/* Footer Status */}
                <div style={{
                    marginTop: '40px',
                    marginBottom: '40px',
                    backgroundColor: 'var(--phase-ready-bg)',
                    backdropFilter: 'blur(10px)',
                    padding: '12px 30px',
                    borderRadius: '50px',
                    color: 'var(--phase-ready-text)',
                    fontWeight: '900',
                    fontSize: '1.3rem',
                    border: '3px solid var(--phase-ready-text)22'
                }}>
                    {t('playersReady')}: {playersReadyCount}/{totalPlayers}
                </div>

            </div>



            <style>{`
                @keyframes bounce-in {
                    0% { transform: scale(0.3); opacity: 0; }
                    100% { transform: scale(1); opacity: 1; }
                }
            `}</style>
        </div>
    );
}

export default TextPhase;
