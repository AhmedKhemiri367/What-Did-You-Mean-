import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useRoom } from '../contexts/RoomContext';
import { useSound } from '../contexts/SoundContext';

function JoinRoom({ isDarkMode }) {
    const navigate = useNavigate();
    const { t } = useLanguage();
    const { checkRoomExists, leaveRoom } = useRoom();
    const { playSound } = useSound();

    // Clear any previous room state when entering this page
    useEffect(() => {
        leaveRoom();
    }, []);
    const [roomCode, setRoomCode] = useState('');
    const [error, setError] = useState('');

    const handleJoin = async (e) => {
        e.preventDefault();
        playSound('tap');

        if (roomCode.length !== 4) {
            setError('Code must be 4 letters!');
            setTimeout(() => setError(''), 3000);
            return;
        }

        try {
            const cleanCode = roomCode.trim().toUpperCase();

            // Validate Room with a pseudo-timeout for UI feedback
            const roomPromise = checkRoomExists(cleanCode);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 10000)
            );

            const room = await Promise.race([roomPromise, timeoutPromise]);

            if (!room) {
                setError(t('roomNotFound') || 'Room not found! 🚫');
                if (navigator.vibrate) navigator.vibrate(200);
                setTimeout(() => setError(''), 3000);
                return;
            }

            // Check if kicked
            const myFingerprint = localStorage.getItem('player_fingerprint');
            const myName = localStorage.getItem('player_name');

            const isKickedFingerprint = room.settings?.kicked_fingerprints?.includes(myFingerprint);
            const isKickedName = room.settings?.kicked_names?.includes(myName);

            if (isKickedFingerprint || isKickedName) {
                // If kicked, bounce back to home with error
                navigate('/', { state: { error: 'kickedError' } });
                return;
            }

            // Check if room is full
            const storedPlayerId = sessionStorage.getItem(`room_session_${cleanCode}`);
            const maxP = room.settings?.maxPlayers || 8;

            if (room.playerCount >= maxP && !storedPlayerId) {
                setError(t('roomFull') || 'Room is full! 🚫');
                if (navigator.vibrate) navigator.vibrate(200);
                setTimeout(() => setError(''), 3000);
                return;
            }

            // Valid Room -> Proceed
            sessionStorage.removeItem(`explicit_leave_${cleanCode}`);

            navigate(`/avatar-selection?mode=join`, {
                state: { roomCode: cleanCode },
                replace: true
            });
        } catch (err) {
            console.error("Join Room Error:", err);
            const msg = err.message === 'timeout' ? 'Connection slow... try again! ⏳' : 'Connection failed 🚫';
            setError(msg);
            setTimeout(() => setError(''), 4000);
        }
    };

    return (
        <div className="app-container" style={{ padding: '1.5rem', height: '100dvh', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>

            <style>{`
                @keyframes shake {
                    0% { transform: translateX(0); }
                    25% { transform: translateX(-10px); }
                    50% { transform: translateX(10px); }
                    75% { transform: translateX(-10px); }
                    100% { transform: translateX(0); }
                }
                @keyframes popUp {
                    0% { transform: translateY(20px) scale(0.9); opacity: 0; }
                    100% { transform: translateY(0) scale(1); opacity: 1; }
                }
            `}</style>

            <h1 style={{ color: '#6C63FF', fontSize: '2.5rem', fontWeight: '900', marginBottom: '40px', textAlign: 'center' }}>
                {t('joinRoomTitle')}
            </h1>

            <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: '350px' }}>
                <input
                    type="text"
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                    placeholder={t('roomCodePlaceholder')}
                    maxLength={4}
                    style={{
                        width: '100%',
                        padding: '20px',
                        borderRadius: '20px',
                        border: error ? '4px solid #EF4444' : '4px solid var(--input-border)',
                        backgroundColor: 'var(--input-bg)',
                        fontSize: '3rem',
                        textAlign: 'center',
                        textTransform: 'uppercase',
                        letterSpacing: '10px',
                        fontWeight: '900',
                        color: 'var(--input-text)',
                        outline: 'none',
                        marginBottom: '40px',
                        boxShadow: '0 4px 10px rgba(0,0,0,0.05)',
                        animation: error ? 'shake 0.4s ease-in-out' : 'none',
                        transition: 'border-color 0.2s'
                    }}
                />

                <button
                    type="submit"
                    className="action-btn"
                    style={{
                        backgroundColor: '#6C63FF',
                        color: 'white',
                        width: '100%',
                        fontSize: '1.5rem'
                    }}
                >
                    {t('joinGame')} ➜
                </button>
            </form>

            <button onClick={() => { playSound('tap'); navigate('/'); }} style={{ marginTop: '30px', background: 'none', border: 'none', color: isDarkMode ? '#9CA3AF' : '#6B7280', fontWeight: 'bold', cursor: 'pointer' }}>
                ❌ {t('done')}
            </button>

            {/* Error Popover */}
            {error && (
                <div style={{
                    position: 'absolute',
                    bottom: '20px', // Moved to very bottom
                    backgroundColor: '#EF4444',
                    color: 'white',
                    padding: '16px 32px',
                    borderRadius: '50px',
                    fontWeight: '800',
                    fontSize: '1.1rem',
                    boxShadow: '0 10px 25px rgba(239, 68, 68, 0.4)',
                    animation: 'popUp 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                    display: 'flex', alignItems: 'center', gap: '8px',
                    zIndex: 1000
                }}>
                    ⚠️ {error}
                </div>
            )}


        </div>
    );
}

export default JoinRoom;
