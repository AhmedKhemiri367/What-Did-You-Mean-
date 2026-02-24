import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useSound } from '../contexts/SoundContext';

const SpectatorView = ({ players, room, gameState, t, isDarkMode, onlinePlayerIds }) => {
    const { playSound } = useSound();
    const activePlayerIds = room?.settings?.player_order || [];
    const activePlayers = activePlayerIds
        .map(id => players.find(p => p.id === id))
        .filter(p => p && onlinePlayerIds?.has(p.id));
    const { language } = useLanguage();

    const [currentIndex, setCurrentIndex] = useState(0);

    const handleNext = () => {
        playSound?.('tap');
        setCurrentIndex((prev) => (prev + 1) % activePlayers.length);
    };

    const handlePrev = () => {
        playSound?.('tap');
        setCurrentIndex((prev) => (prev - 1 + activePlayers.length) % activePlayers.length);
    };

    // Safeguard: Reset index if out of bounds (player left)
    React.useEffect(() => {
        if (currentIndex >= activePlayers.length && activePlayers.length > 0) {
            setCurrentIndex(0);
        }
    }, [activePlayers.length, currentIndex]);

    if (activePlayers.length === 0) return <div>{t('waitingForPlayers') || 'Waiting for players'}...</div>;

    const watchedPlayer = activePlayers[currentIndex] || activePlayers[0];

    // NEW: Chain Model Resolution
    const currentPhase = gameState?.phase || 'text';
    const assignments = room?.settings?.assignments?.[currentPhase] || {};
    const chainId = assignments[watchedPlayer?.id];
    const chain = room?.settings?.chains?.[chainId];
    const chainHistory = chain?.history || [];

    let contentToDisplay = "";
    let promptTitle = "";
    let liveDraft = watchedPlayer?.last_answer || "";

    // Parse Live Draft / Answer
    let draftDisplay = "";
    let isSubmitted = false;

    if (liveDraft) {
        if (liveDraft.startsWith('text:')) {
            draftDisplay = liveDraft.replace('text:', '');
            isSubmitted = true;
        } else if (liveDraft.startsWith('draft:')) {
            draftDisplay = liveDraft.replace('draft:', '');
        } else if (liveDraft.startsWith('emoji:')) {
            draftDisplay = liveDraft.replace('emoji:', '');
            isSubmitted = true;
        } else if (liveDraft.startsWith('draft_emoji:')) {
            draftDisplay = liveDraft.replace('draft_emoji:', '');
        } else if (liveDraft.startsWith('guess:')) {
            draftDisplay = liveDraft.replace('guess:', '');
            isSubmitted = true;
        } else if (liveDraft.startsWith('draft_guess:')) {
            draftDisplay = liveDraft.replace('draft_guess:', '');
        } else if (liveDraft.startsWith('draft_vote:')) {
            const targetId = liveDraft.replace('draft_vote:', '');
            const targetPlayer = players.find(p => p.id === targetId);
            draftDisplay = (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', opacity: 1 }}>
                    <span style={{ fontSize: '0.9rem', color: isDarkMode ? '#9CA3AF' : '#6B7280', fontWeight: 'bold', textTransform: 'uppercase' }}>
                        {t('considering') || 'Considering:'}
                    </span>
                    <div style={{
                        background: isDarkMode ? 'rgba(108, 99, 255, 0.15)' : 'rgba(108, 99, 255, 0.05)',
                        padding: '10px 20px',
                        borderRadius: '20px',
                        border: '2px dashed #6C63FF',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px'
                    }}>
                        <span style={{ fontSize: '1.5rem' }}>{targetPlayer?.avatar?.split('|')[0] || '👤'}</span>
                        <span style={{ fontSize: '1.2rem', color: '#6C63FF', fontWeight: '800' }}>{targetPlayer ? targetPlayer.name : '...'}</span>
                    </div>
                </div>
            );
        } else if (liveDraft.startsWith('vote_multi:')) {
            try {
                // Determine if it's JSON or just a raw string (backwards compat)
                const payload = liveDraft.replace('vote_multi:', '');
                const votes = JSON.parse(payload);
                if (Array.isArray(votes) && votes.length > 0) {
                    draftDisplay = (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', width: '100%' }}>
                            {activePlayerIds.map(targetId => {
                                const targetVotes = votes.filter(v => v.targetId === targetId);
                                if (targetVotes.length === 0) return null;

                                const tP = players.find(p => p.id === targetId);

                                // Group by category to find dominant one
                                const catCounts = {};
                                targetVotes.forEach(v => {
                                    catCounts[v.category] = (catCounts[v.category] || 0) + 1;
                                });
                                const dominantCatId = Object.keys(catCounts).reduce((a, b) => catCounts[a] >= catCounts[b] ? a : b);
                                const icon = dominantCatId === 'funniest' ? '😂' : dominantCatId === 'mostAccurate' ? '🎯' : '🤯';
                                const color = dominantCatId === 'funniest' ? '#F472B6' : dominantCatId === 'mostAccurate' ? '#34D399' : '#F87171';
                                const total = targetVotes.length;

                                return (
                                    <div key={targetId} style={{
                                        fontSize: '1rem', color: isDarkMode ? '#E5E7EB' : '#374151',
                                        display: 'flex', alignItems: 'center', gap: '12px',
                                        background: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                                        padding: '10px 16px', borderRadius: '15px', width: '100%', maxWidth: '250px',
                                        border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}`
                                    }}>
                                        <div style={{
                                            background: color, width: '36px', height: '36px', borderRadius: '50%',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid white',
                                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)', flexShrink: 0
                                        }}>
                                            <span style={{ fontSize: '1.2rem' }}>{icon}</span>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                                            <span style={{ fontWeight: '800', fontSize: '1.1rem' }}>{tP?.name || 'Unknown'}</span>
                                            <span style={{ fontSize: '0.75rem', opacity: 0.7, textTransform: 'uppercase', fontWeight: 'bold' }}>
                                                {total > 1 ? `${total} ${t('votes') || 'Votes'}` : t(dominantCatId)}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    );
                    isSubmitted = true;
                }
            } catch (e) { console.error("Error parsing vote_multi", e); }
        } else if (liveDraft.startsWith('vote:')) {
            const parts = liveDraft.split(':');
            const categoryId = parts[1];
            const targetId = parts[2];

            const targetPlayer = players.find(p => p.id === targetId);
            const categoryLabel = categoryId === 'funniest' ? '😂 Funniest' :
                categoryId === 'mostAccurate' ? '🎯 Most Accurate' :
                    categoryId === 'mostDestroyed' ? '🤯 Most Destroyed' : 'Unknown';

            draftDisplay = (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.9rem', color: isDarkMode ? '#9CA3AF' : '#6B7280', fontWeight: 'bold', textTransform: 'uppercase' }}>
                        {t('votedFor') || 'Voted For:'}
                    </span>
                    <div style={{
                        background: isDarkMode ? 'rgba(108, 99, 255, 0.2)' : 'rgba(108, 99, 255, 0.1)',
                        padding: '12px 24px',
                        borderRadius: '20px',
                        border: '2px solid #6C63FF',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '4px'
                    }}>
                        <span style={{ fontSize: '1.2rem', color: '#6C63FF', fontWeight: '900' }}>{targetPlayer ? targetPlayer.name : 'Unknown Player'}</span>
                        <span style={{ fontSize: '0.85rem', background: 'rgba(108, 99, 255, 0.2)', color: isDarkMode ? 'white' : '#4C1D95', padding: '2px 10px', borderRadius: '10px', fontWeight: 'bold' }}>
                            {categoryLabel}
                        </span>
                    </div>
                </div>
            );
            isSubmitted = true;
        }
    }

    if (!chainId) {
        contentToDisplay = "---";
        promptTitle = "No assignment found...";
    } else if (currentPhase === 'text') {
        promptTitle = t('phase1Title'); // "Make up a phrase"
        contentToDisplay = "---";
    } else {
        // Smart lookback: Find the last person who contributed to this chain
        const lastStep = [...chainHistory].reverse().find(step => step.content && step.content !== "...");
        contentToDisplay = lastStep?.content || (currentPhase.startsWith('emoji') ? "✍️ Waiting for phrase..." : "🔡 Waiting for emojis...");

        if (currentPhase.startsWith('emoji')) {
            promptTitle = t('translatePhrase');
        } else if (currentPhase.startsWith('interpretation')) {
            promptTitle = t('phase3Title'); // Interpret emojis
        } else if (currentPhase === 'vote') {
            promptTitle = t('voteTime') || "Voting Phase 🗳️";
            contentToDisplay = "Choose the best answer!";
        }
    }

    return (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {/* Spectator Header */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '20px',
                background: 'rgba(0,0,0,0.2)', padding: '10px 20px', borderRadius: '30px', marginBottom: '20px'
            }}>
                <button onClick={handlePrev} style={{ background: 'none', border: 'none', color: isDarkMode ? 'white' : '#4B5563', fontSize: '1.5rem', cursor: 'pointer' }}>{language === 'ar' ? '▶' : '◀'}</button>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', color: isDarkMode ? '#9CA3AF' : '#6B7280', letterSpacing: '1px' }}>SPECTATING</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                        {watchedPlayer?.avatar?.split('|')[0]} {watchedPlayer?.name}
                    </div>
                </div>
                <button onClick={handleNext} style={{ background: 'none', border: 'none', color: isDarkMode ? 'white' : '#4B5563', fontSize: '1.5rem', cursor: 'pointer' }}>{language === 'ar' ? '◀' : '▶'}</button>
            </div>

            {/* Simulated View */}
            <div style={{
                width: '100%', maxWidth: '400px',
                background: isDarkMode ? '#1F2937' : 'white',
                padding: '30px', borderRadius: '25px',
                boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
                textAlign: 'center',
                opacity: 0.9,
                display: 'flex', flexDirection: 'column', gap: '20px'
            }}>
                <div>
                    <h3 style={{ color: '#6C63FF', marginBottom: '10px', fontSize: '1.2rem' }}>{promptTitle}</h3>
                    {/* What they are seeing */}
                    <div style={{
                        fontSize: '1.3rem', fontWeight: 'bold',
                        color: isDarkMode ? '#F3F4F6' : '#1F2937',
                        minHeight: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: isDarkMode ? 'rgba(255,255,255,0.05)' : '#F3F4F6',
                        padding: '10px', borderRadius: '15px'
                    }}>
                        "{contentToDisplay}"
                    </div>
                </div>

                {/* What they are writing (Live Draft) */}
                <div style={{ borderTop: '2px dashed rgba(107, 114, 128, 0.3)', paddingTop: '20px' }}>
                    <h4 style={{ color: isDarkMode ? '#9CA3AF' : '#6B7280', marginBottom: '10px', fontSize: '0.9rem', textTransform: 'uppercase' }}>
                        {isSubmitted ? 'Submitted Answer:' : 'Current Draft:'}
                    </h4>
                    <div style={{
                        fontSize: '1.4rem', fontWeight: 'bold',
                        color: isSubmitted ? '#10B981' : (isDarkMode ? '#D1D5DB' : '#374151'),
                        minHeight: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontStyle: isSubmitted ? 'normal' : 'italic'
                    }}>
                        {draftDisplay || (
                            <span style={{ opacity: 0.5 }}>...</span>
                        )}
                    </div>
                </div>
            </div>

            <div style={{ marginTop: '20px', color: '#EF4444', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                👁️ Spectator Mode: Viewing Real-Time Input
            </div>
        </div>
    );
};

export default SpectatorView;
