import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useRoom } from '../contexts/RoomContext'; // Import context
import { useSound } from '../contexts/SoundContext';

// Helper: Modern Custom Number Selector
const NumberSelector = ({ value, onChange, min, max, step = 1, suffix = '', isHost, isDarkMode, isRTL }) => {
    const { playSound } = useSound();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = React.useRef(null);

    // Generate options
    const options = [];
    for (let i = min; i <= max; i += step) {
        options.push(i);
    }

    // Close on outside click
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleSelect = (val) => {
        if (!isHost) return;
        onChange({ target: { value: val } });
        setIsOpen(false);
    };

    const bg = isDarkMode ? '#1F2937' : 'white';
    const borderColor = isDarkMode ? 'rgba(255,255,255,0.2)' : '#E5E7EB';
    const textColor = isDarkMode ? 'white' : '#374151';

    return (
        <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block', zIndex: isOpen ? 100 : 1 }}>
            {/* Trigger Button */}
            <div
                onClick={() => {
                    if (isHost) {
                        playSound?.('tap');
                        setIsOpen(!isOpen);
                    }
                }}
                style={{
                    backgroundColor: isDarkMode ? 'rgba(0,0,0,0.3)' : 'white',
                    border: `2px solid ${borderColor}`,
                    borderRadius: '12px',
                    padding: isRTL ? '8px 15px 8px 35px' : '8px 35px 8px 15px',
                    fontSize: '1rem',
                    fontWeight: 'bold',
                    color: textColor,
                    cursor: isHost ? 'pointer' : 'not-allowed',
                    minWidth: '80px',
                    textAlign: 'center',
                    position: 'relative',
                    userSelect: 'none'
                }}
            >
                {value} {suffix}

                {/* Arrow */}
                <div style={{
                    position: 'absolute',
                    top: '50%',
                    right: isRTL ? 'auto' : '10px',
                    left: isRTL ? '10px' : 'auto',
                    transform: `translateY(-50%) rotate(${isOpen ? '180deg' : '0deg'})`,
                    transition: 'transform 0.2s',
                    pointerEvents: 'none',
                    color: isDarkMode ? 'rgba(255,255,255,0.6)' : '#6B7280'
                }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                </div>
            </div>

            {/* Custom Dropdown List */}
            {isOpen && (
                <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: '0',
                    width: '100%',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    backgroundColor: bg,
                    border: `1px solid ${borderColor}`,
                    borderRadius: '12px',
                    marginTop: '5px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                    zIndex: 1000
                }}>
                    {options.map(opt => (
                        <div
                            key={opt}
                            onClick={() => {
                                playSound?.('tap');
                                handleSelect(opt);
                            }}
                            style={{
                                padding: '8px 12px',
                                cursor: 'pointer',
                                color: textColor,
                                fontSize: '0.9rem',
                                fontWeight: '600',
                                backgroundColor: opt === value ? (isDarkMode ? '#374151' : '#F3F4F6') : 'transparent',
                                borderBottom: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.05)' : '#F3F4F6'}`,
                                transition: 'background-color 0.1s'
                            }}
                            onMouseEnter={(e) => isHost && (e.currentTarget.style.backgroundColor = isDarkMode ? '#374151' : '#F3F4F6')}
                            onMouseLeave={(e) => isHost && (e.currentTarget.style.backgroundColor = opt === value ? (isDarkMode ? '#374151' : '#F3F4F6') : 'transparent')}
                        >
                            {opt} {suffix}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// Helper: Settings Row Component
const SettingsRow = ({ label, children, isHost, isDarkMode, isRTL }) => (
    <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 0',
        borderBottom: isDarkMode ? '1px solid rgba(255,255,255,0.05)' : '1px solid #F3F4F6',
        flexDirection: isRTL ? 'row-reverse' : 'row',
        opacity: isHost ? 1 : 0.6,
        transition: 'opacity 0.2s ease'
    }}>
        <span style={{
            fontSize: '1.1rem', // Slightly smaller
            fontWeight: '800',  // Less bold (was 900)
            color: isDarkMode ? '#E5E7EB' : '#374151', // Soften black to gray-700
            textShadow: isDarkMode ? '0 2px 4px rgba(0,0,0,0.3)' : 'none',
            fontFamily: 'inherit' // Keep app font
        }}>
            {label}
        </span>
        <div>{children}</div>
    </div>
);

function Lobby({ isDarkMode }) {
    const navigate = useNavigate();
    const { t, language } = useLanguage();
    const { isRTL, playSound } = useSound();
    const { room, players, gameState, createRoom, joinRoom, startGame, isHost, currentPlayer, leaveRoom, promotePlayerToHost, kickPlayer, updateRoomSettings, markSettingsDirty, onlinePlayerIds } = useRoom(); // Use context
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const initialMode = searchParams.get('mode') || 'join';
    const initialRoomCode = searchParams.get('code') || location.state?.roomCode;

    // Settings States
    const [selectedMode, setSelectedMode] = useState(() => room?.settings?.selectedMode || 'Classic');
    const [roundTime, setRoundTime] = useState(() => room?.settings?.roundTime ? parseInt(room.settings.roundTime) : 45);
    const [voteDuration, setVoteDuration] = useState(() => room?.settings?.voteDuration ? parseInt(room.settings.voteDuration) : 25);
    const [maxPlayers, setMaxPlayers] = useState(() => room?.settings?.maxPlayers ? parseInt(room.settings.maxPlayers) : 8);
    const [maxScore, setMaxScore] = useState(() => {
        const s = room?.settings?.scoreToWin || room?.settings?.maxScore;
        return s ? parseInt(s) : 5;
    });
    const [spectatorEnabled, setSpectatorEnabled] = useState(() => room?.settings?.spectatorEnabled ?? false);

    // UI/Interaction States
    const [isLoading, setIsLoading] = useState(true);
    const [expandedSection, setExpandedSection] = useState(null); // 'modes', 'settings', or null
    const [showCopied, setShowCopied] = useState(false);
    const [selectedPlayerId, setSelectedPlayerId] = useState(null);
    const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
    const [startError, setStartError] = useState(null);

    // Animation State for Dropdowns
    const [allowOverflow, setAllowOverflow] = useState(false);
    const overflowTimer = React.useRef(null);


    const getPersistentName = () => {
        if (location.state?.playerName) return location.state.playerName;
        return localStorage.getItem('player_name') || 'You';
    };

    const getPersistentAvatar = () => {
        if (location.state?.playerAvatar) return location.state.playerAvatar;
        // Fallback to localStorage idx
        const savedIdx = localStorage.getItem('player_avatar_idx');
        const AVATARS = ['😎', '🦊', '🐱', '🐼', '🐸', '🦁', '🦄', '👻', '👾', '🤖', '🎃', '👽'];
        return savedIdx ? AVATARS[parseInt(savedIdx, 10)] : '😎';
    };

    const initialName = getPersistentName();
    const initialAvatar = getPersistentAvatar();

    // Sound: Join notification
    const prevPlayersCount = React.useRef(players.length);
    useEffect(() => {
        if (players.length > prevPlayersCount.current) {
            playSound('beep');
        }
        prevPlayersCount.current = players.length;
    }, [players.length, playSound]);

    // Sound: Game Start for non-hosts (Ding)
    // Host triggers ding in handleStart, but spectators/players need to hear it too
    const hasPlayedDing = useRef(false);
    useEffect(() => {
        if (gameState?.phase === 'text' && !hasPlayedDing.current) {
            playSound('ding');
            hasPlayedDing.current = true;
        }
    }, [gameState?.phase, playSound]);

    // Initialize Room
    useEffect(() => {
        const init = async () => {
            // Priority: If room already exists in context (e.g. from global auto-reconnect), do nothing
            if (room?.id) return;

            const urlCode = searchParams.get('code');
            const targetCode = urlCode || initialRoomCode;

            if (targetCode) {
                // RoomContext.joinRoom handles deduplication, so it's safe to call here
                // even if autoReconnect is also trying to join.
                await joinRoom(targetCode, initialName, initialAvatar);
            } else if (initialMode === 'create') {
                await createRoom(initialName, initialAvatar);
            }
        };
        init();
    }, [room?.id]); // Watch room specifically to avoid re-triggering if room is already set

    const { error: roomError } = useRoom();

    // Ensure we are truly in a room (Ghost Mode Protection)
    useEffect(() => {
        const checkGhost = setTimeout(() => {
            if (!room?.id) {
                setIsLoading(false);
                navigate('/', { replace: true });
            } else {
                setIsLoading(false);
            }
        }, 15000); // 15 seconds grace for slow mobile networks / Deno cold starts
        return () => clearTimeout(checkGhost);
    }, [room?.id, navigate]);

    // If room connects, stop loading immediately
    useEffect(() => {
        if (room?.id && currentPlayer?.id && players.length > 0) setIsLoading(false);
    }, [room?.id, currentPlayer?.id, players.length]);



    // --- SETTINGS SYNC ---
    // 1. Host -> DB: Sync local state changes to Supabase
    useEffect(() => {
        if (isHost && room?.id) {
            const timer = setTimeout(() => {
                updateRoomSettings({
                    selectedMode,
                    roundTime,
                    voteDuration,
                    maxPlayers,
                    scoreToWin: maxScore,
                    spectatorEnabled
                });
            }, 500); // Debounce updates
            return () => clearTimeout(timer);
        }
    }, [selectedMode, roundTime, voteDuration, maxPlayers, maxScore, spectatorEnabled, isHost, room?.id]);

    // 2. DB -> Clients: Sync local state from Supabase room object
    useEffect(() => {
        if (room?.settings) {
            // SECURITY: If I'm the host, only sync-down if I haven't touched settings recently
            // This prevents the "snap-back" effect when a Realtime update arrives during local editing.
            const s = room.settings;

            // Simple heuristic for recent local update in Lobby:
            // We use a local ref or just check the context's dirty status if exposed, 
            // but since room?.settings change triggers this, we check if we are host first.
            if (isHost) {
                // If we are host, we only accept server settings if we haven't updated in 2s
                // This is a safety net for split-brain or multi-host scenarios
                // However, usually we want to PRIORITIZE local state until the 500ms debounce hits.
                return;
            }

            if (s.selectedMode && s.selectedMode !== selectedMode) setSelectedMode(s.selectedMode);
            if (s.roundTime && s.roundTime !== roundTime) setRoundTime(parseInt(s.roundTime));
            if (s.voteDuration && s.voteDuration !== voteDuration) setVoteDuration(parseInt(s.voteDuration));
            if (s.maxPlayers && s.maxPlayers !== maxPlayers) setMaxPlayers(parseInt(s.maxPlayers));
            const syncedScore = s.scoreToWin || s.maxScore;
            if (syncedScore && parseInt(syncedScore) !== maxScore) setMaxScore(parseInt(syncedScore));
            if (s.spectatorEnabled !== undefined && s.spectatorEnabled !== spectatorEnabled) setSpectatorEnabled(s.spectatorEnabled);
        }
    }, [room?.settings, isHost]); // Added isHost to deps

    // Sync URL with room code
    useEffect(() => {
        if (room?.room_code && searchParams.get('code') !== room.room_code) {
            const newParams = new URLSearchParams(window.location.search);
            newParams.set('code', room.room_code);
            // Replace entry in history without re-triggering navigation if possible
            window.history.replaceState(null, '', `${window.location.pathname}?${newParams.toString()}`);
        }
    }, [room?.room_code]);




    const copyToClipboard = async () => {
        if (!room?.room_code) return;
        playSound('tap');

        try {
            // Try modern API first
            await navigator.clipboard.writeText(room.room_code);
            setShowCopied(true);
        } catch (err) {
            // Fallback for non-secure contexts (e.g., HTTP on LAN)
            try {
                const textArea = document.createElement("textarea");
                textArea.value = room.room_code;

                // Avoid scrolling to bottom
                textArea.style.top = "0";
                textArea.style.left = "0";
                textArea.style.position = "fixed";
                textArea.style.opacity = "0";

                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();

                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);

                if (successful) {
                    setShowCopied(true);
                } else {
                    // Final fallback: just show alert or failing gracefully
                    console.error('Fallback copy failed.');
                }
            } catch (fallbackErr) {
                console.error('Copy failed:', fallbackErr);
            }
        }

        if (showCopied) {
            setTimeout(() => setShowCopied(false), 2000);
        } else {
            // Ensure timeout runs if we set true
            setTimeout(() => setShowCopied(false), 2000);
        }
    };

    const toggleSection = (section) => {
        playSound('tap');
        // Clear existing timer
        if (overflowTimer.current) clearTimeout(overflowTimer.current);

        const isOpening = expandedSection !== section;
        setExpandedSection(isOpening ? section : null);

        // Always reset overflow immediately so animation works (hidden)
        setAllowOverflow(false);

        // If opening 'settings', wait for animation then allow overflow
        if (isOpening && section === 'settings') {
            overflowTimer.current = setTimeout(() => {
                setAllowOverflow(true);
            }, 800); // Must match CSS transition time
        }
    };

    // --- STYLES ---
    const primaryColor = '#6C63FF';
    const cardBg = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'white';
    const textColor = isDarkMode ? '#F9FAFB' : '#374151';
    const subTextColor = isDarkMode ? '#9CA3AF' : '#6B7280';
    const inputBg = isDarkMode ? 'rgba(31, 41, 55, 0.8)' : 'rgba(255, 255, 255, 0.9)';

    if (isLoading || !room?.id || !currentPlayer?.id) {
        return (
            <div className="app-container" style={{
                display: 'flex', justifyContent: 'center', alignItems: 'center',
                height: '100vh', color: primaryColor, backgroundColor: isDarkMode ? '#111827' : '#F9FAFB'
            }}>
                <div style={{ fontSize: '1.5rem', fontWeight: '900', animation: 'pulse 1.5s infinite' }}>
                    CONNECTING... 🚀
                </div>
            </div>
        );
    }


    const containerStyle = {
        width: '100%',
        maxWidth: '420px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        paddingBottom: '150px',
        minHeight: '100%'
    };

    const sectionBarStyle = {
        backgroundColor: primaryColor,
        color: 'white',
        borderRadius: '20px',
        padding: '15px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        cursor: 'pointer',
        fontWeight: '800',
        fontSize: '1.2rem',
        textTransform: 'uppercase',
        letterSpacing: '1px',
        boxShadow: '0 4px 10px rgba(108, 99, 255, 0.3)',
        transition: 'all 0.2s ease'
    };

    const arrowStyle = (isOpen) => ({
        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)', // Slower and smoother
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center'
    });

    const getExpandedStyle = (isOpen, allowOverflow = false) => ({
        padding: isOpen ? '25px 20px 20px 20px' : '0 20px',
        backgroundColor: inputBg,
        borderRadius: '0 0 20px 20px',
        marginTop: '-15px',
        boxShadow: isOpen ? '0 4px 6px rgba(0,0,0,0.05)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: '15px',
        maxHeight: isOpen ? '500px' : '0',
        opacity: isOpen ? '1' : '0',
        overflow: isOpen && allowOverflow ? 'visible' : 'hidden', // Switch to visible after animation
        transition: 'all 0.8s cubic-bezier(0.4, 0, 0.2, 1)', // Reduced speed (Slower)
        pointerEvents: isOpen ? 'auto' : 'none',
        transformOrigin: 'top center',
        backdropFilter: 'blur(5px)'
    });

    return (
        <div className="app-container no-scrollbar"
            onClick={() => setSelectedPlayerId(null)}
            style={{ padding: '1.5rem', height: '100dvh', overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}>
            <style>{`
                .no-scrollbar::-webkit-scrollbar { display: none; }
                .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
            `}</style>

            <main style={{ width: '100%', minHeight: '100%' }}>

                <div style={containerStyle}>

                    {/* SECTION 1: ROOM CODE */}
                    <div onClick={copyToClipboard} style={{
                        backgroundColor: cardBg,
                        borderRadius: '25px',
                        padding: '20px',
                        textAlign: 'center',
                        boxShadow: '0 8px 20px rgba(0,0,0,0.05)',
                        border: isDarkMode ? '1px solid rgba(255,255,255,0.1)' : 'none',
                        backdropFilter: isDarkMode ? 'blur(5px)' : 'none',
                        position: 'relative',
                        cursor: 'pointer',
                        transition: 'transform 0.1s ease',
                    }}
                        onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.98)'}
                        onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                    >
                        <div style={{ color: '#9CA3AF', fontSize: '0.8rem', fontWeight: 'bold', letterSpacing: '2px', marginBottom: '5px' }}>{t('roomCode')}</div>
                        <div style={{ color: primaryColor, fontSize: '3rem', fontWeight: '900', letterSpacing: '6px', lineHeight: 1 }}>
                            {room?.room_code || '...'}
                        </div>
                        {showCopied && (
                            <div style={{
                                position: 'absolute',
                                top: '10px', right: '10px',
                                backgroundColor: '#10B981', color: 'white',
                                padding: '4px 12px', borderRadius: '12px',
                                fontSize: '0.8rem', fontWeight: 'bold', pointerEvents: 'none',
                                boxShadow: '0 2px 5px rgba(0,0,0,0.1)', animation: 'fadeIn 0.2s ease'
                            }}>{t('copied')}</div>
                        )}
                    </div>

                    <div style={{ width: '100%', position: 'relative', padding: '10px' }}>
                        <div style={{ color: primaryColor, fontWeight: '800', marginBottom: '5px', fontSize: '1.1rem', textAlign: 'left' }}>
                            {t('players')} ({players.filter(p => onlinePlayerIds.has(p.id) || p.id === currentPlayer?.id).length || 1}/{maxPlayers})
                        </div>

                        {/* Normal Rectangle Background */}
                        <div style={{
                            backgroundColor: inputBg,
                            borderRadius: '25px', // Match the rest of the UI cards
                            padding: '25px 15px',
                            minHeight: '120px',
                            boxShadow: '0 8px 20px rgba(0,0,0,0.05)', // Match current UI style
                            backdropFilter: 'blur(5px)'
                        }}>
                            {/* Grid Layout: Max 4 per line */}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(4, 1fr)', // Exactly 4 columns
                                gap: '15px',
                                justifyItems: 'center'
                            }}>
                                <style>{`
                                    @keyframes slideIn {
                                        from { opacity: 0; transform: translateY(-20px) scale(0.95); }
                                        to { opacity: 1; transform: translateY(0) scale(1); }
                                    }
                                `}</style>
                                {players.map(player => {
                                    const isMe = currentPlayer?.id === player.id;
                                    const isOnline = onlinePlayerIds.has(player.id) || isMe;
                                    return (
                                        <div key={player.id}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (isMe) return; // Disable menu for self
                                                if (!isHost) return; // Disable menu for non-hosts

                                                const rect = e.currentTarget.getBoundingClientRect();
                                                playSound('tap');
                                                // Position menu centered below the player, accounting for scroll
                                                setMenuPosition({
                                                    top: rect.bottom + 10,
                                                    left: rect.left + (rect.width / 2)
                                                });
                                                setSelectedPlayerId(selectedPlayerId === player.id ? null : player.id);
                                            }}
                                            style={{
                                                display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%',
                                                position: 'relative', cursor: isMe ? 'default' : 'pointer',
                                                opacity: isOnline ? 1 : 0.4,
                                                filter: isOnline ? 'none' : 'grayscale(0.5)',
                                                transition: 'opacity 0.3s, filter 0.3s'
                                            }}>
                                            <div style={{
                                                fontSize: '2.5rem',
                                                backgroundColor: isMe ? '#EEF2FF' : 'rgba(255,255,255,0.5)',
                                                borderRadius: '50%',
                                                width: '60px', height: '60px',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                border: isMe ? `2px solid ${primaryColor}` : '2px solid transparent',
                                                boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                                                position: 'relative',
                                                cursor: 'pointer'
                                            }}>
                                                {player.avatar?.split('|')[0]}
                                                {player.is_host && <span style={{ position: 'absolute', bottom: -2, right: -2, fontSize: '1rem' }}>👑</span>}

                                                {/* Edit Avatar Icon (Only for You) */}
                                                {isMe && (
                                                    <div
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            playSound('tap');
                                                            navigate(`/avatar-selection?mode=${initialMode}&from=lobby`);
                                                        }}
                                                        style={{
                                                            position: 'absolute',
                                                            top: -5,
                                                            right: -5,
                                                            backgroundColor: 'white',
                                                            borderRadius: '50%',
                                                            width: '24px',
                                                            height: '24px',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                                                            fontSize: '0.8rem',
                                                            border: `2px solid ${primaryColor}`,
                                                            zIndex: 5
                                                        }}
                                                    >
                                                        ✏️
                                                    </div>
                                                )}
                                            </div>
                                            <div style={{ marginTop: '5px', fontWeight: '700', fontSize: '0.8rem', color: textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                                                {player.name}
                                            </div>
                                        </div>
                                    );
                                })}
                                <style>{`
                                    @keyframes popIn {
                                        from { opacity: 0; transform: translateX(-50%) scale(0.8); }
                                        to { opacity: 1; transform: translateX(-50%) scale(1); }
                                    }
                                `}</style>
                            </div>
                        </div>
                    </div>

                    {/* SECTION 3: GAME MODES (Accordion) */}
                    <div>
                        <div style={sectionBarStyle} onClick={() => toggleSection('modes')}>
                            <span>{t('mode')}: {selectedMode === 'Classic' ? t('classic') : selectedMode === 'Emoji Only' ? t('emojiOnly') : t('noFaces')} {selectedMode === 'Classic' ? '🎲' : selectedMode === 'Emoji Only' ? '😜' : '😶'} {!isHost && '🔒'}</span>
                            <span style={arrowStyle(expandedSection === 'modes')}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                            </span>
                        </div>
                        <div style={getExpandedStyle(expandedSection === 'modes')}>
                            {['Classic', 'Emoji Only', 'No Faces'].map(mode => (
                                <div key={mode}
                                    onClick={() => {
                                        if (isHost) {
                                            playSound('tap');
                                            markSettingsDirty(); // Block echoes immediately
                                            setSelectedMode(mode);
                                        }
                                    }}
                                    style={{
                                        padding: '12px',
                                        borderRadius: '12px',
                                        backgroundColor: selectedMode === mode ? 'var(--input-bg)' : 'transparent',
                                        color: selectedMode === mode ? primaryColor : (isHost ? textColor : '#9CA3AF'),
                                        fontWeight: '700',
                                        border: selectedMode === mode ? `2px solid ${primaryColor}` : '2px solid var(--input-border)',
                                        cursor: isHost ? 'pointer' : 'not-allowed',
                                        display: 'flex', justifyContent: 'space-between',
                                        opacity: isHost ? 1 : 0.6
                                    }}
                                >
                                    {mode === 'Classic' ? t('classic') : mode === 'Emoji Only' ? t('emojiOnly') : t('noFaces')} {mode === 'Classic' ? '🎲' : mode === 'Emoji Only' ? '😜' : '😶'}
                                    {selectedMode === mode && <span>✓</span>}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* SECTION 4: GAME SETTINGS (Accordion) */}
                    <div style={{ position: 'relative', zIndex: 20 }}>
                        <div style={sectionBarStyle} onClick={() => toggleSection('settings')}>
                            <span>{t('gameSettings')} 🔧 {!isHost && '🔒'}</span>
                            <span style={arrowStyle(expandedSection === 'settings')}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                            </span>
                        </div>
                        <div style={getExpandedStyle(expandedSection === 'settings', allowOverflow)}>
                            <div style={{ padding: '5px 0' }}>

                                {/* Round Duration */}
                                <SettingsRow label={`${t('roundDuration')} ⏱️`} isHost={isHost} isDarkMode={isDarkMode} isRTL={isRTL}>
                                    <NumberSelector
                                        value={roundTime}
                                        onChange={(e) => {
                                            markSettingsDirty();
                                            setRoundTime(e.target.value);
                                        }}
                                        min={30} max={90} step={5}
                                        suffix="s"
                                        isHost={isHost} isDarkMode={isDarkMode} isRTL={isRTL}
                                    />
                                </SettingsRow>

                                {/* Vote Duration */}
                                <SettingsRow label={`${t('voteDuration')} 🗳️`} isHost={isHost} isDarkMode={isDarkMode} isRTL={isRTL}>
                                    <NumberSelector
                                        value={voteDuration}
                                        onChange={(e) => {
                                            markSettingsDirty();
                                            setVoteDuration(e.target.value);
                                        }}
                                        min={15} max={40} step={5}
                                        suffix="s"
                                        isHost={isHost} isDarkMode={isDarkMode} isRTL={isRTL}
                                    />
                                </SettingsRow>

                                {/* Max Players */}
                                <SettingsRow label={`${t('maxPlayers')} 👥`} isHost={isHost} isDarkMode={isDarkMode} isRTL={isRTL}>
                                    <NumberSelector
                                        value={maxPlayers}
                                        onChange={(e) => {
                                            markSettingsDirty();
                                            const newVal = parseInt(e.target.value);
                                            if (newVal >= players.length) setMaxPlayers(newVal);
                                        }}
                                        min={Math.max(3, players.length)} max={15} step={1}
                                        isHost={isHost} isDarkMode={isDarkMode} isRTL={isRTL}
                                    />
                                </SettingsRow>

                                {/* Score to Win */}
                                <SettingsRow label={`${t('scoreToWin')} 🏆`} isHost={isHost} isDarkMode={isDarkMode} isRTL={isRTL}>
                                    <NumberSelector
                                        value={maxScore}
                                        onChange={(e) => {
                                            markSettingsDirty();
                                            setMaxScore(e.target.value);
                                        }}
                                        min={5} max={30} step={5}
                                        isHost={isHost} isDarkMode={isDarkMode} isRTL={isRTL}
                                    />
                                </SettingsRow>

                                {/* Spectator Mode Toggle (Blue Switch) */}
                                <SettingsRow label={`${t('spectatorMode')} 👁️`} isHost={isHost} isDarkMode={isDarkMode} isRTL={isRTL}>
                                    <div
                                        onClick={() => {
                                            if (isHost) {
                                                playSound('tap');
                                                markSettingsDirty();
                                                setSpectatorEnabled(!spectatorEnabled);
                                            }
                                        }}
                                        style={{
                                            width: '50px',
                                            height: '28px',
                                            backgroundColor: spectatorEnabled ? '#3B82F6' : (isDarkMode ? '#4B5563' : '#D1D5DB'), // Blue when active
                                            borderRadius: '30px',
                                            position: 'relative',
                                            cursor: isHost ? 'pointer' : 'not-allowed',
                                            transition: 'background-color 0.2s ease',
                                            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)'
                                        }}
                                    >
                                        <div style={{
                                            width: '24px',
                                            height: '24px',
                                            backgroundColor: 'white',
                                            borderRadius: '50%',
                                            position: 'absolute',
                                            top: '2px',
                                            left: spectatorEnabled ? '24px' : '2px',
                                            transition: 'left 0.2s cubic-bezier(0.4, 0.0, 0.2, 1)',
                                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                                        }} />
                                    </div>
                                </SettingsRow>

                            </div>
                        </div>
                    </div>

                    {/* SECTION 5: START BUTTON */}
                    <div style={{ marginTop: 'auto', paddingTop: '20px' }}>
                        <style>
                            {`
                                .start-game-btn {
                                    transition: transform 0.1s cubic-bezier(0.4, 0, 0.2, 1);
                                }
                                .start-game-btn:active {
                                    transform: scale(0.95);
                                }
                            `}
                        </style>
                        {isHost ? (
                            <>
                                <button
                                    className="start-game-btn"
                                    onClick={() => {
                                        playSound('tap');
                                        const onlinePlayersCount = players.filter(p => onlinePlayerIds.has(p.id)).length;

                                        if (onlinePlayersCount < 3) {
                                            setStartError(t('minPlayersError'));
                                            setTimeout(() => setStartError(null), 3000);
                                            return;
                                        }

                                        if (spectatorEnabled && onlinePlayersCount < 4) {
                                            setStartError(t('spectatorMinError'));
                                            setTimeout(() => setStartError(null), 3000);
                                            return;
                                        }

                                        const settings = {
                                            roundTime,
                                            voteDuration,
                                            maxPlayers,
                                            scoreToWin: maxScore,
                                            selectedMode,
                                            spectatorEnabled
                                        };
                                        // Local storage for persistence backup (optional)
                                        try {
                                            localStorage.setItem('gameSettings', JSON.stringify(settings));
                                        } catch (e) { }

                                        // Start Game via Context
                                        startGame(settings);
                                    }}
                                    style={{
                                        width: '100%',
                                        background: 'linear-gradient(135deg, #6C63FF 0%, #4C1D95 100%)',
                                        color: 'white',
                                        fontSize: '1.5rem',
                                        fontWeight: '900',
                                        padding: '20px',
                                        border: 'none',
                                        outline: 'none',
                                        cursor: 'pointer',
                                        clipPath: 'polygon(5% 0%, 100% 0%, 95% 100%, 0% 100%)',
                                        textTransform: 'uppercase',
                                        letterSpacing: '2px',
                                        filter: 'drop-shadow(0 10px 20px rgba(108, 99, 255, 0.4)) drop-shadow(6px 6px 0px rgba(0,0,0,0.2))', // Combined glow + 3D
                                        textShadow: '2px 2px 0 rgba(0,0,0,0.2)'
                                    }}
                                >
                                    {t('startGame')} 🚀
                                </button>
                                {startError && (
                                    <div style={{
                                        position: 'fixed',
                                        bottom: '100px',
                                        left: '50%',
                                        transform: 'translateX(-50%)',
                                        backgroundColor: '#EF4444',
                                        color: 'white',
                                        padding: '12px 24px',
                                        borderRadius: '12px',
                                        fontWeight: 'bold',
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                                        zIndex: 2000,
                                        animation: 'popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                                        whiteSpace: 'nowrap'
                                    }}>
                                        {startError}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div style={{
                                textAlign: 'center', padding: '15px',
                                background: cardBg,
                                border: isDarkMode ? '1px solid rgba(255,255,255,0.1)' : 'none',
                                borderRadius: '15px', color: textColor, fontWeight: '600'
                            }}>
                                {t('waitingForHost')}
                            </div>
                        )}
                    </div>

                    <button onClick={() => { playSound('tap'); leaveRoom(true); }} style={{ marginTop: '1rem', width: '100%', color: '#EF4444', fontWeight: '700', fontSize: '1rem', background: 'none', border: 'none', cursor: 'pointer' }}>
                        {t('leaveRoom')}
                    </button>
                </div>
            </main>



            {/* Fixed Player Menu Overlay (outside clipped containers) */}
            {selectedPlayerId && (
                <div style={{
                    position: 'fixed',
                    top: menuPosition.top,
                    left: menuPosition.left,
                    transform: 'translateX(-50%)',
                    backgroundColor: isDarkMode ? '#1F2937' : 'white',
                    padding: '8px',
                    borderRadius: '12px',
                    boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
                    zIndex: 9999, // Super high z-index
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '5px',
                    minWidth: '110px',
                    animation: 'popIn 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                }} onClick={(e) => e.stopPropagation()}>
                    <button
                        onClick={() => { playSound('tap'); promotePlayerToHost(selectedPlayerId); setSelectedPlayerId(null); }}
                        style={{
                            border: 'none', background: '#FCD34D', color: '#78350F',
                            padding: '8px', borderRadius: '8px', fontWeight: '700', fontSize: '0.85rem', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        }}
                    >
                        👑 {t('promoteHost')}
                    </button>
                    <button
                        onClick={() => { playSound('tap'); kickPlayer(selectedPlayerId); setSelectedPlayerId(null); }}
                        style={{
                            border: 'none', background: '#EF4444', color: 'white',
                            padding: '8px', borderRadius: '8px', fontWeight: '700', fontSize: '0.85rem', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        }}
                    >
                        🚫 {t('kick')}
                    </button>
                </div>
            )}

            <div className="floating-emoji emoji-cloud">☁️</div>
        </div>
    );
}

export default Lobby;
