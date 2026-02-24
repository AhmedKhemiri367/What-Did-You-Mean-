import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useRoom } from '../contexts/RoomContext';
import { useSound } from '../contexts/SoundContext';

function RevealPhase({ isDarkMode }) {
    const navigate = useNavigate();
    const { t } = useLanguage();
    const { playSound } = useSound();
    const { room, players, isHost, advancePhase, updateRoomSettings, currentPlayer } = useRoom();
    // Use global state from room.settings
    const chainIndex = room?.settings?.reveal_chain_index || 0;
    const [isAdvancing, setIsAdvancing] = useState(false);

    // Spectator Check
    const playingIds = room?.settings?.player_order || [];
    const isSpectatorMode = playingIds.length > 0 && !playingIds.includes(currentPlayer?.id);

    // Auto-scroll to top when moving to next chain
    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
    }, [chainIndex]);

    const revealEndRef = useRef(null);

    const step = room?.settings?.reveal_step || 0;

    // Auto-scroll Down and play sound when a new step is revealed
    useEffect(() => {
        if (step > 0) {
            playSound('pop');
            revealEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [step, playSound]);

    // Sound: Phase Entry and Chain Switch
    useEffect(() => {
        if (chainIndex === 0) {
            playSound('whoosh');
        } else {
            playSound('sparkle');
        }
    }, [chainIndex, playSound]);

    // Build chains using preserved history from room settings
    const history = room?.settings?.history || {};
    const strip = (val) => val ? (val.includes(':') ? val.split(':').slice(1).join(':') : val) : null;
    const subLabel = isDarkMode ? '#DDD6FE' : '#4C1D95';
    const cardText = isDarkMode ? '#F5F3FF' : '#1E1B4B';

    const chainsDict = room?.settings?.chains || {};
    const chainIds = Object.keys(chainsDict);
    const cachedNames = room?.settings?.player_names || {};
    const getName = (id) => {
        if (id === 'ghost_player') return `👻 ${t('mysteryPlayer')}`;
        return cachedNames[id] || players.find(p => p.id === id)?.name || "Unknown";
    };

    const chains = chainIds.map(cId => {
        const chain = chainsDict[cId];
        const h = chain.history || [];
        return {
            id: cId,
            steps: h.map((entry) => ({
                ...entry,
                authorName: getName(entry.playerId),
                isGhost: entry.playerId === 'ghost_player'
            }))
        };
    }).filter(c => c.steps.length > 0);

    const currentChain = chains[chainIndex] || {};
    const isLastChain = chainIndex === (chains.length - 1);

    const [isUpdating, setIsUpdating] = useState(false);

    const handleNextReveal = () => {
        if (!isHost || isUpdating) return;

        setIsUpdating(true);
        setTimeout(() => setIsUpdating(false), 300); // Reduced from 800ms

        const currentChainLength = currentChain.steps?.length || 0;

        if (step < currentChainLength) {
            updateRoomSettings({ reveal_step: step + 1 });
        } else if (!isLastChain) {
            // Move to next player, start at step 1
            updateRoomSettings({ reveal_chain_index: chainIndex + 1, reveal_step: 1 });
        } else {
            advancePhase('vote');
        }
    };

    // Auto-advance logic
    // Auto-advance logic REMOVED for manual host control
    /*
    useEffect(() => {
        if (!room) return;
        if (timeLeft > 0) {
            const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
            return () => clearTimeout(timer);
        } else {
            handleNextReveal();
        }
    }, [timeLeft, room]);
    */

    const isRoomReady = !!(room && players.length);


    const containerStyle = {
        width: '100%',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: '40px',
        paddingBottom: '40px'
    };

    const cardStyle = {
        background: 'var(--phase-card-bg)',
        padding: '25px',
        borderRadius: '25px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
        width: '100%',
        maxWidth: '450px',
        marginBottom: '20px',
        border: '2px solid rgba(255,255,255,0.1)',
        backdropFilter: 'blur(5px)',
        animation: 'pop-in 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
    };

    const containerPaddingBottom = isHost ? '180px' : '80px';

    return (
        <div className="app-container" style={{ padding: '1.5rem', paddingBottom: containerPaddingBottom, minHeight: '100dvh', overflowY: 'auto' }}>

            <div style={containerStyle}>

                <h1 style={{ color: 'var(--phase-title)', fontSize: '2.5rem', fontWeight: '900', textAlign: 'center', marginBottom: '10px', textShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                    {t('revealTitle')} 🎬
                </h1>

                <p style={{ color: 'var(--phase-title)', fontWeight: '800', marginBottom: '30px', opacity: 0.7 }}>
                    {t('chainCount').replace('{current}', chainIndex + 1).replace('{total}', chains.length)}
                </p>

                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px' }}>
                    {currentChain.steps?.map((historyStep, idx) => {
                        // Only show steps up to the current reveal 'step' (if we want to keep the staged reveal)
                        // Actually, 'step' in room settings corresponds to how many entries of the CURRENT chain to show.
                        if (idx + 1 > step) return null;

                        const isInterpretation = historyStep.phase === 'text' || historyStep.phase.startsWith('interpretation');
                        const label = isInterpretation ?
                            (historyStep.phase === 'text' ? t('wrote') : t('guessed')) :
                            t('translated');

                        const bgColor = isInterpretation ? (idx === 0 ? 'var(--phase-card-bg)' : '#FFFBEB') : 'var(--phase-card-bg)';
                        const borderColor = isInterpretation ? (idx === 0 ? 'rgba(255,255,255,0.1)' : '#FEF3C7') : 'rgba(255,255,255,0.1)';
                        const textColor = isInterpretation ? (idx === 0 ? cardText : '#92400E') : cardText;
                        const labelColor = isInterpretation ? (idx === 0 ? subLabel : '#D97706') : subLabel;

                        return (
                            <div style={{ ...cardStyle, background: bgColor, border: `2px solid ${borderColor}` }} key={`${chainIndex}-${idx}`}>
                                <p style={{ color: labelColor, fontSize: '0.8rem', fontWeight: '800', textTransform: 'uppercase', marginBottom: '8px' }}>
                                    {historyStep.authorName} {label}:
                                </p>
                                {isInterpretation ? (
                                    <p style={{ color: textColor, fontSize: idx === 0 ? '1.4rem' : '1.6rem', fontWeight: '900', fontStyle: idx === 0 ? 'normal' : 'italic' }}>
                                        "{historyStep.content}"
                                    </p>
                                ) : (
                                    <div style={{ fontSize: '3rem', display: 'flex', gap: '10px', justifyContent: 'center' }}>
                                        {historyStep.content?.split(' ').map((e, i) => <span key={i} className="hover-pop">{e}</span>)}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Navigation Controls (Only for Host manual skip, or just indicator) */}
                {/* Navigation Controls (Manual Host Control) */}
                <div style={{ marginTop: '40px', width: '100%', maxWidth: '300px', textAlign: 'center' }}>

                    {isHost ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                            <div style={{ color: 'var(--phase-title)', fontWeight: 'bold', opacity: 0.8, fontSize: '0.9rem' }}>
                                {t('youAreHost')} - {t('controlFlow')}
                            </div>
                            <button
                                onClick={handleNextReveal}
                                className="action-btn"
                                disabled={isUpdating || isAdvancing}
                                style={{
                                    background: 'var(--phase-title)',
                                    padding: '12px 30px',
                                    fontSize: '1.2rem',
                                    opacity: isUpdating || isAdvancing ? 0.6 : 1,
                                    boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
                                }}
                            >
                                {step >= (currentChain.steps?.length || 0) && isLastChain ? t('goToVote') : t('nextReveal')} ⏭️
                            </button>
                        </div>
                    ) : (
                        <div style={{
                            color: 'var(--phase-title)',
                            fontWeight: 'bold',
                            background: 'rgba(255,255,255,0.1)',
                            padding: '15px 25px',
                            borderRadius: '20px',
                            backdropFilter: 'blur(5px)',
                            border: '2px solid rgba(255,255,255,0.05)'
                        }}>
                            ⏳ {t('waitingForHost')}
                        </div>
                    )}
                </div>
                {/* 
                   Anchor for auto-scroll - placed at the absolute bottom.
                   Using a taller anchor ensures that it pulls the buttons fully into view on mobile 
                   even when the browser's address bar/tab bar is visible.
                */}
                <div ref={revealEndRef} style={{ height: '50px', width: '100%' }} />

            </div>

            <style>{`
                @keyframes pop-in {
                    0% { transform: scale(0.85); opacity: 0; }
                    100% { transform: scale(1); opacity: 1; }
                }
                .hover-pop:hover { transform: scale(1.2); cursor: default; }
            `}</style>
        </div>
    );
}

export default RevealPhase;
