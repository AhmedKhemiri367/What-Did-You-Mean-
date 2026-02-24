import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useRoom } from '../contexts/RoomContext';
import { useSound } from '../contexts/SoundContext';

import SpectatorView from '../components/SpectatorView';

function InterpretationPhase({ isDarkMode }) {
    const navigate = useNavigate();
    const { t } = useLanguage();
    const { playSound } = useSound();
    const { room, players, currentPlayer, submitAnswer, saveDraft, isHost, gameState, advancePhase, onlinePlayerIds } = useRoom();
    const [interpretation, setInterpretation] = useState('');
    const [hasInteracted, setHasInteracted] = useState(false);
    const [timeLeft, setTimeLeft] = useState(room?.settings?.roundTime || 60);

    // FIX: Transition Fallback Alignment
    // Prevent rendering wrong assignments when gameState.phase updates before room.settings.assignments
    const currentPhase = gameState?.phase || 'interpretation_1';
    const isPhaseAligned = room?.settings?.assignments?.[currentPhase] !== undefined;

    // Spectator Check (only valid if phase is aligned)
    const playingIds = room?.settings?.player_order || [];
    const isSpectatorMode = !!(currentPlayer?.id && playingIds.length > 0 && !playingIds.includes(currentPlayer.id));



    // Original Render
    const [hasSubmitted, setHasSubmitted] = useState(false);
    const lastTickRef = useRef(0);
    const [isAdvancing, setIsAdvancing] = useState(false);
    const isSubmittingRef = useRef(false); // New: Prevent duplicate submissions
    const interpretationRef = useRef(''); // New: Avoid stale closure in timer interval

    // Reset state on phase change
    useEffect(() => {
        setInterpretation('');
        setHasSubmitted(false);
        isSubmittingRef.current = false;
        setIsAdvancing(false);
        if (gameState?.phase?.startsWith('interpretation')) {
            playSound('whoosh');
        }
    }, [gameState?.phase]);

    // RECONNECTION RESCUE: Restore state from server if we just joined/refreshed
    useEffect(() => {
        if (!currentPlayer?.last_answer || interpretation || hasSubmitted || hasInteracted) return;

        const last = currentPlayer.last_answer;

        if (last.startsWith('guess:')) {
            const restored = last.substring(6);
            setInterpretation(restored);
            setHasSubmitted(true);
        } else if (last.startsWith('draft_guess:')) {
            const restored = last.substring(12);
            setInterpretation(restored);
        }
    }, [currentPlayer?.last_answer, interpretation, hasSubmitted]);

    // Update ref whenever interpretation changes
    useEffect(() => {
        interpretationRef.current = interpretation;
    }, [interpretation]);

    // Autosave Draft (Debounced)
    useEffect(() => {
        if (hasSubmitted) return;
        const timeoutId = setTimeout(() => {
            // Save draft (even if empty, if user interacted)
            if (interpretation.trim() || hasInteracted) {
                saveDraft(interpretation, gameState?.phase || 'interpretation_1');
            }
        }, 300);
        return () => clearTimeout(timeoutId);
    }, [interpretation, hasSubmitted, saveDraft, gameState?.phase]);

    // SILENT DRAFT RE-SYNC: If server draft doesn't match local state, re-submit
    useEffect(() => {
        // ALLOW empty strings if user has interacted (to fix the deletion bug)
        if (hasSubmitted || (!interpretation.trim() && !hasInteracted)) return;

        const expected = `draft_guess:${interpretation.trim()}`;
        const actual = currentPlayer?.last_answer;

        if (actual !== expected) {
            const timer = setTimeout(() => {
                // Re-check after 0.35s of inactivity/mismatch
                if (currentPlayer?.last_answer !== expected && interpretationRef.current === interpretation) {
                    saveDraft(interpretation, gameState?.phase || 'interpretation_1');
                }
            }, 350);
            return () => clearTimeout(timer);
        }
    }, [interpretation, currentPlayer?.last_answer, hasSubmitted, saveDraft, gameState?.phase, hasInteracted]);

    // Final Draft Save on Unload (Last effort)
    useEffect(() => {
        const handleUnload = () => {
            if (!hasSubmitted && interpretation.trim()) {
                saveDraft(interpretation, gameState?.phase || 'interpretation_1');
            }
        };
        window.addEventListener('beforeunload', handleUnload);
        window.addEventListener('pagehide', handleUnload); // Safer for mobile
        return () => {
            window.removeEventListener('beforeunload', handleUnload);
            window.removeEventListener('pagehide', handleUnload);
        };
    }, [interpretation, hasSubmitted, saveDraft, gameState?.phase]);

    // Dynamic Colors
    const labelColor = isDarkMode ? '#DDD6FE' : '#4C1D95';

    // Dark Purple Color for reference (can be replaced with var)
    const darkPurple = '#4C1D95';

    // Determine input source based on assigned chain
    const assignments = room?.settings?.assignments?.[currentPhase] || {};
    const chainId = assignments[currentPlayer?.id];
    const chain = room?.settings?.chains?.[chainId];
    const chainHistory = chain?.history || [];

    // The prompt is the most recent step in the chain's history
    // (We find the last valid content to avoid stalled "?" prompts)
    const lastValidStep = [...chainHistory].reverse().find(step => step.content);
    const content = lastValidStep?.content;
    const receivedEmojis = content ? content.split(' ') : ["❓", "🌫️", "❓"];


    // Updated Logic: Count only online players OR those who have already submitted.
    const totalPlayers = playingIds.filter(id =>
        onlinePlayerIds.has(id) ||
        players.find(p => p.id === id)?.last_answer?.startsWith('guess:')
    ).length;

    const playersReadyCount = players.filter(p =>
        playingIds.includes(p.id) &&
        p.last_answer && p.last_answer.startsWith('guess:')
    ).length;


    // Sync local hasSubmitted with DB state (last_answer exists)
    useEffect(() => {
        if (currentPlayer?.last_answer && currentPlayer.last_answer.startsWith('guess:')) {
            setHasSubmitted(true);
        } else if (!isSubmittingRef.current) {
            // Revert to false if we aren't currently in the middle of a submission
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

                // Auto-Submit if time is up
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
        let finalInterpretation = interpretationRef.current.trim();
        // REMOVED: Client-side random fallbacks.
        // We now allow empty submissions so the Host can
        if (onlinePlayerIds.has(currentPlayer.id)) {
            setHasSubmitted(true);
            if (!isSpectatorMode) playSound('giggle');
            submitAnswer(finalInterpretation).finally(() => {
                isSubmittingRef.current = false;
            });
        }
    };

    // FIX: Transition Fallback Alignment
    // Wait gracefully for DB sync if active player and phase hasn't physically aligned yet
    const isCorrectPhaseType = currentPhase.startsWith('interpretation');
    if ((!isPhaseAligned || !isCorrectPhaseType) && !isSpectatorMode) {
        return <div className="app-container" style={{ minHeight: '100dvh' }} />;
    }

    if (isSpectatorMode) {
        const prefix = 'guess:';
        const readyCount = players.filter(p => playingIds.includes(p.id) && p.last_answer && p.last_answer.startsWith(prefix)).length;

        return (
            <div className="app-container" style={{ padding: '1.5rem', minHeight: '100dvh', overflowY: 'auto' }}>
                <SpectatorView players={players} room={room} gameState={gameState} t={t} isDarkMode={isDarkMode} onlinePlayerIds={onlinePlayerIds} />

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
                    {t('playersReady')}: {readyCount}/{totalPlayers}
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

    // Readiness count for spectator/footer
    const readyCount = playersReadyCount;

    return (
        <div className="app-container" style={{ paddingBottom: '80px', minHeight: '100dvh', overflowY: 'auto' }}>
            {/* Fixed Header Removed per user request */}
            <div style={containerStyle}>

                {/* Header */}
                <h1 style={{ color: 'var(--phase-title)', fontSize: '2.2rem', fontWeight: '900', textAlign: 'center', marginBottom: '5px', textShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                    {t('phase3Title').replace(/\d+/, (gameState?.phase === 'interpretation_2' ? 5 : 3))}
                </h1>

                <div style={{ color: timeLeft < 10 ? '#EF4444' : 'var(--phase-title)', fontSize: '1.8rem', fontWeight: '800', marginBottom: '30px' }}>
                    ⏱️ {(gameState?.phase_expiry || room?.settings?.phase_expiry) ? formatTime(timeLeft) : 'Syncing...'}
                </div>

                {!hasSubmitted ? (
                    <div style={{ flex: 1, width: '100%', maxWidth: '500px', display: 'flex', flexDirection: 'column', gap: '30px' }}>

                        {/* Emojis to Translate */}
                        <div style={{ background: 'var(--phase-card-bg)', padding: '25px', borderRadius: '25px', border: '2px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(5px)', textAlign: 'center' }}>
                            <p style={{ color: 'var(--phase-card-text)', fontSize: '0.9rem', fontWeight: '800', textTransform: 'uppercase', marginBottom: '8px' }}>{t('translateEmojis')}</p>
                            <div style={{ fontSize: '3.5rem', display: 'flex', gap: '10px', justifyContent: 'center' }}>
                                {receivedEmojis.map((e, i) => <span key={i} className="hover-pop">{e}</span>)}
                            </div>
                        </div>

                        {/* Input Area */}
                        <div style={{ width: '100%', position: 'relative' }}>
                            <textarea
                                value={interpretation}
                                onChange={(e) => {
                                    setInterpretation(e.target.value);
                                    if (!hasInteracted) setHasInteracted(true);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey && interpretation.trim().length > 0) {
                                        e.preventDefault();
                                        handleSubmit();
                                    }
                                }}
                                placeholder={t('typeInterpretation')}
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
                                    minHeight: '120px',
                                    resize: 'none',
                                    outline: 'none',
                                    color: 'var(--input-text)',
                                    boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
                                    textAlign: 'inherit'
                                }}
                            />
                        </div>

                        <button
                            onClick={(e) => {
                                playSound('tap');
                                handleSubmit(e);
                            }}
                            className="action-btn"
                            disabled={interpretation.length === 0}
                            style={{
                                width: '100%',
                                padding: '20px',
                                borderRadius: '20px',
                                fontSize: '1.5rem',
                                marginTop: '10px',
                                background: 'var(--phase-title)',
                                opacity: interpretation.length > 0 ? 1 : 0.7,
                                boxShadow: '0 10px 20px rgba(0, 0, 0, 0.1)'
                            }}
                        >
                            {t('lockInMeaning')} 🔒
                        </button>
                    </div>
                ) : (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                        <div style={{ textAlign: 'center', background: 'white', padding: '40px', borderRadius: '30px', boxShadow: '0 15px 35px rgba(0,0,0,0.15)', animation: 'bounce-in 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)', maxWidth: '400px' }}>
                            <div style={{ fontSize: '4rem', marginBottom: '20px' }}>🧐</div>
                            <h2 style={{ color: darkPurple, fontWeight: '900', fontSize: '1.8rem', marginBottom: '10px' }}>{t('interpretationLocked')}</h2>
                            <p style={{ color: '#6B7280', fontSize: '1.1rem', fontWeight: '600' }}>{t('waitingMadness')}</p>
                        </div>
                    </div>
                )}

                {/* Footer Status */}
                <div style={{
                    marginTop: '40px',
                    marginBottom: '40px',
                    backgroundColor: 'var(--phase-ready-bg)',
                    backdropFilter: 'blur(10px)',
                    padding: '14px 35px',
                    borderRadius: '50px',
                    color: 'var(--phase-ready-text)',
                    fontWeight: '900',
                    fontSize: '1.3rem',
                    border: '3px solid rgba(255,255,255,0.1)'
                }}>
                    {t('playersReady')}: {playersReadyCount}/{totalPlayers}
                </div>

            </div>

            <style>{`
@keyframes bounce -in {
    0% { transform: scale(0.3); opacity: 0; }
                    100% { transform: scale(1); opacity: 1; }
}
    .hover - pop:hover { transform: scale(1.15); }
`}</style>
        </div>
    );
}

export default InterpretationPhase;
