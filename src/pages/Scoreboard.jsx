import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useRoom } from '../contexts/RoomContext';
import { useSound } from '../contexts/SoundContext';

function Scoreboard({ isDarkMode }) {
    const navigate = useNavigate();
    const { t, language } = useLanguage();
    const { playSound } = useSound();
    const { room, players, isHost, advancePhase, currentPlayer, onlinePlayerIds } = useRoom();
    const [showConfetti, setShowConfetti] = useState(true);
    const [isAdvancing, setIsAdvancing] = useState(false);
    const darkPurple = '#4C1D95';
    const primaryColor = '#6C63FF';

    // Sort players by score
    // Spectator Mode Check: Filter out Host from scoreboard if active
    const playingIds = room?.settings?.player_order || [];
    const cachedNames = room?.settings?.player_names || {};
    const isSpectatorMode = playingIds.length > 0 && !playingIds.includes(currentPlayer?.id) && currentPlayer?.is_host;

    // Merge active players with info from player_order for those who left
    const allPlayingPlayers = playingIds.map(id => {
        const active = players.find(p => p.id === id);
        if (active) return active;
        // Fallback for departed players
        return {
            id,
            name: cachedNames[id] || "Ghost",
            score: 0, // In reality, we could store their final score in settings too, but for now 0 is better than nothing
            avatar: "👻",
            title: "The Departed"
        };
    });

    const sortedPlayers = [...allPlayingPlayers].sort((a, b) => (b.score || 0) - (a.score || 0));

    // Podium is Top 3
    const top3 = sortedPlayers.slice(0, 3);
    const rest = sortedPlayers.slice(3);

    // Check Winning Condition
    const settingScore = room?.settings?.scoreToWin || room?.settings?.maxScore; // Backwards compatibility
    const winningScore = parseInt(settingScore || 5, 10);
    const topScore = sortedPlayers[0]?.score || 0;

    const hasWinner = topScore >= winningScore;

    // Simple Chaos Awards (Placeholder logic)
    const awards = [
        { title: t('chaosMaster'), winner: sortedPlayers[0] || { name: '...', avatar: '❓' }, icon: '😈' },
        { title: t('mostMisunderstood'), winner: sortedPlayers[sortedPlayers.length - 1] || { name: '...', avatar: '❓' }, icon: '😵‍💫' },
    ];

    // Generate confetti pieces
    const confettiPieces = Array.from({ length: 50 }).map((_, i) => ({
        id: i,
        left: Math.random() * 100 + '%',
        animationDelay: Math.random() * 2 + 's',
        backgroundColor: ['#FFD700', '#FF69B4', '#00BFFF', '#32CD32'][Math.floor(Math.random() * 4)]
    }));

    const hasPlayedEntrySound = useRef(false);

    useEffect(() => {
        if (!hasPlayedEntrySound.current) {
            playSound('whoosh');
            if (showConfetti) {
                playSound('coin');
            }
            hasPlayedEntrySound.current = true;
        }
        const timer = setTimeout(() => setShowConfetti(false), 3000);
        return () => clearTimeout(timer);
    }, [playSound, showConfetti]);



    return (
        <div className="app-container" style={{ padding: '1rem', minHeight: '100dvh', overflowX: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

            {/* Confetti */}
            {showConfetti && (
                <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 100 }}>
                    {confettiPieces.map((piece) => (
                        <div
                            key={piece.id}
                            className="confetti-piece"
                            style={{
                                left: piece.left,
                                animation: `confetti-fall 3s linear forwards`,
                                animationDelay: piece.animationDelay,
                                backgroundColor: piece.backgroundColor
                            }}
                        />
                    ))}
                </div>
            )}

            {/* Header */}
            <h1 className="main-title" style={{ fontSize: '1.8rem', marginTop: '10px', marginBottom: '5px' }}>
                {t('roundResults')}
            </h1>

            <p style={{ color: isDarkMode ? '#C4B5FD' : darkPurple, fontSize: '0.9rem', fontWeight: '600', marginBottom: '20px', fontStyle: 'italic' }}>
                "{t('unhingedMessage')}"
            </p>

            {/* Podium Section */}
            <div className="podium-container">
                {/* 2nd Place */}
                {/* 2nd Place */}
                <div className="podium-place second" style={{ opacity: (top3 && top3[1]) ? 1 : 0 }}>
                    {top3 && top3[1] && (
                        <>
                            <div className="podium-avatar">
                                {top3[1].avatar?.split('|')[0]}
                                <div style={{ position: 'absolute', bottom: '-10px', background: '#C0C0C0', color: '#1F2937', fontWeight: 'bold', fontSize: '0.8rem', padding: '2px 8px', borderRadius: '10px' }}>2</div>
                            </div>
                            <div className="podium-bar">
                                <div style={{ fontSize: '1.5rem', fontWeight: '900' }}>{top3[1].score}</div>
                                <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>pts</div>
                                <div style={{ marginTop: 'auto', marginBottom: '10px', fontSize: '0.9rem' }}>{top3[1].name}</div>
                            </div>
                        </>
                    )}
                </div>

                {/* 1st Place */}
                <div className="podium-place first" style={{ animation: 'bounce-question 3s infinite ease-in-out' }}>
                    {top3 && top3[0] && (
                        <>
                            <div className="podium-avatar">
                                {top3[0].avatar?.split('|')[0]}
                                <div style={{ position: 'absolute', top: '-25px', fontSize: '2rem' }}>👑</div>
                                <div style={{ position: 'absolute', bottom: '-10px', background: '#FFD700', color: '#1F2937', fontWeight: 'bold', fontSize: '0.8rem', padding: '2px 8px', borderRadius: '10px' }}>1</div>
                            </div>
                            <div className="podium-bar">
                                <div style={{ fontSize: '2rem', fontWeight: '900' }}>{top3[0].score}</div>
                                <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>pts</div>
                                <div style={{ marginTop: 'auto', marginBottom: '15px', fontSize: '1.1rem' }}>{top3[0].name}</div>
                            </div>
                        </>
                    )}
                </div>

                {/* 3rd Place */}
                <div className="podium-place third" style={{ opacity: (top3 && top3[2]) ? 1 : 0 }}>
                    {top3 && top3[2] && (
                        <>
                            <div className="podium-avatar">
                                {top3[2].avatar?.split('|')[0]}
                                <div style={{ position: 'absolute', bottom: '-10px', background: '#CD7F32', color: 'white', fontWeight: 'bold', fontSize: '0.8rem', padding: '2px 8px', borderRadius: '10px' }}>3</div>
                            </div>
                            <div className="podium-bar">
                                <div style={{ fontSize: '1.5rem', fontWeight: '900' }}>{top3[2].score || 0}</div>
                                <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>pts</div>
                                <div style={{ marginTop: 'auto', marginBottom: '10px', fontSize: '0.9rem' }}>{top3[2].name}</div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Funny Achievements (Chaos Awards) */}
            <div style={{ width: '100%', maxWidth: '500px', marginBottom: '20px' }}>
                <h3 style={{ textAlign: language === 'ar' ? 'right' : 'left', color: isDarkMode ? '#9CA3AF' : '#4B5563', fontSize: '0.9rem', marginBottom: '10px', paddingLeft: '10px' }}>
                    {t('chaosAwards')} 🏆
                </h3>
                {awards.map((award, index) => (
                    <div key={index} className="chaos-award-card">
                        <div style={{ fontSize: '2rem' }}>{award.icon}</div>
                        <div style={{ flex: 1, textAlign: 'left' }}>
                            <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: primaryColor, textTransform: 'uppercase' }}>{award.title}</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: '700', color: isDarkMode ? 'white' : '#1F2937' }}>{award.winner.name}</div>
                        </div>
                        <div style={{ fontSize: '1.5rem' }}>{award.winner.avatar?.split('|')[0]}</div>
                    </div>
                ))}
            </div>

            {/* Scrollable Score List */}
            <div style={{ width: '100%', maxWidth: '500px', flex: 1, overflowY: 'auto', paddingBottom: '20px' }}>
                <h3 style={{ textAlign: language === 'ar' ? 'right' : 'left', color: isDarkMode ? '#9CA3AF' : '#4B5563', fontSize: '0.9rem', marginBottom: '10px', paddingLeft: '10px' }}>
                    {t('theRest')} 📉
                </h3>
                {rest.map((player, index) => (
                    <div key={player.id} className="score-list-item">
                        <div style={{ width: '30px', fontWeight: 'bold', color: '#9CA3AF' }}>{index + 4}.</div>
                        <div style={{ fontSize: '1.5rem', marginInlineEnd: '15px' }}>{player.avatar?.split('|')[0]}</div>
                        <div style={{ flex: 1, textAlign: language === 'ar' ? 'right' : 'left' }}>
                            <div style={{ fontWeight: '700', color: isDarkMode ? 'white' : '#1F2937' }}>{player.name}</div>
                            <div className="funny-title" style={{ color: '#9CA3AF' }}>"{player.title}"</div>
                        </div>
                        <div className="score-text" style={{ color: isDarkMode ? '#C4B5FD' : primaryColor }}>
                            {player.score} <span style={{ fontSize: '0.8rem' }}>pts</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Bottom Action */}
            <div style={{ width: '100%', maxWidth: '400px', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(0,0,0,0.1)' }}>
                {isHost ? (
                    <button
                        className="action-btn"
                        disabled={isAdvancing}
                        onClick={() => {
                            setIsAdvancing(true);
                            playSound('tap');
                            // Active Player Count (Exclude Spectator Host)
                            const activeCount = playingIds.filter(id => onlinePlayerIds.has(id)).length;

                            if (hasWinner) {
                                advancePhase('winner');
                            } else if (activeCount < 3) {
                                // Not enough players to continue
                                advancePhase('lobby');
                            } else {
                                advancePhase('text');
                            }
                        }}
                        style={{
                            width: '100%',
                            animation: 'pop 0.5s 2s backwards',
                            opacity: isAdvancing ? 0.5 : 1,
                            cursor: isAdvancing ? 'not-allowed' : 'pointer',
                            pointerEvents: isAdvancing ? 'none' : 'auto'
                        }}
                    >
                        {(() => {
                            const activeCount = playingIds.filter(id => onlinePlayerIds.has(id)).length;
                            if (hasWinner) return `🏆 ${t('seeWinner') || "See Grand Winner"} 🏆`;
                            if (activeCount < 3) return `🏠 ${t('goToLobby') || "Go to Lobby"} 🏠`;
                            return t('nextRound') + " 🚀";
                        })()}
                    </button>
                ) : (
                    <div style={{ textAlign: 'center', color: '#9CA3AF', fontWeight: 'bold' }}>
                        {(() => {
                            const activeCount = playingIds.filter(id => onlinePlayerIds.has(id)).length;
                            if (activeCount < 3) return t('waitingForHost') + " (Not enough players)";
                            return t('waitingForHost') + "...";
                        })()}
                    </div>
                )}
            </div>

        </div >
    );
}

export default Scoreboard;
