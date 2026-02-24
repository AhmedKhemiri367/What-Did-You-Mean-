import React, { useState } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useRoom } from '../contexts/RoomContext';
import { useSound } from '../contexts/SoundContext';

const AVATARS = ['😎', '🦊', '🐱', '🐼', '🐸', '🦁', '🦄', '👻', '👾', '🤖', '🎃', '👽'];

function AvatarSelection({ isDarkMode }) {
    const navigate = useNavigate();
    const location = useLocation();
    const { language, t } = useLanguage();
    const { currentPlayer, updatePlayerProfile } = useRoom(); // Get profile functions
    const { playSound } = useSound();
    const [searchParams] = useSearchParams();
    const mode = searchParams.get('mode') || 'join';
    const from = searchParams.get('from'); // 'lobby' or null

    // Initialize state with current player logic if editing
    const getInitialName = () => {
        if (from === 'lobby' && currentPlayer?.name) return currentPlayer.name;
        // Load from localStorage if available
        return localStorage.getItem('player_name') || '';
    };

    const getInitialAvatarIdx = () => {
        if (from === 'lobby' && currentPlayer?.avatar) {
            const idx = AVATARS.indexOf(currentPlayer.avatar);
            if (idx !== -1) return idx;
        }
        // Load from localStorage if available
        const savedIdx = localStorage.getItem('player_avatar_idx');
        return savedIdx ? parseInt(savedIdx, 10) : 0;
    };

    const [name, setName] = useState(getInitialName);
    const [currentAvatarIndex, setCurrentAvatarIndex] = useState(getInitialAvatarIdx);
    const [showError, setShowError] = useState(false);

    const handleNextAvatar = () => {
        playSound('tap');
        setCurrentAvatarIndex((prev) => (prev + 1) % AVATARS.length);
    };

    const handlePrevAvatar = () => {
        playSound('tap');
        setCurrentAvatarIndex((prev) => (prev - 1 + AVATARS.length) % AVATARS.length);
    };

    const handleSubmit = async () => {
        if (!name.trim()) {
            setShowError(true);
            setTimeout(() => setShowError(false), 3000);
            return;
        }

        if (from === 'lobby' && currentPlayer?.id) {
            // Edit Mode: Update Existing Profile
            const success = await updatePlayerProfile(currentPlayer.id, name, AVATARS[currentAvatarIndex]);
            if (success) {
                // Save to localStorage so it persists for next time
                try {
                    localStorage.setItem('player_name', name.trim());
                    localStorage.setItem('player_avatar_idx', currentAvatarIndex.toString());
                } catch (e) { }

                navigate(`/lobby?mode=${mode}`, { replace: true });
            } else {
                alert('Failed to update profile. Try again.');
            }
        } else {
            // Create/Join Mode: Initial Setup
            // Save to localStorage for persistence
            try {
                localStorage.setItem('player_name', name.trim());
                localStorage.setItem('player_avatar_idx', currentAvatarIndex.toString());
            } catch (e) { }

            navigate(`/lobby?mode=${mode}`, {
                state: {
                    playerName: name.trim(),
                    playerAvatar: AVATARS[currentAvatarIndex],
                    roomCode: location.state?.roomCode
                },
                replace: true
            });
        }
    };

    return (
        <div className="app-container" style={{ padding: '1.5rem', height: '100dvh', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>

            {/* Title */}
            <h1 style={{ color: isDarkMode ? '#C4B5FD' : '#6C63FF', fontSize: '2rem', fontWeight: '900', marginBottom: '30px', textShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                {t('selectAvatar')}
            </h1>

            {/* Avatar Carousel */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '30px' }}>

                {/* Left Arrow */}
                <button onClick={handlePrevAvatar} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '2.5rem', color: '#6C63FF', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))' }}>
                    {language === 'ar' ? '▶' : '◀'}
                </button>

                <div style={{
                    width: '150px', height: '150px',
                    borderRadius: '25px',
                    backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.9)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '5rem',
                    boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
                    border: isDarkMode ? '5px solid rgba(255,255,255,0.2)' : '5px solid white',
                    backdropFilter: isDarkMode ? 'blur(5px)' : 'none'
                }}>
                    {AVATARS[currentAvatarIndex]}
                </div>

                {/* Right Arrow */}
                <button onClick={handleNextAvatar} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '2.5rem', color: '#6C63FF', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))' }}>
                    {language === 'ar' ? '◀' : '▶'}
                </button>
            </div>

            {/* Index Indicator */}
            <div style={{ color: isDarkMode ? '#9CA3AF' : '#6B7280', fontWeight: 'bold', marginBottom: '20px' }}>
                {currentAvatarIndex + 1}/{AVATARS.length}
            </div>

            {/* Name Input */}
            <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.replace(/\s/g, ''))}
                placeholder={t('yourName')}
                maxLength={12}
                style={{
                    padding: '15px 20px',
                    borderRadius: '15px',
                    border: '2px solid var(--input-border)',
                    backgroundColor: 'var(--input-bg)',
                    fontSize: '1.2rem',
                    textAlign: 'center',
                    width: '80%',
                    maxWidth: '300px',
                    marginBottom: '30px',
                    boxShadow: '0 4px 10px rgba(0,0,0,0.05)',
                    fontWeight: 'bold',
                    outline: 'none',
                    color: 'var(--input-text)'
                }}
            />

            {/* Enter/Save Button */}
            <button
                onClick={() => {
                    playSound('tap');
                    handleSubmit();
                }}
                className="action-btn"
                style={{
                    backgroundColor: '#FBBF24', // Yellow/Gold
                    color: '#78350F',
                    width: '220px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '10px'
                }}
            >
                {from === 'lobby' ? t('save') : t('enterRoom')} ✨
            </button>

            {/* Back Button */}
            {from !== 'lobby' && (
                <button
                    onClick={() => {
                        playSound('tap');
                        navigate('/');
                    }}
                    style={{
                        marginTop: '20px',
                        background: 'none',
                        border: 'none',
                        color: '#9CA3AF',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        fontSize: '1rem'
                    }}
                >
                    ← {t('back')}
                </button>
            )}

            {/* Error Popover */}
            {showError && (
                <div style={{
                    position: 'absolute',
                    bottom: '30px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    backgroundColor: '#EF4444',
                    color: 'white',
                    padding: '10px 20px',
                    borderRadius: '50px',
                    fontWeight: 'bold',
                    boxShadow: '0 4px 15px rgba(239, 68, 68, 0.4)',
                    animation: 'shake 0.5s cubic-bezier(.36,.07,.19,.97) both',
                    whiteSpace: 'nowrap',
                    zIndex: 100
                }}>
                    Please enter a name! ✍️
                </div>
            )}

            <style>{`
                @keyframes shake {
                    10%, 90% { transform: translate3d(-51%, 0, 0); }
                    20%, 80% { transform: translate3d(-49%, 0, 0); }
                    30%, 50%, 70% { transform: translate3d(-52%, 0, 0); }
                    40%, 60% { transform: translate3d(-48%, 0, 0); }
                }
            `}</style>


        </div>
    );
}

export default AvatarSelection;
