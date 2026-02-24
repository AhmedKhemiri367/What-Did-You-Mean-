import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useRoom } from '../contexts/RoomContext';
import { useSound } from '../contexts/SoundContext';

import SpectatorView from '../components/SpectatorView';

function VotePhase({ isDarkMode }) {
    const navigate = useNavigate();
    const { t } = useLanguage();
    const { playSound } = useSound();
    const { room, players, currentPlayer, submitAnswer, saveDraft, isHost, gameState, advancePhase, onlinePlayerIds } = useRoom();

    const [timeLeft, setTimeLeft] = useState(room?.settings?.voteDuration || 15);

    const hasPlayedEntrySound = useRef(false);

    // Sound: Phase Entry & Celebration
    useEffect(() => {
        if (!hasPlayedEntrySound.current) {
            playSound('whoosh');
            playSound('confetti'); // Celebration sound for ALL participants entering Vote Phase
            hasPlayedEntrySound.current = true;
        }
    }, [playSound]);
    // --- Vote Budgeting Logic ---
    const scoreToWin = room?.settings?.scoreToWin || 5;
    const multiplier = Math.max(1, Math.floor(scoreToWin / 5));
    // Limits: Funniest gets 3x, others get 1x per 5 points
    const voteLimits = {
        funniest: 3 * multiplier,
        mostAccurate: 1 * multiplier,
        mostDestroyed: 1 * multiplier
    };

    const [selectedPlayer, setSelectedPlayer] = useState(null);
    const [myVotes, setMyVotes] = useState([]); // Array of {category, targetId}
    const chainIndex = room?.settings?.reveal_chain_index || 0;
    const lastTickRef = useRef(0);
    const [isAdvancing, setIsAdvancing] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const lastSubmissionTimeRef = useRef(0);
    const votesUsedHistory = currentPlayer?.votes_used || {};

    // Derived State: Remaining Votes (Per-Round)
    const remainingVotes = {
        funniest: voteLimits.funniest - (votesUsedHistory.funniest || 0) - myVotes.filter(v => v.category === 'funniest').length,
        mostAccurate: voteLimits.mostAccurate - (votesUsedHistory.mostAccurate || 0) - myVotes.filter(v => v.category === 'mostAccurate').length,
        mostDestroyed: voteLimits.mostDestroyed - (votesUsedHistory.mostDestroyed || 0) - myVotes.filter(v => v.category === 'mostDestroyed').length,
    };
    const totalRemaining = Object.values(remainingVotes).reduce((a, b) => a + b, 0);
    const hasVotesLeft = totalRemaining > 0;
    const hasVoted = myVotes.length > 0; // Just means they've started voting

    const darkPurple = '#4C1D95';
    const primaryColor = '#6C63FF';
    const accentPink = '#F472B6';
    const accentGreen = '#34D399';
    const accentRed = '#F87171';

    const playingIds = room?.settings?.player_order || [];
    const isSpectatorMode = !!(currentPlayer?.id && playingIds.length > 0 && !playingIds.includes(currentPlayer.id));

    // Readiness Check: Count anyone in player_order who has a valid vote payload
    // Helper to detect a valid vote payload (legacy or multi)
    const isVotedPayload = (ans) => ans && (ans.startsWith('vote:') || ans.startsWith('vote_multi:'));

    // Updated Logic: Count only playing IDs that are currently online
    // FIX: Denominator should shrink if players leave, showing "Players Ready: 2/2" instead of "2/3"
    const onlinePlayingCount = playingIds.filter(id => onlinePlayerIds.has(id)).length;
    const totalPlayersCount = onlinePlayingCount > 0 ? onlinePlayingCount : 0;

    const playersVotedCount = players.filter(p =>
        playingIds.includes(p.id) && onlinePlayerIds.has(p.id) && isVotedPayload(p.last_answer)
    ).length;

    // Grid Candidates: Everyone playing, EXCEPT ME, but include offline players (dimmed)
    const candidates = players.filter(p => playingIds.includes(p.id) && p.id !== currentPlayer?.id);


    useEffect(() => {
        if (!currentPlayer?.id || isSubmitting) return;

        const ans = currentPlayer?.last_answer;
        if (!ans) return;

        if (ans.startsWith('vote_multi:')) {
            try {
                const saved = JSON.parse(ans.substring('vote_multi:'.length));
                // ROBUST RESTORATION: Only sync if current local state is empty OR the server has MORE votes
                // This prevents a local "vote-in-progress" from being clobbered by a slightly older DB state
                setMyVotes(current => {
                    const localCount = current.length;
                    const serverCount = saved.length;

                    if (localCount === 0 && serverCount > 0) return saved;
                    if (serverCount > localCount) return saved; // Server has newer data
                    return current;
                });
                // Restore selection if missing
                if (!selectedPlayer && saved.length > 0) setSelectedPlayer(saved[0].targetId);
            } catch (e) { console.error("Failed to restore vote_multi", e); }
        } else if (ans.startsWith('vote:')) {
            // Restore legacy single vote
            const parts = ans.split(':');
            if (parts.length >= 2) {
                const savedVote = { category: parts.length === 3 ? parts[1] : parts[0], targetId: parts[parts.length - 1] };
                setMyVotes(current => {
                    if (current.length === 0) return [savedVote];
                    return current;
                });
                if (!selectedPlayer) setSelectedPlayer(savedVote.targetId);
            }
        }
    }, [currentPlayer?.last_answer, isSubmitting, selectedPlayer]);

    // AUTO-RETRY SYNC: If server doesn't match local state, re-submit automatically
    useEffect(() => {
        if (!hasVoted || isSubmitting) return;

        const expected = `vote_multi:${JSON.stringify(myVotes)}`;
        const actual = currentPlayer?.last_answer;

        if (actual !== expected) {
            const timer = setTimeout(() => {
                // GUARD: Allow 1.0 second for Realtime to ripple (was 1.5s)
                const now = Date.now();
                if (now - lastSubmissionTimeRef.current < 1000) return;

                // PROTECTION: If local is empty but server has votes, DON'T overwrite server with empty!
                // We assume we are in the process of restoring.
                const dbAns = currentPlayerRef.current?.last_answer || '';
                const hasServerVote = (dbAns.startsWith('vote_multi:') && dbAns !== 'vote_multi:[]') ||
                    (dbAns.startsWith('vote:') && dbAns.length > 5);

                if (myVotes.length === 0 && hasServerVote) {
                    return;
                }

                if (currentPlayer?.last_answer !== expected && !isSubmitting) {
                    submitAnswer(expected)
                        .finally(() => setIsSubmitting(false));
                }
            }, 500); // 0.5s for stability (was 1.0s)
            return () => clearTimeout(timer);
        }
    }, [myVotes, currentPlayer?.last_answer, isSubmitting, hasVoted, submitAnswer]);

    // SYNC SELECTED TARGET TO DRAFTS (For Spectators)
    useEffect(() => {
        if (!selectedPlayer || hasVoted || isSubmitting) return;

        // Save targetId as a draft so spectators can see who we are considering
        saveDraft(selectedPlayer, 'vote');
    }, [selectedPlayer, hasVoted, isSubmitting, saveDraft]);

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

    const categories = [
        { id: 'funniest', label: t('funniest'), color: accentPink, icon: '😂' },
        { id: 'mostAccurate', label: t('mostAccurate'), color: accentGreen, icon: '🎯' },
        { id: 'mostDestroyed', label: t('mostDestroyed'), color: accentRed, icon: '🤯' }
    ];

    // Refs for safe access inside setInterval without re-triggering
    const myVotesRef = React.useRef(myVotes);
    const playersRef = React.useRef(players);
    const roomRef = React.useRef(room);
    const gameStateRef = React.useRef(gameState);
    const isAdvancingRef = React.useRef(isAdvancing);
    const selectedPlayerRef = React.useRef(selectedPlayer);
    const currentPlayerRef = React.useRef(currentPlayer);
    const submitAnswerRef = React.useRef(submitAnswer);
    const isSubmittingRef = React.useRef(false); // Double-tap guard
    const expiryRef = React.useRef(gameState?.phase_expiry || room?.settings?.phase_expiry);

    useEffect(() => {
        const source = gameState?.phase_expiry || room?.settings?.phase_expiry;
        if (source) expiryRef.current = source;
    }, [gameState?.phase_expiry, room?.settings?.phase_expiry]);

    useEffect(() => {
        myVotesRef.current = myVotes;
        playersRef.current = players;
        roomRef.current = room;
        gameStateRef.current = gameState;
        isAdvancingRef.current = isAdvancing;
        selectedPlayerRef.current = selectedPlayer;
        currentPlayerRef.current = currentPlayer;
        submitAnswerRef.current = submitAnswer;
    }, [myVotes, players, room, gameState, isAdvancing, selectedPlayer, currentPlayer, submitAnswer]);

    // Timer Logic & Sync
    // Sync Timer with Server (High-Precision Polling)
    useEffect(() => {
        const interval = setInterval(() => {
            const expirySource = expiryRef.current;

            if (expirySource) {
                const now = Date.now();
                const expiryTime = new Date(expirySource).getTime();
                const diff = expiryTime - now;
                const secondsLeft = Math.max(0, Math.ceil(diff / 1000));

                setTimeLeft(prev => prev !== secondsLeft ? secondsLeft : prev);

                // Auto-submit logic at 0s
                if ((diff <= 100 || secondsLeft <= 0) && !isAdvancingRef.current && !isSubmittingRef.current) {
                    const dbAns = currentPlayerRef.current?.last_answer || "";
                    const hasServerVote = dbAns.startsWith('vote:') || dbAns.startsWith('vote_multi:');

                    if (!hasServerVote) {
                        const localVotes = [...myVotesRef.current];

                        // If they haven't picked ANYONE, pick someone randomly and give them 1 vote
                        if (localVotes.length === 0) {
                            const usedHistory = currentPlayerRef.current?.votes_used || {};
                            // Use fixed IDs to find first available category
                            const catIds = ['funniest', 'mostAccurate', 'mostDestroyed'];
                            const firstAvailableCat = catIds.find(id => (usedHistory[id] || 0) < 1);

                            if (firstAvailableCat) {
                                const validOpponents = playersRef.current.filter(p =>
                                    (roomRef.current?.settings?.player_order || []).includes(p.id) && p.id !== currentPlayerRef.current?.id
                                );
                                let targetId = selectedPlayerRef.current;
                                if (!targetId && validOpponents.length > 0) {
                                    targetId = validOpponents[Math.floor(Math.random() * validOpponents.length)].id;
                                }

                                if (targetId) {
                                    localVotes.push({ category: firstAvailableCat, targetId });
                                }
                            }
                        }

                        if (localVotes.length > 0) {
                            console.log("VotePhase: Auto-submitting votes at 0s (High Precision):", localVotes);
                            if (!isSpectatorMode) playSound?.('buzz');
                            isSubmittingRef.current = true;
                            setIsSubmitting(true);
                            lastSubmissionTimeRef.current = Date.now(); // Update sync guard
                            submitAnswerRef.current(`vote_multi:${JSON.stringify(localVotes)}`)
                                .finally(() => {
                                    isSubmittingRef.current = false;
                                    setIsSubmitting(false);
                                });
                        }
                    }
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
    }, [isSpectatorMode, playSound]);

    // Navigation is handled by RoomContext based on gameState.phase

    // Navigation is handled by RoomContext based on gameState.phase

    // Format time from seconds to M:SS
    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };



    // Handle background click to deselect
    const handleBackgroundClick = () => {
        // If I have already voted, I am locked to this target, so don't deselect
        if (myVotes.length > 0) return;
        setSelectedPlayer(null);
    };

    // Handle clicking a player card
    const handleSelectPlayer = (e, playerId) => {
        e.stopPropagation(); // Prevent background click from firing
        if (!currentPlayer?.id) return; // Guard against ghost state
        if (hasVotesLeft && playerId !== currentPlayer?.id) {
            playSound('tap');
            setSelectedPlayer(playerId);
        }
    };

    // --- Optimized Vote Submission Pattern ---
    const submissionTimerRef = useRef(null);

    const debouncedSubmit = (votes, immediate = false) => {
        if (submissionTimerRef.current) clearTimeout(submissionTimerRef.current);

        const exec = () => {
            console.log("VotePhase: Executing DB sync for votes:", votes);
            setIsSubmitting(true);
            isSubmittingRef.current = true;
            lastSubmissionTimeRef.current = Date.now();
            submitAnswer(`vote_multi:${JSON.stringify(votes)}`)
                .finally(() => {
                    setIsSubmitting(false);
                    isSubmittingRef.current = false;
                });
        };

        if (immediate) {
            exec();
        } else {
            submissionTimerRef.current = setTimeout(exec, 250);
        }
    };

    // Handle voting
    const handleVote = (e, categoryId, autoTargetId = null) => {
        if (e) e.stopPropagation();
        if (!currentPlayer?.id) return;

        const targetId = autoTargetId || selectedPlayer;
        if (!targetId || isSubmitting) return;

        // Functional check of remaining votes based on LATEST state
        setMyVotes(prev => {
            // ONE VOTE TOTAL PER ROUND: Once you cast anything, you are done.
            if (prev.length >= 1) return prev;

            const currentCatVotes = prev.filter(v => v.category === categoryId).length;
            const limit = voteLimits[categoryId];
            const usedInDB = votesUsedHistory[categoryId] || 0;

            if (currentCatVotes + usedInDB >= limit) {
                console.warn(`VotePhase: Limit reached for ${categoryId}`);
                return prev;
            }

            const newVotes = [{ category: categoryId, targetId }]; // Always exactly one vote per round

            // Calculate if this was the last possible vote (using global state)
            const totalBudget = Object.values(voteLimits).reduce((a, b) => a + b, 0);
            const totalUsedInDB = Object.values(votesUsedHistory).reduce((a, b) => a + b, 0);
            const isLastOfTotalBudget = (1 + totalUsedInDB) >= totalBudget;

            // Optimistic UI feedback
            if (isLastOfTotalBudget) {
                if (!isSpectatorMode) playSound('giggle');
            } else {
                playSound('pop');
            }

            // Trigger immediate submission since it's the only vote
            debouncedSubmit(newVotes, true);

            return newVotes;
        });
    };


    // FIX: Transition Fallback Alignment
    // Wait gracefully for DB sync if active player and phase hasn't physically aligned yet
    const currentPhase = gameState?.phase || 'vote';
    const isCorrectPhaseType = currentPhase === 'vote';
    const isPhaseAligned = !!room?.settings;
    if ((!isPhaseAligned || !isCorrectPhaseType) && !isSpectatorMode) {
        return <div className="app-container" style={{ minHeight: '100dvh' }} />;
    }

    if (isSpectatorMode) {
        return (
            <div className="app-container" style={{ padding: '1.5rem', minHeight: '100dvh', overflowY: 'auto' }}>
                <SpectatorView players={players} room={room} gameState={gameState} t={t} isDarkMode={isDarkMode} onlinePlayerIds={onlinePlayerIds} />

                <div style={{
                    textAlign: 'center', marginTop: '30px',
                    color: timeLeft < 10 ? '#EF4444' : 'var(--phase-title)',
                    fontSize: '1.8rem', fontWeight: '800'
                }}>
                    ⏱️ {(gameState?.phase_expiry || room?.settings?.phase_expiry) ? timeLeft : '...'}
                </div>

                <div style={{
                    marginTop: '20px', textAlign: 'center',
                    color: 'var(--phase-ready-text)', fontWeight: 'bold'
                }}>
                    {t('playersVoted')}: {playersVotedCount}/{totalPlayersCount}
                </div>
            </div>
        );
    }

    return (
        <div
            className="app-container"
            onClick={handleBackgroundClick}
            style={{ padding: '1rem', minHeight: '100dvh', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
        >

            {/* Header: Title & Timer */}
            <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h1 style={{ color: isDarkMode ? '#C4B5FD' : darkPurple, fontSize: '1.4rem', fontWeight: '900', margin: 0 }}>
                    {t('voteTime')} 🗳️
                </h1>
                <div style={{
                    width: 'auto', minWidth: '45px', height: '45px',
                    padding: '0 10px',
                    borderRadius: '25px',
                    border: `4px solid ${timeLeft <= 3 ? accentRed : primaryColor}`,
                    display: 'flex', justifyContent: 'center', alignItems: 'center',
                    fontWeight: 'bold', fontSize: '1.1rem',
                    color: isDarkMode ? 'white' : darkPurple,
                    animation: timeLeft <= 3 ? 'pulse-red 1s infinite' : 'none',
                    transition: 'all 0.3s ease'
                }}>
                    {(gameState?.phase_expiry || room?.settings?.phase_expiry) ? timeLeft : '...'}
                </div>
                {/* Submission Status */}
                {hasVoted && (
                    <div style={{
                        marginLeft: '10px',
                        background: 'rgba(52, 211, 153, 0.2)',
                        color: accentGreen,
                        padding: '5px 10px',
                        borderRadius: '10px',
                        fontSize: '0.8rem',
                        fontWeight: 'bold',
                        display: 'flex', alignItems: 'center', gap: '5px'
                    }}>
                        {isSubmitting ? '...' : '✓ ' + t('voted')}
                    </div>
                )}
            </div>

            {/* Instruction Text */}
            <p style={{
                color: isDarkMode ? '#9CA3AF' : '#6B7280',
                fontSize: '0.9rem', fontWeight: '600', marginBottom: '15px', textAlign: 'center'
            }}>
                {t('tapToVote')}
            </p>

            {/* Player Grid (Scrollable) */}
            <div className="player-grid-v2">
                {candidates.map((player) => {
                    const playerVotes = myVotes.filter(v => v.targetId === player.id);
                    const isSelected = selectedPlayer === player.id;
                    const isOnline = onlinePlayerIds.has(player.id);
                    const hasLockedTarget = myVotes.length > 0;
                    // Lock target: If I have voted, I can only select the player I voted for.
                    // If no votes left, I can only select my existing target.
                    const canSelect = (!hasLockedTarget && hasVotesLeft) || (hasLockedTarget && (playerVotes.length > 0 || isSelected));

                    return (
                        <div
                            key={player.id}
                            onClick={(e) => handleSelectPlayer(e, player.id)}
                            className={`player-vote-card ${isSelected ? 'selected' : ''}`}
                            style={{
                                backgroundColor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'white',
                                opacity: (!isOnline ? 0.4 : 1) * (!canSelect && !isSelected && playerVotes.length === 0 ? 0.4 : 1),
                                pointerEvents: !canSelect ? 'none' : 'auto',
                                cursor: !canSelect ? 'default' : 'pointer',
                                overflow: 'visible',
                                position: 'relative'
                            }}
                        >
                            {/* Offline Badge */}
                            {!isOnline && (
                                <div style={{
                                    position: 'absolute', top: '5px', left: '5px', fontSize: '0.7rem',
                                    background: 'rgba(0,0,0,0.5)', color: 'white', padding: '1px 5px', borderRadius: '5px', zIndex: 11
                                }}>
                                    OFFLINE
                                </div>
                            )}
                            {/* Show a single condensed badge for all votes cast by ME */}
                            {(() => {
                                if (playerVotes.length === 0) return null;

                                // Find counts per category to determine "dominant" icon
                                const counts = {};
                                playerVotes.forEach(v => {
                                    counts[v.category] = (counts[v.category] || 0) + 1;
                                });

                                // Pick dominant category (highest count, fallback to first found)
                                const dominantCatId = Object.keys(counts).reduce((a, b) => counts[a] >= counts[b] ? a : b);
                                const dominantCat = categories.find(c => c.id === dominantCatId);
                                const totalCount = playerVotes.length;

                                return (
                                    <div style={{ position: 'absolute', top: '-10px', right: '-10px', zIndex: 10 }}>
                                        <div style={{
                                            background: dominantCat.color,
                                            width: '28px', height: '28px', borderRadius: '50%',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: '1rem',
                                            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                                            border: '2px solid white',
                                            position: 'relative',
                                            animation: 'pop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                                        }}>
                                            {dominantCat.icon}
                                        </div>
                                    </div>
                                );
                            })()}

                            <div className="player-vote-card-avatar">{player.avatar?.split('|')[0]}</div>
                            <div className="player-vote-card-name" style={{ color: isDarkMode ? '#E5E7EB' : '#374151' }}>
                                {player.name}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Vote Options (Contextual) */}
            <div style={{ width: '100%', maxWidth: '400px', marginTop: '15px', marginBottom: '15px' }} onClick={(e) => e.stopPropagation()}>
                {categories.map((cat) => {
                    const remaining = remainingVotes[cat.id];

                    // Button is disabled if: 
                    // 1. No player selected
                    // 2. Already used this category in a previous round (remaining <= 0)
                    // 3. Already cast A vote THIS round (myVotes.length >= 1)
                    // 4. Currently submitting
                    const isDisabled = !selectedPlayer || remaining <= 0 || myVotes.length >= 1 || isSubmitting;

                    return (
                        <button
                            key={cat.id}
                            onClick={(e) => handleVote(e, cat.id)}
                            className="vote-category-btn"
                            disabled={isDisabled}
                            style={{
                                width: '100%',
                                marginBottom: '10px',
                                background: remaining === 0
                                    ? (isDarkMode ? '#374151' : '#E5E7EB')
                                    : (selectedPlayer ? (isDarkMode ? 'rgba(255,255,255,0.1)' : 'white') : (isDarkMode ? 'rgba(255,255,255,0.05)' : '#F3F4F6')),
                                color: remaining === 0 ? '#9CA3AF' : (isDarkMode ? 'white' : '#1F2937'),
                                border: `2px solid ${selectedPlayer && remaining > 0 ? cat.color : 'transparent'}`,
                                padding: '12px 20px',
                                borderRadius: '16px',
                                fontSize: '1rem',
                                fontWeight: '700',
                                cursor: isDisabled ? 'default' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                opacity: isDisabled ? 0.6 : 1,
                                transition: 'background-color 0.2s ease, opacity 0.2s ease, border-color 0.2s ease, transform 0.2s ease, color 0.2s ease',
                                transform: 'scale(1)'
                            }}
                        >
                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span>{cat.label}</span>
                                <span style={{ fontSize: '1.2rem' }}>{cat.icon}</span>
                            </span>

                            <span style={{
                                background: remaining === 0 ? (isDarkMode ? '#4B5563' : '#D1D5DB') : cat.color,
                                color: 'white',
                                borderRadius: '50%',
                                width: '28px', height: '28px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '0.9rem', fontWeight: '800',
                                boxShadow: remaining > 0 ? '0 2px 4px rgba(0,0,0,0.2)' : 'none',
                                transition: 'background-color 0.2s ease, box-shadow 0.2s ease'
                            }}>
                                {remaining}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Bottom Status */}
            <div style={{ width: '100%', maxWidth: '400px', marginBottom: '10px' }}>
                <div style={{
                    background: isDarkMode ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.5)',
                    padding: '10px 20px',
                    borderRadius: '20px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    color: isDarkMode ? '#9CA3AF' : '#4B5563',
                    fontWeight: '600',
                    fontSize: '0.8rem',
                    backdropFilter: 'blur(5px)'
                }}>
                    <span>{t('playersVoted')}</span>
                    <span style={{
                        color: primaryColor, fontWeight: '800', fontSize: '1.1rem',
                        unicodeBidi: 'isolate', direction: 'ltr'
                    }}>
                        {playersVotedCount} / {totalPlayersCount}
                    </span>
                </div>
            </div>

        </div >
    );
}

export default VotePhase;
