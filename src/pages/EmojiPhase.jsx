import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useRoom } from '../contexts/RoomContext';
import { useSound } from '../contexts/SoundContext';

import SpectatorView from '../components/SpectatorView';

function EmojiPhase({ isDarkMode }) {
    const navigate = useNavigate();
    const { t } = useLanguage();
    const { playSound } = useSound();
    const { room, players, currentPlayer, submitAnswer, saveDraft, isHost, gameState, error, onlinePlayerIds } = useRoom();
    const [timeLeft, setTimeLeft] = useState(room?.settings?.roundTime || 60);

    // FIX: Transition Fallback Alignment
    // Prevent rendering wrong assignments when gameState.phase updates before room.settings.assignments
    const currentPhase = gameState?.phase || 'emoji_1';
    const isPhaseAligned = room?.settings?.assignments?.[currentPhase] !== undefined;

    // Spectator Check (only valid if phase is aligned)
    const playingIds = room?.settings?.player_order || [];
    const isSpectatorMode = !!(currentPlayer?.id && playingIds.length > 0 && !playingIds.includes(currentPlayer.id));



    // Original Render
    const [selectedEmojis, setSelectedEmojis] = useState([]);
    const [hasInteracted, setHasInteracted] = useState(false);
    const [hasSubmitted, setHasSubmitted] = useState(false);
    const lastTickRef = useRef(0);
    const [isAdvancing, setIsAdvancing] = useState(false);
    const isSubmittingRef = useRef(false); // New: Prevent duplicate submissions
    const selectedEmojisRef = useRef([]); // New: Avoid stale closure in timer interval

    // Reset state on phase change
    useEffect(() => {
        setSelectedEmojis([]);
        setHasSubmitted(false);
        isSubmittingRef.current = false;
        setIsAdvancing(false);
        if (gameState?.phase?.startsWith('emoji')) {
            playSound('whoosh');
        }
    }, [gameState?.phase]);

    // RECONNECTION RESCUE: Restore state from server if we just joined/refreshed
    useEffect(() => {
        if (!currentPlayer?.last_answer || selectedEmojis.length > 0 || hasSubmitted || hasInteracted) return;

        const last = currentPlayer.last_answer;

        if (last.startsWith('emoji:')) {
            const restored = last.substring(6).split(' ');
            setSelectedEmojis(restored);
            setHasSubmitted(true);
        } else if (last.startsWith('draft_emoji:')) {
            const restored = last.substring(12).split(' ');
            setSelectedEmojis(restored);
        }
    }, [currentPlayer?.last_answer, selectedEmojis, hasSubmitted]);

    // Update ref whenever selection changes
    useEffect(() => {
        selectedEmojisRef.current = selectedEmojis;
    }, [selectedEmojis]);

    // Autosave Draft Emoji (Debounced)
    useEffect(() => {
        if (hasSubmitted) return;
        const timeoutId = setTimeout(() => {
            // Save draft (even if empty, if the user has interacted, so we don't restore old ones)
            if (selectedEmojis.length > 0 || hasInteracted) {
                saveDraft(selectedEmojis.join(' '), gameState?.phase || 'emoji_1');
            }
        }, 300);
        return () => clearTimeout(timeoutId);
    }, [selectedEmojis, hasSubmitted, saveDraft, gameState?.phase, hasInteracted]);

    // SILENT DRAFT RE-SYNC: If server draft doesn't match local state, re-submit
    useEffect(() => {
        if (hasSubmitted || selectedEmojis.length === 0) return;

        const expected = `draft_emoji:${selectedEmojis.join(' ')}`;
        const actual = currentPlayer?.last_answer;

        if (actual !== expected) {
            const timer = setTimeout(() => {
                // Re-check after 0.35s of inactivity/mismatch
                if (currentPlayer?.last_answer !== expected &&
                    JSON.stringify(selectedEmojisRef.current) === JSON.stringify(selectedEmojis)) {
                    saveDraft(selectedEmojis.join(' '), gameState?.phase || 'emoji_1');
                }
            }, 350);
            return () => clearTimeout(timer);
        }
    }, [selectedEmojis, currentPlayer?.last_answer, hasSubmitted, saveDraft, gameState?.phase]);

    // Final Draft Save on Unload (Last effort)
    useEffect(() => {
        const handleUnload = () => {
            if (!hasSubmitted && selectedEmojis.length > 0) {
                saveDraft(selectedEmojis.join(' '), gameState?.phase || 'emoji_1');
            }
        };
        window.addEventListener('beforeunload', handleUnload);
        window.addEventListener('pagehide', handleUnload); // Safer for mobile
        return () => {
            window.removeEventListener('beforeunload', handleUnload);
            window.removeEventListener('pagehide', handleUnload);
        };
    }, [selectedEmojis, hasSubmitted, saveDraft, gameState?.phase]);
    const [showPicker, setShowPicker] = useState(false);

    // Dynamic Colors
    const phraseColor = isDarkMode ? '#F5F3FF' : '#4C1D95';
    const labelColor = isDarkMode ? '#F5F3FF' : '#4C1D95';
    const darkPurple = '#4C1D95';

    // Determine input source based on current phase and assigned chain
    const assignments = room?.settings?.assignments?.[currentPhase] || {};
    const chainId = assignments[currentPlayer?.id];
    const chain = room?.settings?.chains?.[chainId];
    const chainHistory = chain?.history || [];

    // Determine prompt based on chain history
    // (We find the last valid content to avoid stalled "?" prompts)
    const isEmojiOnly = room?.settings?.selectedMode === 'Emoji Only';
    const lastStep = [...chainHistory].reverse().find(step => step.content);
    const receivedContent = lastStep?.content || "A mystery lost in the void...";
    const isReceivedEmojis = lastStep?.phase.startsWith('emoji');


    // Curated emoji list
    const emojiList = [
        // Faces & Emotions
        '😀', '😂', '😍', '🤔', '🤨', '🙄', '😱', '😴', '😎', '🤢',
        '🤮', '🤠', '🥳', '🥺', '🤯', '👻', '💀', '💩', '🤡', '👺',
        '😭', '😤', '😡', '🤬', '😈', '👿', '🤖', '👾', '👽', '🤥',
        '🤫', '🤭', '🧐', '🤓', '😇', '😷', '🤒', '🤕', '🤪', '😵',

        // People & Body
        '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟',
        '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '👍', '👎', '👊',
        '👏', '🙌', '👐', '🤲', '🤝', '🙏', '💅', '🤳', '💪', '🦵',
        '👂', '👃', '🧠', '🦷', '🦴', '👀', '👁️', '👄', '💋', '👅',

        // Animals & Nature
        '🐶', '🐱', '🐭', '🦁', '🐵', '🐸', '🦄', '🐲', '🌹', '🌵',
        '🦊', '🐻', '🐼', '🐨', '🐯', '🐮', '🐷', '🐔', '🐧', '🐦',
        '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🐝', '🐛',
        '🦋', '🐌', '🐞', '🐜', '🦟', '🦗', '🕷️', '🕸️', '🦂', '🐢',
        '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡',
        '🐠', '🐟', '🐬', '🐳', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍',

        // Food & Drink
        '🍕', '🍔', '🍟', '🍣', '🍦', '🍩', '🥑', '🥦', '🍺', '☕',
        '🍇', '🍈', '🍉', '🍊', '🍋', '🍌', '🍍', '🥭', '🍎', '🍏',
        '🍐', '🍑', '🍒', '🍓', '🥝', '🍅', '🥥', '🍆', '🥔', '🥕',
        '🌽', '🌶️', '🥒', '🥬', '🥦', '🍄', '🥜', '🌰', '🍞', '🥐',
        '🥖', '🥨', '🥯', '🥞', '🧀', '🍖', '🍗', '🥩', '🥓', '🥪',
        '🍳', '🥘', '🍲', '🥣', '🥗', '🍿', '🧂', '🥫', '🍱', '🍘',
        '🍙', '🍚', '🍛', '🍜', '🍝', '🍠', '🍢', '🍡', '🍧', '🍨',
        '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🥟', '🍤',

        // Activities & Objects
        '🚗', '✈️', '🚀', '🚲', '🏠', '💻', '📷', '🎮', '🎧', '🎸',
        '⚽', '🏀', '🎭', '🎨', '💸', '📦', '🔑', '🔒', '💡', '⏰',
        '🎻', '🥁', '📱', '☎️', '📞', '📟', '📠', '🔋', '🔌', '💽',
        '💾', '💿', '📀', '🎥', '🎬', '📺', '📻', '📼', '🔍', '🔎',
        '🕯️', '💡', '🔦', '🏮', '📔', '📕', '📖', '📗', '📘', '📙',
        '📚', '📓', '📒', '📃', '📜', '📄', '📰', '🗞️', '📑', '🔖',
        '💰', '💴', '💵', '💶', '💷', '💸', '💳', '🧾', '✉️', '📧',
        '🧧', '📫', '📪', '📬', '📭', '📮', '🗳️', '✏️', '✒️', '🖋️',

        // Symbols & Hearts
        '❤️', '✨', '🔥', '💯', '🌈', '☀️', '⭐', '☁️', '❄️', '🌊',
        '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️',
        '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️',
        '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎',
        '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑',
        '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶',
        '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹'
    ];
    // Face emojis that are banned in "No Faces" mode
    const faceEmojis = [
        '😀', '😂', '😍', '🤔', '🤨', '🙄', '😱', '😴', '😎', '🤢',
        '🤮', '🤠', '🥳', '🥺', '🤯', '👻', '💀', '💩', '🤡', '👺',
        '😭', '😤', '😡', '🤬', '😈', '👿', '🤖', '👾', '👽', '🤥',
        '🤫', '🤭', '🧐', '🤓', '😇', '😷', '🤒', '🤕', '🤪', '😵',
        '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', // Cat faces
        '🙈', '🙉', '🙊' // Monkey faces
    ];

    const isNoFacesMode = room?.settings?.selectedMode === 'No Faces';

    // Filtering logic (Visual Only now): Prompt emojis remain in list but are disabled
    // In "No Faces" mode, face emojis are also disabled

    // Updated Logic: Count only online players OR those who have already submitted.
    const totalPlayers = playingIds.filter(id =>
        onlinePlayerIds.has(id) ||
        players.find(p => p.id === id)?.last_answer?.startsWith('emoji:')
    ).length;

    // Readiness Check: If they have an answer prefixed with 'emoji:', they are ready
    const playersReadyCount = players.filter(p =>
        playingIds.includes(p.id) &&
        p.last_answer && p.last_answer.startsWith('emoji:')
    ).length;


    // Sync local hasSubmitted with DB state (last_answer exists)
    useEffect(() => {
        if (currentPlayer?.last_answer && currentPlayer.last_answer.startsWith('emoji:')) {
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

    // Prevent body scroll when picker is open
    useEffect(() => {
        if (showPicker) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [showPicker]);

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const addEmoji = (emoji) => {
        if (selectedEmojis.length < 10) {
            playSound('pop');
            setSelectedEmojis([...selectedEmojis, emoji]);
            setHasInteracted(true);
        }
    };

    const removeEmoji = (index) => {
        playSound('tap');
        setSelectedEmojis(selectedEmojis.filter((_, i) => i !== index));
        setHasInteracted(true);
    };

    const clearEmojis = () => {
        playSound('tap');
        setSelectedEmojis([]);
        setHasInteracted(true);
    };

    const handleSubmit = (e) => {
        if (e) e.preventDefault();
        if (hasSubmitted || isSubmittingRef.current) return;
        isSubmittingRef.current = true;

        const currentEmojis = selectedEmojisRef.current;
        if (currentEmojis.length > 0) {
            setHasSubmitted(true);
            if (!isSpectatorMode) playSound('giggle');
            submitAnswer(`emoji:${currentEmojis.join(' ')}`).finally(() => {
                // Keep marked as submitted even after promise resolves
            });
        } else {
            isSubmittingRef.current = false;
            // Removed alert, we rely on auto-submit or visual cues
        }
    };

    // Wait gracefully for DB sync if active player and phase hasn't physically aligned yet
    const isCorrectPhaseType = currentPhase.startsWith('emoji');
    if ((!isPhaseAligned || !isCorrectPhaseType) && !isSpectatorMode) {
        return <div className="app-container" style={{ minHeight: '100dvh' }} />;
    }

    // MAIN RENDER (Wait until active components are ready, or show spectator screen)
    if (isSpectatorMode) {
        // Fix: Use the robust ready count defined above
        const readyCount = playersReadyCount;

        return (
            <div className="app-container" style={{ padding: '1.5rem', minHeight: '100dvh', overflowY: 'auto' }}>
                <SpectatorView players={players} room={room} gameState={gameState} t={t} isDarkMode={isDarkMode} onlinePlayerIds={onlinePlayerIds} />

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

    return (
        <div className="app-container" style={{ padding: '1.5rem', minHeight: '100dvh', overflowY: showPicker ? 'hidden' : 'auto' }}>

            {/* Fixed Header Removed per user request */}

            <div style={containerStyle}>

                {/* Header */}
                <h1 style={{ color: 'var(--phase-title)', fontSize: '2.2rem', fontWeight: '900', textAlign: 'center', marginBottom: '5px', textShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                    {t('phase2Title').replace(/\d+/, () => {
                        const p = gameState?.phase;
                        if (p === 'emoji_1') return 2;
                        if (p === 'emoji_2') return isEmojiOnly ? 3 : 4;
                        if (p === 'emoji_3') return isEmojiOnly ? 4 : 6;
                        if (p === 'emoji_4') return 5;
                        if (p === 'emoji_5') return 6;
                        return 2;
                    })}
                </h1>

                <div style={{ color: timeLeft < 10 ? '#EF4444' : 'var(--phase-title)', fontSize: '1.8rem', fontWeight: '800', marginBottom: '30px' }}>
                    ⏱️ {(gameState?.phase_expiry || room?.settings?.phase_expiry) ? formatTime(timeLeft) : 'Syncing...'}
                </div>

                {!hasSubmitted ? (
                    <div style={{ flex: 1, width: '100%', maxWidth: '500px', display: 'flex', flexDirection: 'column', gap: '30px' }}>

                        {/* Phrase to Translate */}
                        <div style={{ background: 'var(--phase-card-bg)', padding: '25px', borderRadius: '20px', border: '2px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(5px)', textAlign: 'center' }}>
                            <p style={{ color: labelColor, fontSize: '0.9rem', fontWeight: '800', textTransform: 'uppercase', marginBottom: '8px' }}>{isReceivedEmojis ? t('translateEmojis') : t('translatePhrase')}</p>
                            {isReceivedEmojis ? (
                                <div style={{ fontSize: '3rem', display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                    {receivedContent.split(' ').map((e, i) => <span key={i}>{e}</span>)}
                                </div>
                            ) : (
                                <p style={{ color: phraseColor, fontSize: '1.5rem', fontWeight: '900' }}>"{receivedContent}"</p>
                            )}
                        </div>

                        {/* Emoji Preview Area */}
                        <div style={{
                            background: 'white',
                            borderRadius: '25px',
                            padding: '20px',
                            minHeight: '100px',
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '12px',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
                            position: 'relative',
                            border: '4px solid #F3F4F6'
                        }}>
                            {selectedEmojis.length === 0 ? (
                                <span style={{ color: '#9CA3AF', fontWeight: '700', fontSize: '1.1rem' }}>{t('clickToAdd')}</span>
                            ) : (
                                selectedEmojis.map((emoji, index) => (
                                    <span
                                        key={index}
                                        onClick={() => removeEmoji(index)}
                                        style={{ fontSize: '3rem', cursor: 'pointer', transition: 'transform 0.1s' }}
                                        className="hover-pop emoji-animated"
                                    >
                                        {emoji}
                                    </span>
                                ))
                            )}

                            <button
                                onClick={() => { playSound('tap'); setShowPicker(true); }}
                                style={{
                                    position: 'absolute',
                                    right: '15px',
                                    bottom: '15px',
                                    background: 'var(--phase-title)',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '50%',
                                    width: '50px',
                                    height: '50px',
                                    cursor: 'pointer',
                                    fontSize: '2rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: '0 4px 10px rgba(0, 0, 0, 0.2)',
                                    zIndex: 2
                                }}
                            >
                                +
                            </button>
                        </div>

                        <button
                            onClick={handleSubmit}
                            className="action-btn"
                            disabled={selectedEmojis.length === 0}
                            style={{
                                width: '100%',
                                padding: '22px',
                                borderRadius: '25px',
                                fontSize: '1.6rem',
                                opacity: selectedEmojis.length > 0 ? 1 : 0.7,
                                background: 'var(--phase-title)',
                                boxShadow: `0 10px 20px rgba(0, 0, 0, 0.1)`
                            }}
                        >
                            {t('lockInEmojis')} 🔒
                        </button>
                    </div>
                ) : (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                        <div style={{ textAlign: 'center', background: 'white', padding: '40px', borderRadius: '30px', boxShadow: '0 15px 35px rgba(0,0,0,0.15)', animation: 'bounce-in 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)', maxWidth: '400px' }}>
                            <div style={{ fontSize: '4rem', marginBottom: '20px' }}>🌈</div>
                            <h2 style={{ color: darkPurple, fontWeight: '900', fontSize: '2rem', marginBottom: '10px' }}>{t('masterpieceSent')}</h2>
                            <p style={{ color: '#6B7280', fontSize: '1.1rem', fontWeight: '600' }}>{t('waitingArtists')}</p>
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
                    border: `3px solid var(--phase-ready-text)22`
                }}>
                    {t('playersReady')}: {playersReadyCount}/{totalPlayers}
                </div>
            </div>

            {/* Emoji Picker Overlay */}
            {showPicker && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
                    zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '20px', animation: 'fadeIn 0.2s ease'
                }} onClick={() => setShowPicker(false)}>
                    <div style={{
                        backgroundColor: 'white', borderRadius: '35px', width: '100%', maxWidth: '450px',
                        padding: '30px', boxShadow: '0 25px 50px rgba(0,0,0,0.3)',
                        animation: 'popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                    }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
                            <h3 style={{ color: darkPurple, fontWeight: '900', fontSize: '1.5rem' }}>{t('pickEmoji')}</h3>
                            <button onClick={() => { playSound('tap'); setShowPicker(false); }} style={{ background: '#F3F4F6', border: 'none', borderRadius: '50%', width: '40px', height: '40px', cursor: 'pointer', fontSize: '1.2rem', fontWeight: 'bold' }}>✕</button>
                        </div>

                        <div style={{
                            display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '5px',
                            maxHeight: '400px', overflowY: 'auto', padding: '5px', justifyItems: 'center'
                        }} className="no-scrollbar">
                            {emojiList.map((emoji, index) => {
                                const isUsedInPrompt = receivedContent.includes(emoji);
                                const isFaceAndBanned = isNoFacesMode && faceEmojis.includes(emoji);
                                const isDisabled = isUsedInPrompt || isFaceAndBanned;
                                return (
                                    <button
                                        key={index}
                                        onClick={() => {
                                            if (!isDisabled) {
                                                addEmoji(emoji);
                                            }
                                        }}
                                        disabled={isDisabled}
                                        style={{
                                            fontSize: '2.5rem',
                                            background: 'none',
                                            border: 'none',
                                            cursor: isDisabled ? 'not-allowed' : 'pointer',
                                            padding: '5px',
                                            transition: 'transform 0.1s',
                                            opacity: isDisabled ? 0.3 : 1,
                                            filter: isDisabled ? 'grayscale(100%)' : 'none',
                                            transform: isDisabled ? 'none' : undefined
                                        }}
                                        className={isDisabled ? '' : "hover-pop"}
                                    >
                                        {emoji}
                                    </button>
                                );
                            })}
                        </div>

                        <button
                            onClick={() => { playSound('tap'); setShowPicker(false); }}
                            style={{ width: '100%', marginTop: '25px', padding: '15px', background: darkPurple, color: 'white', border: 'none', borderRadius: '15px', fontWeight: '900', fontSize: '1.2rem', cursor: 'pointer' }}
                        >
                            {t('done')} ✨
                        </button>
                    </div>
                </div>
            )}



            <style>{`
                @keyframes bounce-in {
                    0% { transform: scale(0.3); opacity: 0; }
                    100% { transform: scale(1); opacity: 1; }
                }
                @keyframes popIn {
                    0% { transform: scale(0.8); opacity: 0; }
                    100% { transform: scale(1); opacity: 1; }
                }
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .hover-pop:hover { transform: scale(1.2); }
                .hover-pop:active { transform: scale(0.9); transition: transform 0.1s; }
                
                @keyframes emoji-jump {
                    0% { transform: scale(0); opacity: 0; }
                    70% { transform: scale(1.3); }
                    100% { transform: scale(1); opacity: 1; }
                }
                
                .emoji-animated {
                    animation: emoji-jump 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
                }

                .no-scrollbar::-webkit-scrollbar { display: none; }
                .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
            `}</style>
        </div>
    );
}

export default EmojiPhase;
