import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useRoom } from '../contexts/RoomContext';
import { useSound } from '../contexts/SoundContext';

function GameWinner({ isDarkMode }) {
    const navigate = useNavigate();
    const { t } = useLanguage();
    const { room, players, isHost, advancePhase, leaveRoom } = useRoom();
    const { playSound, stopSound } = useSound();
    const [showConfetti, setShowConfetti] = useState(true);
    const primaryColor = '#6C63FF';

    const [displayScore, setDisplayScore] = useState(0);

    const [victoryPhrase] = useState(() => {
        const phrases = [
            "LEGENDARY!", "UNSTOPPABLE 🚀", "GG EZ", "SIMPLY THE BEST",
            "CHAMPION 🏆", "TOO GOOD", "LEVEL UP 🆙", "NO MERCY 😤",
            "THE GOAT 🐐", "VICTORY ROYALE", "CRUSHED IT 💥", "MASTERPIECE ✨"
        ];
        return phrases[Math.floor(Math.random() * phrases.length)];
    });

    // Find real winner (Safe derivation)
    const safePlayers = players || [];
    const sortedPlayers = [...safePlayers].sort((a, b) => (b.score || 0) - (a.score || 0));
    const winner = sortedPlayers[0] || { name: '...', avatar: '❓', score: 0 };
    const winnerTitle = winner.score >= (room?.settings?.maxScore || 30) ? t('gameWinner') : t('currentLeader');

    // Confetti Logic
    const confettiPieces = Array.from({ length: 100 }).map((_, i) => ({
        id: i,
        left: Math.random() * 100 + '%',
        animationDelay: Math.random() * 2 + 's',
        backgroundColor: ['#FFD700', '#FF69B4', '#00BFFF', '#32CD32'][Math.floor(Math.random() * 4)]
    }));

    const hasPlayedCheer = useRef(false);

    useEffect(() => {
        // Confetti Timer
        const confettiTimer = setTimeout(() => setShowConfetti(false), 5000);

        // Score Counting Animation
        let start = 0;
        const end = winner.score || 0;
        const duration = 2000; // 2 seconds
        const incrementTime = 16; // Update every 16ms (approx 60 FPS)
        const steps = duration / incrementTime;
        const incrementValue = end / steps;

        const scoreTimer = setInterval(() => {
            start += incrementValue;
            if (start >= end) {
                setDisplayScore(end);
                clearInterval(scoreTimer);
                if (end > 0 && !hasPlayedCheer.current) {
                    playSound('cheer');
                    hasPlayedCheer.current = true;
                }
            } else {
                setDisplayScore(Math.floor(start));
            }
        }, incrementTime);

        return () => {
            clearTimeout(confettiTimer);
            clearInterval(scoreTimer);
            stopSound('cheer');
        };
    }, [winner.score]);


    const handleShare = () => {
        // Mock Share
        alert("Coming Soon 🚧");
    };

    return (
        <div className="app-container" style={{ padding: '1rem', height: '100dvh', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>

            {/* Confetti Overlay */}
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
                                backgroundColor: piece.backgroundColor,
                                willChange: 'transform'
                            }}
                        />
                    ))}
                </div>
            )}

            {/* Header */}
            <h1 className="main-title" style={{ fontSize: '2rem', marginBottom: '10px', animation: 'bounce-question 3s infinite ease-in-out' }}>
                {winnerTitle}
            </h1>

            {/* Winner Hero Card */}
            <div className="winner-hero-card">
                <div className="winner-avatar-container">
                    <div className="winner-crown">👑</div>
                    <div className="winner-avatar">{winner.avatar?.split('|')[0]}</div>
                </div>

                <h2 style={{ fontSize: '1.5rem', fontWeight: '900', color: isDarkMode ? 'white' : '#1F2937', margin: 0 }}>
                    {winner.name}
                </h2>

                <div className="winner-score">
                    {displayScore} <span style={{ fontSize: '1rem', color: isDarkMode ? '#C4B5FD' : primaryColor }}>pts</span>
                </div>

                <div className="winner-title-badge">
                    {victoryPhrase}
                </div>

            </div>

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', maxWidth: '350px', marginTop: '15px', animation: 'pop 0.5s 1.5s backwards' }}>

                {/* Primary: Go to Lobby (Host Only) */}
                {isHost ? (
                    <button
                        className="action-btn"
                        onClick={() => {
                            stopSound('cheer');
                            playSound('tap');
                            playSound('whoosh');
                            advancePhase('lobby');
                        }}
                        style={{ width: '100%', fontSize: '1.1rem', padding: '12px' }}
                    >
                        {t('goToLobby')} 🏠
                    </button>
                ) : (
                    <div style={{ textAlign: 'center', color: '#9CA3AF', fontWeight: 'bold' }}>
                        {t('waitingForHost')}...
                    </div>
                )}

                {/* Secondary Buttons (Stacked) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                    {/* Share */}
                    <button
                        className="action-btn"
                        onClick={() => {
                            playSound('tap');
                            handleShare();
                        }}
                        style={{
                            width: '100%',
                            fontSize: '0.9rem',
                            padding: '10px',
                            background: isDarkMode ? 'rgba(255,255,255,0.1)' : 'white',
                            color: isDarkMode ? 'white' : '#4B5563',
                            boxShadow: '0 4px 6px rgba(0,0,0,0.05)',
                            border: 'none',
                        }}
                    >
                        {t('shareResults')}
                    </button>

                    {/* Leave Room */}
                    <button
                        className="action-btn"
                        onClick={() => {
                            stopSound('cheer');
                            playSound('tap');
                            leaveRoom(true);
                        }}
                        style={{
                            width: '100%',
                            fontSize: '0.9rem',
                            padding: '10px',
                            background: 'transparent',
                            border: '2px solid #EF4444',
                            color: '#EF4444',
                            boxShadow: 'none'
                        }}
                    >
                        {t('leaveRoom')}
                    </button>
                </div>

            </div>

        </div>
    );
}

export default GameWinner;
