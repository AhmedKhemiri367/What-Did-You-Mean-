import React, { createContext, useState, useEffect, useContext, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from './LanguageContext';

import { useRoomSync } from './room/useRoomSync';
import { useGamePhase } from './room/useGamePhase';
import { useRoomActions } from './room/useRoomActions';
import { getPhasePriority } from './room/roomUtils';

const RoomContext = createContext();

export function RoomProvider({ children }) {
    const { t } = useLanguage();
    const [room, setRoom] = useState(null);
    const [players, setPlayers] = useState([]);
    const [gameState, setGameState] = useState(null);
    const [currentPlayer, setCurrentPlayer] = useState(null);
    const [notifications, setNotifications] = useState([]);
    const [isRestoringSession, setIsRestoringSession] = useState(true);

    const location = useLocation();
    const navigate = useNavigate();

    // Refs for safe access in intervals/callbacks
    const roomRef = useRef(room);
    const playersRef = useRef(players);
    const gameStateRef = useRef(gameState);
    const currentPlayerRef = useRef(currentPlayer);
    const onlinePlayerIdsRef = useRef(new Set());

    useEffect(() => { roomRef.current = room; }, [room]);
    useEffect(() => { playersRef.current = players; }, [players]);
    useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
    useEffect(() => { currentPlayerRef.current = currentPlayer; }, [currentPlayer]);

    const isExitingRef = useRef(false);
    const lastNavigatedPhaseRef = useRef(null);
    const lastInGamePathRef = useRef(null);
    const lastHighPhaseRef = useRef(-1);
    const hostCheckBuffer = useRef(null);
    const isJoiningRef = useRef(false);
    const phaseTransitionLock = useRef(false);
    const isAdvancingRef = useRef(false);

    // NOTIFICATIONS
    const addNotification = useCallback((message, type = 'info') => {
        if (!roomRef.current?.id || roomRef.current?.status === 'lobby') return;
        setNotifications(prev => {
            const isDuplicate = prev.some(n => n.message === message && (Date.now() - n.id < 3000));
            if (isDuplicate) return prev;
            return [...prev, { id: Date.now(), message, type }];
        });
    }, []);

    const removeNotification = useCallback((id) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    }, []);

    // 1. SYNC HOOK
    const {
        onlinePlayerIds,
        awayPlayerIds,
        error,
        setError,
        fetchPlayers,
        refreshRoomState,
        clearError,
        markSettingsDirty,
        markPhaseDirty,
        markAnswerDirty
    } = useRoomSync(
        room, currentPlayerRef, playersRef, roomRef, onlinePlayerIdsRef, gameStateRef,
        setRoom, setPlayers, setCurrentPlayer, setGameState, isExitingRef, addNotification
    );

    useEffect(() => { onlinePlayerIdsRef.current = onlinePlayerIds; }, [onlinePlayerIds]);

    // 2. ACTIONS HOOK
    const {
        checkRoomExists,
        updatePlayerProfile,
        joinRoom,
        createRoom,
        startGame,
        submitAnswer,
        saveDraft,
        updateRoomSettings,
        promotePlayerToHost,
        kickPlayer
    } = useRoomActions({
        roomRef, currentPlayerRef, playersRef,
        setRoom, setPlayers, setCurrentPlayer, setGameState,
        setError, isExitingRef, markPhaseDirty, markAnswerDirty, markSettingsDirty,
        isJoiningRef, onlinePlayerIdsRef
    });

    // 3. GAME PHASE HOOK
    const { advancePhase } = useGamePhase({
        roomRef, gameStateRef, playersRef, currentPlayerRef, onlinePlayerIdsRef,
        setGameState, setRoom, setPlayers, setCurrentPlayer, markPhaseDirty,
        phaseTransitionLock, isAdvancingRef
    });

    // --- REMAINING UI/NAVIGATION EFFECTS ---

    // Leave Room (UI/Navigation bound)
    const leaveRoom = useCallback(async (explicit = false) => {
        console.log("RoomContext: leaveRoom triggered, explicit:", explicit);
        if (explicit) {
            isExitingRef.current = true;
            navigate('/', { replace: true });
        } else {
            // Passively strip code from URL without triggering a React Router bounce
            if (window.location.search.includes('code=')) {
                const url = new URL(window.location);
                url.searchParams.delete('code');
                window.history.replaceState({}, '', url);
            }
        }

        const currentRoomCode = room?.room_code || roomRef.current?.room_code;
        const currentRoomId = room?.id || roomRef.current?.id;
        const currentId = currentPlayer?.id || currentPlayerRef.current?.id;

        lastInGamePathRef.current = null;

        try {
            if (currentId) {
                const currentPhase = gameState?.phase || gameStateRef.current?.phase;
                const isEndPhase = ['winner', 'scoreboard'].includes(currentPhase);
                const isPlaying = room?.status === 'playing' || roomRef.current?.status === 'playing';
                const isMidGame = isPlaying && !isEndPhase;

                if (!isMidGame) {
                    await supabase.from('players').delete().eq('id', currentId);
                }
            }

            if (currentRoomId) {
                const { count, error: err } = await supabase
                    .from('players')
                    .select('*', { count: 'exact', head: true })
                    .eq('room_id', currentRoomId);

                if (!err && count === 0) {
                    await supabase.from('rooms').delete().eq('id', currentRoomId);
                    await supabase.from('game_state').delete().eq('room_id', currentRoomId);
                }
            }
        } catch (err) {
            console.error('Error leaving room (DB):', err);
        }

        setRoom(null);
        setPlayers([]);
        setGameState(null);
        setCurrentPlayer(null);
        setError(null);

        if (currentRoomCode) {
            sessionStorage.removeItem(`room_session_${currentRoomCode}`);
            if (explicit) sessionStorage.setItem(`explicit_leave_${currentRoomCode}`, 'true');
        }

        Object.keys(sessionStorage).forEach(key => {
            if (key.startsWith('room_session_')) {
                sessionStorage.removeItem(key);
            }
        });
    }, [navigate, room, currentPlayer, gameState, setError]);

    // Global Auto-Reconnect on Load
    useEffect(() => {
        const initSession = async () => {
            if (isExitingRef.current || roomRef.current?.id || isJoiningRef.current) return;

            let myAvatar = currentPlayerRef.current?.avatar?.split(' | ')[0];
            if (!myAvatar) {
                const savedIdx = localStorage.getItem('player_avatar_idx');
                const AVATARS = ['😎', '🦊', '🐱', '🐼', '🐸', '🦁', '🦄', '👻', '👾', '🤖', '🎃', '👽'];
                myAvatar = savedIdx ? AVATARS[parseInt(savedIdx, 10)] : '😎';
            }

            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (key?.startsWith('room_session_')) {
                    try {
                        const sessionData = JSON.parse(sessionStorage.getItem(key));
                        if (sessionData && sessionData.roomCode) {
                            console.log("RoomContext: Auto-reconnecting to", sessionData.roomCode);
                            await joinRoom(
                                sessionData.roomCode,
                                currentPlayerRef.current?.name || localStorage.getItem('player_name') || 'Player',
                                myAvatar,
                                sessionData.fingerprint || localStorage.getItem('player_fingerprint'),
                                true // isAutoReconnect
                            );
                            break;
                        }
                    } catch (e) { }
                }
            }

            // Once the loop completes (or breaks out of), session check is over
            setIsRestoringSession(false);
        };

        if (!room?.id) initSession();
    }, [joinRoom, room?.id]);

    // Cleanup unassigned notifications automatically
    useEffect(() => {
        if (notifications.length > 0) {
            const timer = setTimeout(() => {
                setNotifications(prev => prev.slice(1));
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [notifications]);

    // Disable Lobby Notifications: Clear notifications whenever in lobby
    useEffect(() => {
        if (room?.status === 'lobby' && notifications.length > 0) {
            setNotifications([]);
        }
    }, [room?.status, notifications.length]);

    useEffect(() => {
        const path = location.pathname;
        const activePaths = ['/text-phase', '/emoji-phase', '/interpretation-phase', '/reveal-phase', '/vote', '/scoreboard', '/game-winner'];
        if (activePaths.some(p => path.includes(p))) {
            lastInGamePathRef.current = path;
        }
    }, [location.pathname]);

    // Reset high-phase tracker when in lobby to allow new games to start safely
    useEffect(() => {
        if (room?.status === 'lobby' || gameState?.phase === 'lobby') {
            lastInGamePathRef.current = null;
            lastHighPhaseRef.current = 0;
            lastNavigatedPhaseRef.current = null;
        }
    }, [room?.status, gameState?.phase]);

    // Navigation safety guard
    useEffect(() => {
        if (isExitingRef.current || isRestoringSession) return; // BYPASS GUARD IF EXPLICITLY LEAVING OR RESTORING

        const path = location.pathname;
        const isEditingAvatar = path === '/avatar-selection' && location.search.includes('from=lobby');
        const isSetupPath = ['/', '/join-room', '/how-to-play', '/terms'].includes(path) || (path === '/avatar-selection' && !isEditingAvatar);
        const allowedWithoutRoom = ['/', '/join-room', '/avatar-selection', '/how-to-play', '/terms', '/lobby'];

        if (room?.id && isSetupPath && currentPlayer?.name) {
            if (lastInGamePathRef.current) {
                navigate(lastInGamePathRef.current, { replace: true });
            } else if (room.status !== 'playing') {
                navigate('/lobby', { replace: true });
            }
        }
        if (!room?.id && !allowedWithoutRoom.includes(path)) {
            navigate('/', { replace: true });
        }
    }, [room?.id, location.pathname, navigate, currentPlayer?.name, room?.status, isExitingRef]);

    // Global Error Navigation
    useEffect(() => {
        if (error) {
            navigate('/', { replace: true, state: { error } });
            if (error === 'afkTimeout' || error === 'kickedError') {
                leaveRoom(true);
            }
        }
    }, [error, navigate, leaveRoom]);

    // Page Unload logic (Beforeunload)
    useEffect(() => {
        const handleBeforeUnload = (e) => {
            if (room?.id && currentPlayer?.id) {
                const isPlaying = room.status === 'playing';
                const isEndPhase = ['winner', 'scoreboard'].includes(gameState?.phase);
                const isMidGame = isPlaying && !isEndPhase;

                if (isMidGame) {
                    // Trigger the native browser "Are you sure you want to leave?" prompt
                    e.preventDefault();
                    e.returnValue = '';
                }
                // NOTE: We no longer forcefully delete the player record on refresh.
                // Doing so caused players to lose their internal host status and duplicate 
                // connections. Idle connections are cleaned up safely by the game's AFK system.
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [room?.id, currentPlayer?.id, room?.status, gameState?.phase]);

    // Sub-Phase Auto-Navigation Sync
    useEffect(() => {
        if (!gameState?.phase || !room?.id || !room?.room_code || isExitingRef.current) return;

        const currentP = gameState.phase;
        const currentWeight = getPhasePriority(currentP, room?.settings) ?? -1;

        const isLobbyRestart = currentP === 'lobby';
        const isNewRound = currentP === 'text' && lastHighPhaseRef.current >= getPhasePriority('scoreboard', room?.settings);

        if (currentWeight < lastHighPhaseRef.current && !isLobbyRestart && !isNewRound) {
            console.warn(`RoomContext: Blocking stale navigation from ${currentP} as we have already reached weight ${lastHighPhaseRef.current}`);
            return;
        }

        lastHighPhaseRef.current = currentWeight;

        const timerId = setTimeout(() => {
            const path = location.pathname;
            const isEditingAvatar = path === '/avatar-selection' && location.search.includes('from=lobby');
            if (isEditingAvatar) return; // HARD ABORT: Explicitly allow staying on Avatar Selection

            const isSetupPath = ['/', '/join-room', '/how-to-play', '/terms'].includes(path) || (path === '/avatar-selection' && !isEditingAvatar);

            if (!currentPlayer?.name) return;

            if (lastNavigatedPhaseRef.current === currentP && !isSetupPath) {
                const currentPath = window.location.pathname;
                const expectedSub = currentP === 'text' ? '/text-phase' :
                    currentP.startsWith('emoji') ? '/emoji-phase' :
                        currentP.startsWith('interpretation') ? '/interpretation-phase' :
                            currentP === 'reveal' ? '/reveal-phase' :
                                currentP === 'vote' ? '/vote' :
                                    currentP === 'scoreboard' ? '/scoreboard' :
                                        currentP === 'winner' ? '/game-winner' :
                                            currentP === 'lobby' ? '/lobby' : null;

                if (expectedSub && currentPath.includes(expectedSub)) return;
            }

            const urlCode = new URLSearchParams(window.location.search).get('code');
            const append = (urlCode || !room?.room_code) ? '' : `?code=${room.room_code}`;
            const target = (p) => p.includes('?') ? p : `${p}${append}`;

            console.log("RoomContext: Syncing navigation for phase:", currentP);

            requestAnimationFrame(() => {
                let dest = null;
                if (currentP === 'text') dest = target('/text-phase');
                else if (currentP.startsWith('emoji')) dest = target('/emoji-phase');
                else if (currentP.startsWith('interpretation')) dest = target('/interpretation-phase');
                else if (currentP === 'reveal') dest = target('/reveal-phase');
                else if (currentP === 'vote') dest = target('/vote');
                else if (currentP === 'scoreboard') dest = target('/scoreboard');
                else if (currentP === 'winner') dest = target('/game-winner');
                else if (currentP === 'lobby') dest = target('/lobby');

                if (dest) navigate(dest, { replace: true });
                lastNavigatedPhaseRef.current = currentP;
            });
        }, 50);

        return () => clearTimeout(timerId);
    }, [gameState?.phase, navigate, room?.id, room?.room_code, location.pathname, currentPlayer?.name, room?.status, room?.settings]);

    // INTEGRITY CHECK
    useEffect(() => {
        const canClean = ['lobby', 'scoreboard', 'winner'].includes(gameState?.phase);
        if (!currentPlayer?.is_host || !room?.id || !room?.settings?.player_order || players.length === 0 || !canClean) return;

        const currentOrder = room.settings.player_order;
        const activeIds = new Set(players.map(p => p.id));
        const cleanOrder = currentOrder.filter(id => activeIds.has(id));

        if (cleanOrder.length !== currentOrder.length) {
            console.log("RoomContext: Integrity Check - Cleaning up player_order (Found ghosts)");
            const newSettings = { ...room.settings, player_order: cleanOrder };
            setRoom(prev => ({ ...prev, settings: newSettings }));
            supabase.from('rooms').update({ settings: newSettings }).eq('id', room.id);
        }
    }, [players, currentPlayer?.is_host, room?.id, room?.settings?.player_order, gameState?.phase, setRoom]);

    // LOBBY ENTRY PURGE - Remove offline ex-players when game ends and room returns to lobby.
    // A player who was removed from player_order during gameplay (AFK timeout) still has a DB row.
    // If they are offline when the lobby loads, delete them immediately so they don't show as AFK ghost icons.
    useEffect(() => {
        if (!currentPlayer?.is_host || !room?.id || room?.status !== 'lobby' || players.length === 0) return;

        const purgeGhosts = async () => {
            const activeGameOrder = room?.settings?.player_order || [];
            const ghostsToRemove = players.filter(p =>
                // Not the current host
                p.id !== currentPlayer?.id &&
                // They are offline (not present in the Supabase Presence channel)
                !onlinePlayerIds.has(p.id) &&
                // They were NOT in the last game's player_order (they already got timed out mid-game)
                // OR they were in it but have been offline long enough to be considered gone
                !activeGameOrder.includes(p.id)
            );

            if (ghostsToRemove.length > 0) {
                console.log(`RoomContext: Lobby Purge - Removing ${ghostsToRemove.length} offline ex-player(s):`, ghostsToRemove.map(p => p.name));
                await Promise.all(
                    ghostsToRemove.map(p => supabase.from('players').delete().eq('id', p.id))
                );
                setPlayers(prev => prev.filter(p => !ghostsToRemove.find(g => g.id === p.id)));
            }
        };

        // Run once shortly after entering lobby to let Presence settle
        const timerId = setTimeout(purgeGhosts, 3000);
        return () => clearTimeout(timerId);
    }, [room?.status, room?.id, currentPlayer?.is_host, currentPlayer?.id, players, onlinePlayerIds, setPlayers]);

    // HOST CHECK - Auto-promote
    useEffect(() => {
        if (!room?.id || players.length === 0) return;

        const activeHost = players.find(p => p.is_host && onlinePlayerIds.has(p.id));
        if (activeHost) {
            if (hostCheckBuffer.current) {
                clearTimeout(hostCheckBuffer.current);
                hostCheckBuffer.current = null;
            }
            return;
        }

        const hostExists = players.some(p => p.is_host);

        // Auto-promote should run even in the lobby! If the host goes AFK, someone needs to inherit 
        // the host role so that they can trigger the 60s AFK monitor to eventually clean up the old host.

        const bufferMs = hostExists ? 15000 : 500;

        if (hostCheckBuffer.current && hostCheckBuffer.current.duration !== bufferMs) {
            clearTimeout(hostCheckBuffer.current.id);
            hostCheckBuffer.current = null;
        }

        if (!hostCheckBuffer.current) {
            const timerId = setTimeout(() => {
                const currentPlayers = playersRef.current;
                const currentOnlineIds = onlinePlayerIdsRef.current;
                const currentOnlineHost = currentPlayers.find(p => p.is_host && currentOnlineIds.has(p.id));

                if (!currentOnlineHost) {
                    const manualHostId = roomRef.current?.settings?.manual_host_id;
                    const manualCandidate = currentPlayers.find(p => p.id === manualHostId && currentOnlineIds.has(p.id));

                    if (manualCandidate) {
                        promotePlayerToHost(manualCandidate.id);
                    } else {
                        const onlinePlayingPlayers = currentPlayers.filter(p => currentOnlineIds.has(p.id));
                        const oldest = onlinePlayingPlayers.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))[0];

                        if (oldest) {
                            promotePlayerToHost(oldest.id);
                        }
                    }
                }
                hostCheckBuffer.current = null;
            }, bufferMs);

            hostCheckBuffer.current = { id: timerId, duration: bufferMs };
        }
    }, [players, room?.id, onlinePlayerIds, promotePlayerToHost]);

    const contextValue = useMemo(() => ({
        room, players, gameState, currentPlayer, error, onlinePlayerIds, awayPlayerIds, notifications,
        createRoom, joinRoom, startGame, checkRoomExists, updatePlayerProfile, leaveRoom, clearError,
        promotePlayerToHost, kickPlayer, updateRoomSettings, markSettingsDirty,
        submitAnswer, saveDraft, advancePhase, refreshRoomState, addNotification, removeNotification,
        isJoiningRef, isRestoringSession,
        isHost: currentPlayer?.is_host,
        isSpectator: !!(room?.settings?.player_order?.length > 0 && currentPlayer?.id && !room.settings.player_order.includes(currentPlayer.id))
    }), [
        room, players, gameState, currentPlayer, error, onlinePlayerIds, awayPlayerIds, notifications,
        joinRoom, startGame, checkRoomExists, updatePlayerProfile, leaveRoom, clearError,
        promotePlayerToHost, kickPlayer, updateRoomSettings, markSettingsDirty,
        submitAnswer, saveDraft, advancePhase, refreshRoomState, addNotification, removeNotification
    ]);

    return (
        <RoomContext.Provider value={contextValue}>
            {children}
        </RoomContext.Provider>
    );
}

export const useRoom = () => useContext(RoomContext);

