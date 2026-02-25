
import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate, useLocation } from 'react-router-dom';
import { useLanguage } from './LanguageContext';

const RoomContext = createContext();

const decodePlayer = (p) => {
    if (!p || !p.avatar) return p;
    const avatarparts = String(p.avatar).split('|');
    const emoji = avatarparts[0].trim();
    const extractedFingerprint = avatarparts[1] || null;

    return {
        ...p,
        avatar: emoji,
        fingerprint: extractedFingerprint
    };
};

// Helper: Simple Fisher-Yates shuffle
const shuffleArr = (arr) => {
    const newArr = [...arr];
    for (let i = newArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
};

// Helper: High-entropy assignment solver to ensure players don't always follow the same neighbors
// and never get a chain they've already seen.
const generateRandomAssignments = (playerIds, chains, chainIdsToUse) => {
    // GHOST V5 + SHUFFLE FIX: Always shuffle players and chains before solving for maximum entropy!
    const players = shuffleArr(playerIds);
    const chainIds = shuffleArr(chainIdsToUse);

    // Track which chains each player has already worked on
    const playerSeenChains = {};
    players.forEach(pId => {
        playerSeenChains[pId] = new Set();
        chainIds.forEach(cId => {
            const hasSeen = chains[cId].history.some(h => h.playerId === pId) || chains[cId].creator_id === pId;
            if (hasSeen) playerSeenChains[pId].add(cId);
        });
    });

    const solve = (playerIdx, currentAssignments, availableChains) => {
        if (playerIdx === players.length) return currentAssignments;

        const pId = players[playerIdx];
        // SHUFFLE FIX: Candidates are already randomized by the top-level shuffles, but we shuffle here too for deep randomization.
        const candidates = shuffleArr(availableChains.filter(cId => !playerSeenChains[pId].has(cId)));

        for (const cId of candidates) {
            currentAssignments[pId] = cId;
            const result = solve(playerIdx + 1, currentAssignments, availableChains.filter(c => c !== cId));
            if (result) return result;
        }
        return null;
    };

    return solve(0, {}, chainIds);
};

export function RoomProvider({ children }) {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const location = useLocation();
    const isProcessing = useRef(false);
    const isExitingRef = useRef(false); // New: Track if we are intentionally leaving
    const pendingJoinRef = useRef(null);
    const phaseTransitionLock = useRef(false); // NEW: Lock to prevent race conditions in advancePhase
    const [room, setRoom] = useState(null);
    const [players, setPlayers] = useState([]);
    const [gameState, setGameState] = useState(null);
    const [currentPlayer, setCurrentPlayer] = useState(null);
    const [onlinePlayerIds, setOnlinePlayerIds] = useState(new Set());
    const [awayPlayerIds, setAwayPlayerIds] = useState(new Set());
    const [notifications, setNotifications] = useState([]); // GHOST V5: Connection notifications
    const [error, setError] = useState(null);


    // GHOST V5: Notification logic moved to useCallback below
    const [fingerprint, setFingerprint] = useState(() => {
        try {
            let f = localStorage.getItem('player_fingerprint');
            if (!f) {
                // Use slice instead of substr for better compatibility
                f = 'f_' + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
                localStorage.setItem('player_fingerprint', f);
            }
            return f;
        } catch (e) {
            console.warn("RoomContext: LocalStorage blocked, using session fingerprint fallback.");
            return 'temp_' + Math.random().toString(36).slice(2, 11);
        }
    });

    const isHost = currentPlayer?.is_host;
    const channelRef = useRef(null);
    const hostCheckBuffer = useRef(null); // Stability buffer for host promotion
    const prevPlayersRef = useRef([]);
    const playersRef = useRef([]); // NEW: Tracks latest players state for advancePhase
    const roomRef = useRef(null); // NEW: Tracks latest room state
    const onlinePlayerIdsRef = useRef(new Set()); // NEW: Tracks latest online IDs
    const gameStateRef = useRef(null); // NEW: Tracks latest game state
    const lastInGamePathRef = useRef(null); // Track if we ever entered a game path
    const offlineTimersRef = useRef({}); // Tracks when players go offline
    const lastSettingsUpdateRef = useRef(0); // Tracks last time host manualy updated settings to prevent echo clobbering
    const lastAnswerUpdateRef = useRef(0); // Tracks last time current player submitted an answer to prevent late NULL echo
    const lastPhaseUpdateRef = useRef(0); // NEW: Tracks when the host last initiated a phase change
    const currentPlayerRef = useRef(null); // NEW: Tracks latest current player
    const subscriptionStartTime = useRef(0); // NEW: Tracks when we started listening to silence initial join events
    const lastNavigatedPhaseRef = useRef(null);
    const lastHighPhaseRef = useRef(-1); // Persistent tracker of furthest phase reached

    // Phase Priority Map: Prevents backwards jitter
    const phasePriority = {
        'lobby': 0,
        'text': 1,
        'emoji_1': 2,
        'interpretation_1': 3,
        'emoji_2': 4,
        'interpretation_2': 5,
        'emoji_3': 6,
        'reveal': 7,
        'vote': 8,
        'scoreboard': 9,
        'winner': 10
    };

    // GHOST V5: Helper to add a temporary notification with DE-DUPLICATION
    const addNotification = useCallback((message, type = 'info') => {
        setNotifications(prev => {
            // DE-DUPE: Don't add if identical message already exists
            if (prev.some(n => n.message === message)) return prev;

            const id = Date.now() + Math.random();
            setTimeout(() => {
                setNotifications(current => current.filter(n => n.id !== id));
            }, 5000); // 5s visibility

            return [...prev, { id, message, type }];
        });
    }, []);
    const removeNotification = useCallback((id) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    }, []);

    const getNextPhase = (currentPhase) => {
        const isEmojiOnly = room?.settings?.selectedMode === 'Emoji Only';
        const phaseOrder = isEmojiOnly
            ? ['text', 'emoji_1', 'emoji_2', 'emoji_3', 'emoji_4', 'emoji_5', 'reveal', 'vote', 'scoreboard', 'winner']
            : ['text', 'emoji_1', 'interpretation_1', 'emoji_2', 'interpretation_2', 'emoji_3', 'reveal', 'vote', 'scoreboard', 'winner'];

        const currentIndex = phaseOrder.indexOf(currentPhase);
        if (currentIndex === -1 || currentIndex >= phaseOrder.length - 1) return null;

        let nextP = phaseOrder[currentIndex + 1];

        // Ensure we advance to reveal if we've completed enough rounds (player count limit)
        const playingIds = room?.settings?.player_order || [];
        const gameplayPhases = isEmojiOnly
            ? ['text', 'emoji_1', 'emoji_2', 'emoji_3', 'emoji_4', 'emoji_5']
            : ['text', 'emoji_1', 'interpretation_1', 'emoji_2', 'interpretation_2', 'emoji_3'];

        if (playingIds.length > 0 && gameplayPhases.includes(currentPhase)) {
            const roundsCompleted = gameplayPhases.indexOf(currentPhase) + 1;
            const playerCount = playingIds.length;
            if (roundsCompleted >= playerCount && nextP !== 'reveal') {
                nextP = 'reveal';
            }
        }
        return nextP;
    };

    useEffect(() => {
        prevPlayersRef.current = players;
        playersRef.current = players;
        roomRef.current = room;
        onlinePlayerIdsRef.current = onlinePlayerIds;
        gameStateRef.current = gameState;
        currentPlayerRef.current = currentPlayer;
    }, [players, room, onlinePlayerIds, gameState, currentPlayer]);

    // 2. Reactive Safety Guard: Forcefully clear room state if player navigates back to Home/Join
    useEffect(() => {
        const path = location.pathname;
        const mainPaths = ['/', '/join-room', '/how-to-play', '/terms'];
        const isMainPath = mainPaths.includes(path);

        // If they navigate back to the main menu without a real 'exit', kill the stale session
        if (isMainPath && room?.id && !isExitingRef.current) {
            console.log("RoomContext: [SAFETY GUARD] purging stale room state on path:", path);
            leaveRoom(true);
        }

        // Track if we are in a game path for the back-trap logic
        const gamePaths = ['/lobby', '/text-phase', '/emoji-phase', '/interpretation-phase', '/reveal-phase', '/vote', '/scoreboard', '/game-winner'];
        if (gamePaths.includes(path)) {
            lastInGamePathRef.current = path;
        }
    }, [location.pathname, room?.id]);

    // NEW: Phase 6 - Handle Tab Close / Visibility Change for Ghost Player Cleanup
    // REMOVED: Aggressive delete on pagehide/unload caused host loss on refresh.
    // relying on 'cleanup_stale_players' RPC and Heartbeat timeout instead.

    // 3. Refresh Warning - ONLY DURING ACTIVE GAME (Back button handled by NavigationGate)
    useEffect(() => {
        const path = location.pathname;
        const gamePaths = ['/lobby', '/text-phase', '/emoji-phase', '/interpretation-phase', '/reveal-phase', '/vote', '/scoreboard', '/game-winner'];
        const isInGamePath = gamePaths.includes(path);

        if (!room?.id) return;

        const handleBeforeUnload = (event) => {
            if (room?.id && !isExitingRef.current && (isInGamePath || lastInGamePathRef.current)) {
                const message = "Are you sure you want to leave the game? Your progress will be lost!";
                event.returnValue = message;
                return message;
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [room?.id, location.pathname, gameState?.phase]);

    // --- GLOBAL FATAL ERROR REDIRECT ---
    useEffect(() => {
        const fatalErrors = ['kickedError', 'roomFull', 'roomNotFound', 'afkTimeout'];
        if (error && fatalErrors.includes(error)) {
            console.warn(`RoomContext: FATAL ERROR DETECTED (${error}). Globally redirecting to home.`);

            // SECURITY/UX: Thoroughly clean up session to prevent auto-reconnect loops
            const currentRoomCode = room?.room_code || roomRef.current?.room_code;
            if (currentRoomCode) {
                sessionStorage.removeItem(`room_session_${currentRoomCode}`);
                sessionStorage.setItem(`explicit_leave_${currentRoomCode}`, 'true');
            }

            // Purge all other possible session artifacts
            Object.keys(sessionStorage).forEach(key => {
                if (key.startsWith('room_session_')) {
                    sessionStorage.removeItem(key);
                }
            });

            navigate('/', { state: { error: error }, replace: true });
        }
    }, [error, navigate, room?.room_code]);

    // Subscribe to changes when room is active
    useEffect(() => {
        if (!room?.id) return;

        // NEW: Set silence window start time
        subscriptionStartTime.current = Date.now();

        if (channelRef.current) {
            supabase.removeChannel(channelRef.current);
        }

        const handleVisibilityChange = async () => {
            const isAway = document.visibilityState === 'hidden';
            if (channelRef.current && currentPlayer?.id) {
                console.log("RoomContext: Visibility changed. isAway:", isAway);
                await channelRef.current.track({ id: currentPlayer.id, isAway });
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        const channel = supabase
            .channel(`room-${room.id}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'players',
                filter: `room_id=eq.${room.id}`
            }, (payload) => {
                console.log("RoomContext: [PLAYERS REALTIME]", payload.eventType, payload.new?.id || payload.old?.id);

                // Success: Subscription is now filtered by room_id in the database layer.

                if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
                    const updatedPlayer = decodePlayer(payload.new);

                    // ECHO PREVENTION: Determine if this update for current player should be guarded
                    let finalPlayer = updatedPlayer;
                    if (updatedPlayer.id === currentPlayerRef.current?.id) {
                        const now = Date.now();
                        const isRecentUpdate = now - lastAnswerUpdateRef.current < 2500;
                        const serverAns = updatedPlayer.last_answer;
                        const currentPhase = gameStateRef.current?.phase;

                        let isSamePhase = false;
                        if (!serverAns) isSamePhase = true;
                        else if (currentPhase === 'vote') isSamePhase = serverAns.startsWith('vote:') || serverAns.startsWith('vote_multi:');
                        else if (currentPhase === 'text') isSamePhase = serverAns.startsWith('text:');
                        else if (currentPhase?.startsWith('emoji')) isSamePhase = serverAns.startsWith('emoji:');
                        else if (currentPhase?.startsWith('interpretation')) isSamePhase = serverAns.startsWith('guess:');

                        const isLateEcho = (isRecentUpdate && !serverAns) || (serverAns && !isSamePhase && !['lobby', 'scoreboard', 'winner'].includes(currentPhase));

                        if (isLateEcho) {
                            console.log("RoomContext: Shielding local state from late/stale answer echo.", { server: serverAns, local: currentPlayerRef.current.last_answer });
                            finalPlayer = { ...updatedPlayer, last_answer: currentPlayerRef.current.last_answer };
                        }
                    }

                    setPlayers(prev => {
                        const exists = prev.some(p => p.id === finalPlayer.id);
                        if (exists) {
                            return prev.map(p => p.id === finalPlayer.id ? finalPlayer : p);
                        }
                        return [...prev, finalPlayer];
                    });

                    // OPTIMISTIC VISIBILITY: If a new player is inserted, mark them online immediately
                    if (payload.eventType === 'INSERT') {
                        setOnlinePlayerIds(prev => new Set(prev).add(finalPlayer.id));
                    }

                    if (currentPlayerRef.current?.id === finalPlayer.id) {
                        setCurrentPlayer(prev => {
                            // Only update if something meaningful changed to prevent render loops
                            const hasChanged = !prev ||
                                prev.last_answer !== finalPlayer.last_answer ||
                                prev.score !== finalPlayer.score ||
                                prev.is_host !== finalPlayer.is_host ||
                                prev.name !== finalPlayer.name ||
                                prev.avatar !== finalPlayer.avatar;
                            return hasChanged ? finalPlayer : prev;
                        });
                    }
                } else if (payload.eventType === 'DELETE') {
                    setPlayers(prev => prev.filter(p => p.id !== payload.old.id));

                    // If it was the current player that was deleted, trigger timeout or kick error
                    // CRITICAL: Only trigger error if we aren't EXPLICITLY leaving or disconnected
                    if (currentPlayerRef.current?.id === payload.old.id && !isExitingRef.current) {
                        console.warn("RoomContext: I have been deleted from the players table (Server-side/Host removal).");
                        // Heuristic: If I'm not in the kicked list, it's a timeout (soft removal)
                        const isKicked = roomRef.current?.settings?.kicked_names?.includes(currentPlayerRef.current?.name);
                        if (isKicked) {
                            setError('kickedError');
                        } else {
                            setError('afkTimeout');
                        }
                    }
                }
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state', filter: `room_id=eq.${room.id}` }, (payload) => {
                if (payload.new) {
                    const now = Date.now();
                    const isRecentUpdate = now - lastPhaseUpdateRef.current < 3000;
                    const amHost = currentPlayerRef.current?.is_host;

                    if (amHost && isRecentUpdate) {
                        console.log("RoomContext: Skipping game_state echo to preserve local phase change.");
                        return;
                    }
                    setGameState(payload.new);
                }
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${room.id}` }, (payload) => {
                if (payload.new) {
                    // ECHO PREVENTION: If I'm the host and I JUST updated settings, ignore this update
                    // to prevent my optimistic state from being clobbered by a late DB arrival.
                    const now = Date.now();
                    const isRecentUpdate = now - lastSettingsUpdateRef.current < 3000;

                    setRoom(prev => {
                        const amHost = currentPlayerRef.current?.is_host;
                        if (amHost && isRecentUpdate) {
                            console.log("RoomContext: Skipping settings echo to preserve local changes.");
                            return { ...prev, ...payload.new, settings: prev.settings };
                        }
                        return { ...prev, ...payload.new };
                    });

                    // Reactive Kick Detection: If room settings change and I'm now kicked, bounce me
                    if (currentPlayer?.name) {
                        const kickedNames = payload.new.settings?.kicked_names || [];
                        const kickedFingerprints = payload.new.settings?.kicked_fingerprints || [];
                        if (kickedNames.includes(currentPlayer.name) || (currentPlayer.fingerprint && kickedFingerprints.includes(currentPlayer.fingerprint))) {
                            console.warn("RoomContext: Detected my name/fingerprint in kicked list. Bouncing...");
                            setError('kickedError');
                        }
                    }
                }
            })
            .on('presence', { event: 'sync' }, () => {
                const newState = channel.presenceState();
                const ids = new Set();
                const awayIds = new Set();

                Object.values(newState).forEach(presences => {
                    presences.forEach(p => {
                        ids.add(p.id);
                        if (p.isAway) awayIds.add(p.id);
                    });
                });
                setOnlinePlayerIds(ids);
                setAwayPlayerIds(awayIds); // Assuming state exists or will be added
            })
            .on('presence', { event: 'join' }, ({ key, newPresences }) => {
                // GHOST V5: Silence initial join events (3s window)
                if (Date.now() - subscriptionStartTime.current < 3000) {
                    // Still update online IDs below, just don't toast
                } else {
                    // GHOST V5 / NOTIFICATION REFINEMENT: Only show toasts if game is PLAYING
                    if (roomRef.current?.status === 'playing') {
                        newPresences.forEach(p => {
                            // FIX: Only toast if they weren't already online (avoids double toast on isAway toggle)
                            if (!onlinePlayerIdsRef.current.has(p.id) && String(p.id) !== String(currentPlayerRef.current?.id)) {
                                const name = playersRef.current.find(pl => pl.id === p.id)?.name || "Someone";
                                // GHOST V5 + RECONNECT: Explicit notification for re-joins
                                addNotification(t('playerReconnected').replace('{name}', name), 'success');
                            }
                        });
                    }
                }
                setOnlinePlayerIds(prev => {
                    const next = new Set(prev);
                    newPresences.forEach(p => next.add(p.id));
                    return next;
                });
                setAwayPlayerIds(prev => {
                    const next = new Set(prev);
                    newPresences.forEach(p => { if (p.isAway) next.add(p.id); });
                    return next;
                });
            })
            .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
                // We re-sync from full state for leaves to be safe
                const newState = channel.presenceState();
                const onlineIds = new Set();
                const awayIds = new Set();
                Object.values(newState).forEach(presences => {
                    presences.forEach(p => {
                        onlineIds.add(p.id);
                        if (p.isAway) awayIds.add(p.id);
                    });
                });

                // GHOST V5 / NOTIFICATION REFINEMENT: Only show toasts if game is PLAYING
                if (roomRef.current?.status === 'playing') {
                    // Filter for "Active Players" (Min 2 active players baseline to continue)
                    const activePlayerIds = roomRef.current?.settings?.player_order || [];
                    const onlinePlayingCount = activePlayerIds.filter(id => onlineIds.has(id)).length;

                    if (onlinePlayingCount < 2) {
                        addNotification(t('gameStoppedError'), 'error');

                        // HOST ONLY: Reset the game
                        if (currentPlayerRef.current?.is_host) {
                            console.log("RoomContext: Active player count dropped below 2. Redirecting to Scoreboard.");
                            advancePhase('scoreboard');
                        }
                    } else {
                        leftPresences.forEach(p => {
                            // FIX: Only toast if they ACTUALLY left the presence pool entirely
                            if (!onlineIds.has(p.id) && String(p.id) !== String(currentPlayerRef.current?.id)) {
                                const name = playersRef.current.find(pl => pl.id === p.id)?.name || "A player";
                                addNotification(t('playerLeftInfo').replace('{name}', name), 'info');
                            }
                        });
                    }
                }

                setOnlinePlayerIds(onlineIds);
                setAwayPlayerIds(awayIds);
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED' && currentPlayer?.id) {
                    await channel.track({ id: currentPlayer.id, isAway: document.visibilityState === 'hidden' });
                }
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.error("RoomContext: Realtime connection failed! Status:", status);
                    // Attempt clean reconnect after short delay
                    setTimeout(() => {
                        if (channelRef.current) supabase.removeChannel(channelRef.current);
                        channelRef.current = null;
                        // Forcing a minor state update to trigger the subscription useEffect again
                        setOnlinePlayerIds(prev => new Set(prev));
                    }, 2000);
                }
            });

        channelRef.current = channel;

        // Force an initial fetch for robustness
        fetchPlayers(room.id);

        // Fallback Sync: Every 5s, refetch everything to catch any missed updates (network issues, etc.)
        const syncInterval = setInterval(() => {
            if (room?.id) {
                fetchPlayers(room.id);
                // Hardened Room Sync: Check for recent host updates before blindly applying server data
                supabase.from('rooms').select('*').eq('id', room.id).single()
                    .then(({ data }) => {
                        if (!data) return;
                        const now = Date.now();
                        const isRecentUpdate = now - lastSettingsUpdateRef.current < 3000;
                        const amHost = currentPlayerRef.current?.is_host;

                        setRoom(prev => {
                            if (amHost && isRecentUpdate && prev?.settings) {
                                console.log("RoomContext: [POLLING] Shielding local settings from stale DB arrival.");
                                return { ...prev, ...data, settings: prev.settings };
                            }
                            return { ...prev, ...data };
                        });
                    });
                supabase.from('game_state').select('*').eq('room_id', room.id).single()
                    .then(({ data }) => {
                        if (!data) return;
                        const now = Date.now();
                        const isRecentUpdate = now - lastPhaseUpdateRef.current < 3000;
                        const amHost = currentPlayerRef.current?.is_host;

                        if (amHost && isRecentUpdate) {
                            console.log("RoomContext: [POLLING] Shielding local game_state from stale DB arrival.");
                            return;
                        }
                        setGameState(data);
                    });
            }
        }, 5000);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
            }
            clearInterval(syncInterval);
        };
    }, [room?.id, currentPlayer?.id]);

    // STALE ROOM DETECTOR: Check if a newer room with the same code exists (Split-brain fix)
    useEffect(() => {
        if (!room?.id || !room?.room_code) return;

        const checkStale = async () => {
            // Find ALL rooms with this code
            const { data: candidates } = await supabase
                .from('rooms')
                .select('id, created_at, status')
                .eq('room_code', room.room_code)
                .order('created_at', { ascending: false });

            if (!candidates || candidates.length <= 1) return;

            // SMART MERGE: Is there a "Better" room than ours?
            // "Better" = Has more players OR has an active host.
            const candidateIds = candidates.map(c => c.id);
            const { data: allPlayers } = await supabase.from('players').select('id, room_id, is_host, last_seen').in('room_id', candidateIds);

            const now = new Date();
            const activeThreshold = 45000; // 45 seconds (User Request)

            const stats = {};
            candidateIds.forEach(id => { stats[id] = { count: 0, hasActiveHost: false }; });

            allPlayers?.forEach(p => {
                const isOnline = (now - new Date(p.last_seen)) < activeThreshold;
                if (isOnline) {
                    stats[p.room_id].count++;
                    if (p.is_host) stats[p.room_id].hasActiveHost = true;
                }
            });

            // Find the consensus winner
            const winnerId = candidateIds.sort((a, b) => {
                const scoreA = (stats[a].hasActiveHost ? 100 : 0) + stats[a].count;
                const scoreB = (stats[b].hasActiveHost ? 100 : 0) + stats[b].count;
                if (scoreA !== scoreB) return scoreB - scoreA;
                return new Date(candidates.find(c => c.id === b).created_at) - new Date(candidates.find(c => c.id === a).created_at);
            })[0];

            if (winnerId && winnerId !== room.id) {
                console.warn(`RoomContext: SPLIT-BRAIN DETECTED! We are in ${room.id} but the PARTY is in ${winnerId}. Merging...`);
                // Force reload to join the correct room
                sessionStorage.removeItem(`room_session_${room.room_code}`); // Clear stale session so joinRoom triggers a fresh discovery
                window.location.reload();
            }
        };

        const timer = setInterval(checkStale, 15000); // Check every 15s for snappier merging
        checkStale();

        return () => clearInterval(timer);
    }, [room?.id, room?.room_code]);

    // PASSIVE CATCH-UP: Periodically poll for phase/room changes to rescue "stuck" players
    useEffect(() => {
        if (!room?.id) return;

        const catchUp = async () => {
            if (isExitingRef.current) return;

            // Fetch the absolute source of truth
            const [{ data: latestGS }, { data: latestRoom }] = await Promise.all([
                supabase.from('game_state').select('*').eq('room_id', room.id).single(),
                supabase.from('rooms').select('*').eq('id', room.id).single()
            ]);

            if (latestGS) {
                const currentP = gameStateRef.current?.phase;
                const nextP = latestGS.phase;

                // NEW: Shield host's local state from stale DB read right after manual nav
                const now = Date.now();
                const isRecentPhaseUpdate = now - lastPhaseUpdateRef.current < 4000;
                const amHost = currentPlayerRef.current?.is_host;

                if (amHost && isRecentPhaseUpdate) {
                    // Silently ignore to let the optimistic local state stick
                } else {
                    // Use Phase Priority Guard to determine if we should jump
                    const phasePriority = {
                        'lobby': 0, 'text': 1, 'emoji_1': 2, 'interpretation_1': 3,
                        'emoji_2': 4, 'interpretation_2': 5, 'emoji_3': 6, 'reveal': 7,
                        'vote': 8, 'scoreboard': 9, 'winner': 10
                    };

                    const currentPri = phasePriority[currentP] ?? -1;
                    const nextPri = phasePriority[nextP] ?? -1;

                    if (nextPri > currentPri) {
                        console.log(`RoomContext: [PASSIVE CATCH-UP] Advancing from ${currentP} to ${nextP}`);
                        setGameState(latestGS);
                    }
                }
            }

            if (latestRoom) {
                // NEW: Shield host's local settings state
                const now = Date.now();
                const isRecentSettingsUpdate = now - lastSettingsUpdateRef.current < 4000;
                const amHost = currentPlayerRef.current?.is_host;

                setRoom(prev => {
                    if (!prev) return latestRoom;

                    if (amHost && isRecentSettingsUpdate) {
                        // Protect optimistic settings (like Reveal step/chain Index)
                        return prev;
                    }

                    // Only update if settings or status changed (Deep shallow check)
                    const hasStatusChange = prev.status !== latestRoom.status;
                    const hasSettingsChange = JSON.stringify(prev.settings) !== JSON.stringify(latestRoom.settings);

                    if (hasStatusChange || hasSettingsChange) {
                        console.log(`RoomContext: [PASSIVE CATCH-UP] Syncing room data.`);
                        return { ...prev, ...latestRoom };
                    }
                    return prev;
                });
            }
        };

        const timer = setInterval(catchUp, 8000); // 8s heartbeat to rescue stuck players
        return () => clearInterval(timer);
    }, [room?.id]);

    // HEARTBEAT: Update last_seen every 10s (was 30s) to keep presence fresh
    useEffect(() => {
        if (!room?.id || !currentPlayer?.id) return;

        const updateHeartbeat = async () => {
            try {
                const { error } = await supabase
                    .from('players')
                    .update({ last_seen: new Date().toISOString() })
                    .eq('id', currentPlayer.id);

                if (error) console.error("Heartbeat error:", error);
            } catch (e) {
                console.error("Heartbeat exception:", e);
            }
        };

        // Initial beat
        updateHeartbeat();

        const heartbeatInterval = setInterval(updateHeartbeat, 10000); // 10 seconds
        return () => clearInterval(heartbeatInterval);
    }, [room?.id, currentPlayer?.id]);

    // Client-Side Answer Clearing
    useEffect(() => {
        if (!gameState?.phase || !currentPlayer?.id || gameState.phase === 'lobby') return;
        const lastClearedPhase = sessionStorage.getItem(`cleared_phase_${room?.id}`);
        if (lastClearedPhase !== gameState.phase) {
            // SAFE CLEAR: Only delete the answer if it doesn't already belong to the new phase.
            // This prevents the "quick vote" race condition where a player votes before this effect runs.
            const ans = currentPlayer.last_answer || '';
            const newPhase = gameState.phase;

            // Determine if the current answer is already "valid" for the new phase
            const isCoded = ans.includes(':');
            let isCurrentPhaseData = false;

            if (newPhase === 'text') isCurrentPhaseData = ans.startsWith('text:');
            else if (newPhase.startsWith('emoji')) isCurrentPhaseData = ans.startsWith('emoji:');
            else if (newPhase.startsWith('interpretation')) isCurrentPhaseData = ans.startsWith('guess:');
            else if (newPhase === 'vote') isCurrentPhaseData = ans.startsWith('vote:') || ans.startsWith('vote_multi:');

            if (isCurrentPhaseData) {
                console.log("RoomContext: Skipping client-side clear, player already has fresh data for phase:", newPhase);
                sessionStorage.setItem(`cleared_phase_${room?.id}`, newPhase);
                return;
            }

            console.log("RoomContext: Clearing local old answer state for new phase:", newPhase);
            // CRITICAL FIX: Only clear LOCAL state here so the UI doesn't flash old answers. 
            // DO NOT clear the database, or else advancePhase won't be able to collect drafts.
            // advancePhase handles the actual database clearing safely.
            sessionStorage.setItem(`cleared_phase_${room?.id}`, newPhase);
            setPlayers(prev => prev.map(p => p.id === currentPlayer.id ? { ...p, last_answer: null } : p));
        }
    }, [gameState?.phase, currentPlayer?.id, room?.id]);

    // Global Host Sync fallback: Force advance if stuck OR everyone is ready
    useEffect(() => {
        if (!isHost || !room?.id || !gameState?.phase) return;

        const monitorInterval = setInterval(() => {
            if (phaseTransitionLock.current) return;

            const currentPhase = gameState.phase;
            if (['lobby', 'reveal', 'scoreboard', 'winner'].includes(currentPhase)) return;

            const playingIds = room?.settings?.player_order || [];
            if (playingIds.length === 0) return;

            // 1. Check for "Everyone Ready" (Fast Finish)
            // We only count ONLINE players who are currently IN the game rotation
            const total = playingIds.length;

            if (total > 0) {
                // Determine the expected answer prefix for the current phase
                const prefix = currentPhase.startsWith('text') ? 'text:' :
                    currentPhase.startsWith('emoji') ? 'emoji:' :
                        currentPhase.startsWith('interpretation') ? 'guess:' :
                            currentPhase === 'vote' ? 'vote:' : null;

                if (prefix) {
                    const readyCount = players.filter(p =>
                        playingIds.includes(p.id) &&
                        p.last_answer && (p.last_answer.startsWith('vote:') || p.last_answer.startsWith('vote_multi:') || p.last_answer.startsWith(prefix))
                    ).length;

                    if (readyCount >= total) {
                        console.log(`RoomContext: Host detected everyone ready (${readyCount}/${total}). Advancing...`);
                        const next = getNextPhase(currentPhase);
                        if (next) advancePhase(next);
                        return; // Skip timer check if we are advancing due to readiness
                    }
                }
            }

            // 2. Check for "Timer Expired" (Fallback)
            const expirySource = gameState?.phase_expiry || room?.settings?.phase_expiry;
            if (expirySource) {
                const now = Date.now();
                const expiry = new Date(expirySource).getTime();
                // Add a small delay (2.5s) to allow for network sync drift before forcing
                if (now > (expiry + 2500)) {
                    console.log(`RoomContext: Host Monitor forcing advance from ${currentPhase} due to timeout.`);
                    const next = getNextPhase(currentPhase);
                    if (next) advancePhase(next);
                }
            }
        }, 1000); // Check every second for snappy response
        return () => clearInterval(monitorInterval);
    }, [isHost, room?.id, gameState?.phase, players, onlinePlayerIds, room?.settings?.player_order]);

    // 7. Data Refresh for new hosts
    useEffect(() => {
        if (isHost && room?.id) {
            fetchPlayers(room.id);
            supabase.from('rooms').select('*').eq('id', room.id).single()
                .then(({ data }) => data && setRoom(prev => ({ ...prev, ...data })));
        }
    }, [isHost, room?.id]);



    // 6. Conflict Resolution: Prevent Multiple Hosts (Split Brain)
    useEffect(() => {
        if (!isHost || !room?.id || !players.length) return;

        // 1. Find ALL hosts that are currently ONLINE
        const allOnlineHosts = players.filter(p => p.is_host && onlinePlayerIds.has(p.id));

        // If I am the only online host, we are good.
        if (allOnlineHosts.length <= 1) return;

        // 2. Conflict Handling: If multiple online hosts exist, check if one is the "Manual Choice"
        const manualHostId = room?.settings?.manual_host_id;
        const currentManualHost = allOnlineHosts.find(p => p.id === manualHostId);

        let trueHostId = null;
        if (currentManualHost) {
            trueHostId = currentManualHost.id;
        } else {
            // Fallback to seniority (Oldest keeps crown)
            const sortedHosts = [...allOnlineHosts].sort((a, b) => {
                const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
                const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
                if (timeA === timeB) return a.id.localeCompare(b.id);
                return timeA - timeB;
            });
            trueHostId = sortedHosts[0].id;
        }

        // If I am NOT the true host among online players, I must abdicate.
        if (trueHostId !== currentPlayer.id) {
            const trueHostName = players.find(p => p.id === trueHostId)?.name || "another player";
            console.warn("RoomContext: HOST CONFLICT DETECTED! Abdicating throne to:", trueHostName);
            setCurrentPlayer(prev => ({ ...prev, is_host: false }));
            supabase.from('players').update({ is_host: false }).eq('id', currentPlayer.id).then(() => {
                fetchPlayers(room.id);
            });
        }

    }, [players, isHost, currentPlayer?.id, room?.id]);

    // 8. Automated Host Election & AFK Cleanup
    useEffect(() => {
        if (!room?.id || !players.length || !currentPlayer?.id) return;

        const cleanupInterval = setInterval(async () => {
            // --- PART A: Host Election (Self-Promotion) ---
            // If NO host is currently in onlinePlayerIds, the most senior online player takes over.
            const onlineHosts = players.filter(p => p.is_host && onlinePlayerIds.has(p.id));

            if (onlineHosts.length === 0) {
                const onlinePlayers = [...players]
                    .filter(p => onlinePlayerIds.has(p.id))
                    .sort((a, b) => {
                        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
                        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
                        if (timeA === timeB) return a.id.localeCompare(b.id);
                        return timeA - timeB;
                    });

                if (onlinePlayers.length > 0 && onlinePlayers[0].id === currentPlayer.id) {
                    await promotePlayerToHost(currentPlayer.id);
                }
            }

            // --- PART B: AFK Cleanup (Host Only) ---
            if (isHost) {
                const now = Date.now();
                const timeoutMs = 60000; // Increased to 60 seconds

                players.forEach(p => {
                    // We don't kick ourselves (the current host)
                    if (p.id === currentPlayer.id) return;

                    const isOnline = onlinePlayerIds.has(p.id);
                    const isAway = awayPlayerIds.has(p.id);

                    if (!isOnline || isAway) {
                        // Player is "gone" if offline OR in background
                        if (!offlineTimersRef.current[p.id]) {
                            offlineTimersRef.current[p.id] = now;
                        } else {
                            const graceDuration = now - offlineTimersRef.current[p.id];
                            // SEGREGATED TIMEOUTS:
                            // Offline (presense lost) -> 30s (increased from 5s to allow for reconnection)
                            // Away (tab hidden) -> 60s (grace for switching apps)
                            const currentMaxGrace = isOnline ? 60000 : 30000;

                            if (graceDuration >= currentMaxGrace) {
                                console.warn(`RoomContext: Player ${p.name} (${p.id}) grace period exceeded (${isOnline ? 'AWAY' : 'OFFLINE'}). Removing.`);
                                timeoutPlayer(p.id);
                                delete offlineTimersRef.current[p.id];
                            }
                        }
                    } else {
                        // Player is active (Online AND Visible)
                        if (offlineTimersRef.current[p.id]) {
                            delete offlineTimersRef.current[p.id];
                        }
                    }
                });
            }
        }, 2000); // Check every 2 seconds

        return () => clearInterval(cleanupInterval);
    }, [room?.id, players, onlinePlayerIds, isHost, currentPlayer?.id]);



    // Global Auto-Reconnect: Watch URL for 'code' changes
    useEffect(() => {
        const autoReconnect = async () => {
            const params = new URLSearchParams(location.search);
            let codeFromUrl = params.get('code');

            // CRITICAL: NEVER auto-reconnect on setup paths
            const isSetupPath = ['/', '/join-room', '/avatar-selection', '/how-to-play', '/terms'].includes(location.pathname);
            if (isSetupPath) return;

            // Refinement: Only trigger "Discovery" if we are on a game-specific path
            const isGamePath = ['/lobby', '/text-phase', '/emoji-phase', '/interpretation-phase', '/reveal-phase', '/vote', '/scoreboard', '/game-winner'].includes(location.pathname);

            if (!codeFromUrl && isGamePath) {
                const sessionKeys = Object.keys(sessionStorage).filter(k => k.startsWith('room_session_'));
                if (sessionKeys.length > 0) {
                    codeFromUrl = sessionKeys[0].replace('room_session_', '');
                }
            }

            if (!codeFromUrl || room?.id) return;
            if (sessionStorage.getItem(`explicit_leave_${codeFromUrl}`)) return;

            // FAST-FAIL: Check if room exists before attempting full join
            // This is much faster for invalid links
            const roomCheck = await supabase.from('rooms').select('id').eq('room_code', codeFromUrl).maybeSingle();
            if (!roomCheck.data && isGamePath) {
                setError('roomNotFound'); // Update global error state for others
                navigate('/', { state: { error: 'roomNotFound' }, replace: true });
                return;
            }

            const savedName = localStorage.getItem('player_name') || 'Guest';
            const savedIdx = localStorage.getItem('player_avatar_idx');
            const AVATARS = ['😎', '🦊', '🐱', '🐼', '🐸', '🦁', '🦄', '👻', '👾', '🤖', '🎃', '👽'];
            const savedAvatar = savedIdx ? AVATARS[parseInt(savedIdx, 10)] : '😎';

            // Pass isAutoReconnect = true
            const success = await joinRoom(codeFromUrl, savedName, savedAvatar, true);
            if (!success && isGamePath) {
                navigate('/', { replace: true });
            }
        };
        autoReconnect();
    }, [location.pathname, location.search, room?.id]);

    // Sync URL globally
    useEffect(() => {
        if (room?.room_code) {
            const params = new URLSearchParams(location.search);
            if (params.get('code') !== room.room_code) {
                params.set('code', room.room_code);
                navigate(`${location.pathname}?${params.toString()}`, { replace: true });
            }
        }
    }, [room?.room_code, location.pathname, location.search]);

    const fetchPlayers = useCallback(async (roomId) => {
        if (!roomId) return;
        try {
            const { data: pData } = await supabase.from('players').select('*').eq('room_id', roomId).order('created_at', { ascending: true });
            if (pData) {
                const processedData = pData.map(p => decodePlayer(p));
                setPlayers(processedData);
                if (currentPlayerRef.current?.id) {
                    const updatedMe = processedData.find(p => p.id === currentPlayerRef.current.id);
                    if (updatedMe) {
                        setCurrentPlayer(prev => {
                            const hasChanged = !prev ||
                                prev.last_answer !== updatedMe.last_answer ||
                                prev.score !== updatedMe.score ||
                                prev.is_host !== updatedMe.is_host;
                            return hasChanged ? updatedMe : prev;
                        });
                    }
                }
            }

            const { data: sData } = await supabase.from('game_state').select('*').eq('room_id', roomId).single();
            if (sData) {
                setGameState(sData);
            } else {
                console.warn("RoomContext: Game state not found during fetchPlayers. Initializing...");
                const fallbackState = { room_id: roomId, phase: 'lobby' };
                setGameState(fallbackState);
            }
        } catch (err) {
            console.error("RoomContext: fetchPlayers error:", err);
        }
    }, []);

    const refreshRoomState = useCallback(async () => {
        if (roomRef.current?.id) await fetchPlayers(roomRef.current.id);
    }, [fetchPlayers]);

    const promotePlayerToHost = useCallback(async (playerId) => {
        if (!roomRef.current?.id) return;
        try {
            // 1. Mark the manual host ID in settings to "Anchor" the election
            const nextSettings = {
                ...(roomRef.current.settings || {}),
                manual_host_id: playerId,
                spectatorEnabled: false // NEW: Reset spectator mode on host change
            };
            await supabase.from('rooms').update({ settings: nextSettings }).eq('id', roomRef.current.id);

            // 2. Promote new player
            await supabase.from('players').update({ is_host: true }).eq('id', playerId);

            // 3. Demote self locally and in DB (ONLY if I was actually the host)
            if (currentPlayerRef.current?.is_host) {
                setCurrentPlayer(prev => ({ ...prev, is_host: false }));
                await supabase.from('players').update({ is_host: false }).eq('id', currentPlayerRef.current.id);
            }

            fetchPlayers(roomRef.current.id);
        } catch (err) {
            console.error("Error promoting player:", err);
        }
    }, [fetchPlayers]);

    const kickPlayer = useCallback(async (playerId) => {
        if (!currentPlayerRef.current?.is_host || !roomRef.current?.id) return;
        try {
            const currentPlayers = playersRef.current;
            const targetPlayer = currentPlayers.find(p => p.id === playerId);
            if (!targetPlayer) return;

            const currentSettings = roomRef.current.settings || {};
            const kickedNames = currentSettings.kicked_names || [];
            const kickedFingerprints = currentSettings.kicked_fingerprints || [];

            if (!kickedNames.includes(targetPlayer.name)) kickedNames.push(targetPlayer.name);
            if (targetPlayer.fingerprint && !kickedFingerprints.includes(targetPlayer.fingerprint)) kickedFingerprints.push(targetPlayer.fingerprint);

            await supabase.from('rooms').update({
                settings: { ...currentSettings, kicked_names: kickedNames, kicked_fingerprints: kickedFingerprints }
            }).eq('id', roomRef.current.id);

            await supabase.from('players').delete().eq('id', playerId);
            fetchPlayers(roomRef.current.id);
        } catch (err) {
            console.error("Error kicking player:", err);
        }
    }, [fetchPlayers]);

    const timeoutPlayer = useCallback(async (playerId) => {
        if (!currentPlayerRef.current?.is_host || !roomRef.current?.id) return;
        try {
            await supabase.from('players').delete().eq('id', playerId);
            fetchPlayers(roomRef.current.id);
        } catch (err) {
            console.error("Error timing out player:", err);
        }
    }, [fetchPlayers]);

    const markSettingsDirty = useCallback(() => {
        if (!currentPlayerRef.current?.is_host) return;
        lastSettingsUpdateRef.current = Date.now();
    }, []);

    const updateRoomSettings = useCallback(async (newSettings) => {
        if (!currentPlayerRef.current?.is_host || !roomRef.current?.id) return;
        try {
            lastSettingsUpdateRef.current = Date.now();

            // Optimistic Update
            setRoom(prev => {
                if (!prev) return prev;
                const updatedSettings = { ...(prev.settings || {}), ...newSettings };
                return { ...prev, settings: updatedSettings };
            });

            // CRITICAL: Use roomRef to avoid stale closure on rapid updates
            const currentSettings = roomRef.current?.settings || {};
            const fullUpdatedSettings = { ...currentSettings, ...newSettings };

            await supabase.from('rooms').update({ settings: fullUpdatedSettings }).eq('id', roomRef.current.id);
        } catch (err) {
            console.error("Error updating room settings:", err);
            if (roomRef.current?.id) fetchPlayers(roomRef.current.id);
        }
    }, [fetchPlayers]);

    const createRoom = async (hostName, hostAvatar) => {
        if (isProcessing.current) return null;
        isProcessing.current = true;
        isExitingRef.current = false;
        setError(null);

        try {
            // Trigger database cleanup (Stale players & Empty rooms)
            supabase.rpc('cleanup_stale_players').then(() => { });
            const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
            let roomCode = '';
            let isUnique = false;
            let attempts = 0;

            // Collision Check Loop (Generate -> Verify -> Insert -> Verify Again)
            let roomData = null;

            while (!isUnique && attempts < 5) {
                attempts++;
                roomCode = '';
                for (let i = 0; i < 4; i++) roomCode += chars.charAt(Math.floor(Math.random() * chars.length));

                // 1. Pre-Check: Is it taken?
                const { data: existingRooms } = await supabase
                    .from('rooms')
                    .select('id, created_at')
                    .eq('room_code', roomCode);

                if (existingRooms && existingRooms.length > 0) {
                    const now = new Date();
                    const staleThreshold = new Date(now - 4 * 60 * 60 * 1000).getTime();
                    const allStale = existingRooms.every(r => new Date(r.created_at).getTime() < staleThreshold);

                    if (allStale) {
                        console.log("RoomContext: Recycling stale room code:", roomCode);
                        await supabase.from('rooms').delete().eq('room_code', roomCode);
                    } else {
                        continue; // Active room exists, try next code
                    }
                }

                // 2. Attempt Insertion
                const { data: newRoom, error: insertError } = await supabase
                    .from('rooms')
                    .insert([{ room_code: roomCode, status: 'lobby' }])
                    .select()
                    .single();

                if (insertError) {
                    console.warn("RoomContext: Insert failed (constraint?), retrying...", insertError);
                    continue;
                }

                // 3. Post-Check: Did we create a duplicate (Race Condition)?
                const { count: totalCount } = await supabase
                    .from('rooms')
                    .select('id', { count: 'exact', head: true })
                    .eq('room_code', roomCode);

                if (totalCount > 1) {
                    console.warn(`RoomContext: Race condition detected for ${roomCode}! Self-destructing clone ${newRoom.id}.`);
                    await supabase.from('rooms').delete().eq('id', newRoom.id);
                    continue; // Try again
                }

                // Success!
                roomData = newRoom;
                isUnique = true;
            }

            if (!roomData) throw new Error("Failed to generate unique room code. Please try again.");

            // Clear any old sessions for this new code (just in case)
            sessionStorage.removeItem(`room_session_${roomCode}`);
            sessionStorage.removeItem(`explicit_leave_${roomCode}`);

            const encodedAvatar = `${hostAvatar}|${fingerprint}`;
            const { data: playerData, error: playerError } = await supabase.from('players').insert([{ room_id: roomData.id, name: hostName, avatar: encodedAvatar, is_host: true }]).select().single();
            if (playerError) throw playerError;

            const { data: stateData, error: stateError } = await supabase.from('game_state').insert([{ room_id: roomData.id, phase: 'lobby' }]).select().single();
            if (stateError) throw stateError;

            setRoom(roomData);
            setCurrentPlayer(decodePlayer(playerData));
            setPlayers([decodePlayer(playerData)]);
            setOnlinePlayerIds(new Set([playerData.id]));
            setGameState(stateData);
            setNotifications([]); // GHOST V5: Clear past notifications on create
            sessionStorage.setItem(`room_session_${roomCode}`, playerData.id);
            return roomCode;
        } catch (err) {
            console.error('Error creating room:', err);
            setError(err.message);
            return null;
        } finally {
            isProcessing.current = false;
        }
    };

    const joinRoom = async (code, playerName, playerAvatar, isAutoReconnect = false) => {
        const cleanCode = code.trim().toUpperCase();
        isExitingRef.current = false;

        if (sessionStorage.getItem(`explicit_leave_${cleanCode}`)) {
            return false;
        }
        if (room?.room_code === cleanCode && currentPlayer?.id) return true;

        if (pendingJoinRef.current?.code === cleanCode) return pendingJoinRef.current.promise;

        setError(null); // Clear previous error state

        const joinPromise = (async () => {
            try {
                // Find ALL rooms with this code to handle "Split Brain" duplicates (Smart Join)
                const { data: roomCandidates, error: roomError } = await supabase
                    .from('rooms')
                    .select('id, status, settings, created_at, room_code')
                    .eq('room_code', cleanCode)
                    .order('created_at', { ascending: false });

                if (roomError || !roomCandidates || roomCandidates.length === 0) {
                    console.error("RoomContext: Room query error:", roomError);
                    throw new Error("Room not found");
                }

                let roomData = roomCandidates[0];

                // SMART RESOLUTION: If duplicates exist, pick the ACTIVE one
                if (roomCandidates.length > 1) {
                    console.warn(`RoomContext: Split Brain detected! Found ${roomCandidates.length} rooms for code ${cleanCode}. Resolving...`);

                    const candidateIds = roomCandidates.map(r => r.id);
                    const { data: allPlayers } = await supabase.from('players').select('id, room_id, is_host').in('room_id', candidateIds);

                    // Count players per room
                    const counts = {};
                    const hasHost = {};
                    candidateIds.forEach(id => { counts[id] = 0; hasHost[id] = false; });

                    if (allPlayers) {
                        allPlayers.forEach(p => {
                            counts[p.room_id] = (counts[p.room_id] || 0) + 1;
                            if (p.is_host) hasHost[p.room_id] = true;
                        });
                    }

                    // Score Logic: Host (+100) -> Population (+1) -> Newest (Tie-break by sort order)
                    const winner = [...roomCandidates].sort((a, b) => {
                        const scoreA = (hasHost[a.id] ? 100 : 0) + (counts[a.id] || 0);
                        const scoreB = (hasHost[b.id] ? 100 : 0) + (counts[b.id] || 0);
                        if (scoreA !== scoreB) return scoreB - scoreA; // High score first

                        // Tie: Compare timestamps (Newest first)
                        const timeA = new Date(a.created_at).getTime();
                        const timeB = new Date(b.created_at).getTime();
                        return timeB - timeA;
                    })[0];

                    roomData = winner;
                    console.log(`RoomContext: Resolved Split Brain. Winner: ${roomData.id} (Pop: ${counts[roomData.id]}, Host: ${hasHost[roomData.id]}).`);

                    // Cleanup: Delete EMPTY loser rooms to prevent future confusion
                    const losers = roomCandidates.filter(r => r.id !== roomData.id && counts[r.id] === 0);
                    if (losers.length > 0) {
                        console.log("RoomContext: Deleting empty ghost rooms:", losers.map(l => l.id));
                        supabase.from('rooms').delete().in('id', losers.map(l => l.id)).then(() => { });
                    }
                }

                const kickedNames = roomData.settings?.kicked_names || [];
                const kickedFingerprints = roomData.settings?.kicked_fingerprints || [];
                if (kickedNames.includes(playerName.trim()) || kickedFingerprints.includes(fingerprint)) throw new Error("kickedError");

                let existingPlayer = null;
                const storedPlayerId = sessionStorage.getItem(`room_session_${cleanCode}`);

                if (storedPlayerId) {
                    const { data: p } = await supabase.from('players').select('*').eq('id', storedPlayerId).eq('room_id', roomData.id).single();
                    if (p) {
                        existingPlayer = p;
                    } else {
                        // Session exists, but Player is GONE (Timed out / Kicked / Deleted)
                        if (isAutoReconnect) {
                            console.warn("RoomContext: Stale session detected for auto-reconnect. Player removed. Aborting.");
                            sessionStorage.removeItem(`room_session_${cleanCode}`);
                            return false; // Triggers redirect in autoReconnect
                        }
                        // Manual join: Ignore stale session, create new player
                        sessionStorage.removeItem(`room_session_${cleanCode}`);
                    }
                }

                // NEW: Fingerprint Fallback Re-sync
                // If sessionStorage fails (e.g. lost on mobile or cross-tab), check fingerprint
                if (!existingPlayer && fingerprint) {
                    const { data: roomPlayers } = await supabase.from('players').select('*').eq('room_id', roomData.id);
                    existingPlayer = roomPlayers?.find(p => p.avatar && p.avatar.split('|')[1] === fingerprint);
                    if (existingPlayer) {
                        // Ensure we restore the ID to session storage for next time
                        sessionStorage.setItem(`room_session_${cleanCode}`, existingPlayer.id);
                    }
                }

                if (existingPlayer) {
                    // NEW: Prevent host reclamation
                    // If the rejoining player was host, but there is ALREADY an active host
                    // among the other players, strip the flag from the rejoining one.
                    if (existingPlayer.is_host) {
                        const { data: allPlayers } = await supabase.from('players').select('*').eq('room_id', roomData.id);
                        // Is there ANY OTHER online player with is_host: true?
                        // We check onlinePlayerIds from presence, but since we are JOINING, we might not have them yet.
                        // Actually, we can just check if ANY player other than us has is_host: true.
                        // FIX: Only strip if the OTHER host is actually ACTIVE (seen recently)
                        // This prevents stripping if the other record is just a stale ghost.
                        const activeThreshold = new Date();
                        activeThreshold.setSeconds(activeThreshold.getSeconds() - 45);

                        const anotherHost = allPlayers?.find(p =>
                            p.is_host &&
                            p.id !== existingPlayer.id &&
                            new Date(p.last_seen) > activeThreshold
                        );

                        if (anotherHost) {
                            console.log("RoomContext: Throne occupied by ACTIVE host:", anotherHost.name, ". Demoting rejoining player.");
                            await supabase.from('players').update({ is_host: false }).eq('id', existingPlayer.id);
                            existingPlayer.is_host = false;
                        }
                    }

                    // CLEANUP: If there are OTHER records with the same fingerprint in this room, delete them
                    // This prevents "ghost" players from cluttering the room after multiple refreshes
                    if (fingerprint) {
                        try {
                            supabase.from('players').delete()
                                .eq('room_id', roomData.id)
                                .neq('id', existingPlayer.id)
                                .filter('avatar', 'ilike', `%|${fingerprint}`)
                                .then(({ error }) => {
                                    if (error) console.error("RoomContext: Duplicate cleanup error:", error);
                                });
                        } catch (e) { }
                    }

                    if (existingPlayer.name !== playerName || existingPlayer.avatar !== `${playerAvatar}|${fingerprint}`) {
                        await supabase.from('players').update({ name: playerName, avatar: `${playerAvatar}|${fingerprint}` }).eq('id', existingPlayer.id);
                        existingPlayer.name = playerName;
                        existingPlayer.avatar = `${playerAvatar}|${fingerprint}`;
                    }
                    const { data: stateData } = await supabase.from('game_state').select('*').eq('room_id', roomData.id).single();
                    const { data: playersData } = await supabase.from('players').select('*').eq('room_id', roomData.id);

                    setRoom(roomData);
                    setCurrentPlayer(decodePlayer(existingPlayer));
                    setPlayers(playersData ? playersData.map(p => decodePlayer(p)) : [decodePlayer(existingPlayer)]);

                    // OPTIMISTIC ONLINE STATUS: Show players immediately if they were seen recently (avoids 3s presence delay)
                    const now = new Date();
                    const optimisticIds = new Set();
                    if (playersData) {
                        playersData.forEach(p => {
                            const lastSeen = new Date(p.last_seen);
                            // Threshold: 120 seconds (2 minutes) - Very forgiving to prevent "disappearing" players
                            if ((now - lastSeen) / 1000 < 120) optimisticIds.add(p.id);
                        });
                    }
                    optimisticIds.add(existingPlayer.id);
                    setOnlinePlayerIds(optimisticIds);

                    setGameState(stateData || { room_id: roomData.id, phase: 'lobby' }); // Fallback if missing
                    return true;
                }

                // New Join Logic
                const { data: roomPlayers } = await supabase.from('players').select('name').eq('room_id', roomData.id);

                // NEW: Max Players Check
                const maxP = roomData.settings?.maxPlayers || 8;
                if (roomPlayers && roomPlayers.length >= maxP) {
                    throw new Error("roomFull");
                }

                let finalName = playerName.trim();
                let counter = 1;
                while (roomPlayers?.some(p => p.name.toLowerCase() === finalName.toLowerCase())) {
                    counter++;
                    finalName = `${playerName.trim()} (${counter})`;
                }

                const { data: playerData, error: playerError } = await supabase.from('players').insert([{ room_id: roomData.id, name: finalName, avatar: `${playerAvatar}|${fingerprint}`, is_host: false }]).select().single();
                if (playerError) {
                    console.error("RoomContext: Player insert error:", playerError);
                    throw playerError;
                }

                const { data: stateData } = await supabase.from('game_state').select('*').eq('room_id', roomData.id).single();
                const { data: playersData } = await supabase.from('players').select('*').eq('room_id', roomData.id);

                setRoom(roomData);
                const decodedPlayer = decodePlayer(playerData);
                setCurrentPlayer(decodedPlayer);
                currentPlayerRef.current = decodedPlayer; // FIX: Update ref IMMEDIATELY for use in presence callbacks
                setPlayers(playersData ? playersData.map(p => decodePlayer(p)) : [decodePlayer(playerData)]);

                // OPTIMISTIC ONLINE STATUS
                const now = new Date();
                const optimisticIds = new Set();
                if (playersData) {
                    playersData.forEach(p => {
                        const lastSeen = new Date(p.last_seen);
                        // Threshold: 120 seconds (2 minutes)
                        if ((now - lastSeen) / 1000 < 120) optimisticIds.add(p.id);
                    });
                }
                optimisticIds.add(playerData.id);
                setOnlinePlayerIds(optimisticIds);

                setGameState(stateData || { room_id: roomData.id, phase: 'lobby' });
                setNotifications([]); // GHOST V5: Clear past notifications on join
                sessionStorage.setItem(`room_session_${cleanCode}`, playerData.id);
                return true;
            } catch (err) {
                console.error('RoomContext: joinRoom Exception:', err);
                if (err.message === 'kickedError') setError('kickedError');
                else if (err.message === 'roomFull') setError('roomFull');
                else if (err.message === 'Room not found') setError('roomNotFound');
                else if (err.message === 'afkTimeout') setError('afkTimeout');
                else setError('Error joining room');
                return false;
            } finally {
                pendingJoinRef.current = null;
            }
        })();

        pendingJoinRef.current = { code: cleanCode, promise: joinPromise };
        return joinPromise;
    };

    const startGame = async (gameSettings) => {
        if (!room?.id) return;

        // 1. LOCK to prevent the Host Monitor from misfiring while we clear data
        phaseTransitionLock.current = true;

        try {
            // 0. FETCH FRESH TRUTH: Ensure we have the latest player list
            const { data: serverPlayers, error: fetchError } = await supabase
                .from('players')
                .select('*')
                .eq('room_id', room.id);

            if (fetchError || !serverPlayers) {
                console.error("RoomContext: Failed to validate players before start.", fetchError);
                return;
            }

            const freshPlayers = serverPlayers.map(p => decodePlayer(p));

            // 1. FILTER & VALIDATE participant count (Min 2 required)
            const participants = freshPlayers.filter(p => !p.is_spectator);
            if (participants.length < 2) {
                addNotification(t('needsAtLeast2'), "error");
                phaseTransitionLock.current = false;
                return;
            }

            // 2. DATA RESET (DATABASE FIRST): Wipe all stale answers, scores, and votes
            // This prevents the Monitor from seeing old "text:..." entries and instantly winning rounds.
            await supabase.from('players')
                .update({ score: 0, last_answer: null, votes_used: {} })
                .eq('room_id', room.id);

            // 3. DATA RESET (LOCAL STATE)
            // Ensure local UI and monitor see EMPTY answers immediately
            const clearedPlayers = freshPlayers.map(p => ({ ...p, score: 0, last_answer: null, votes_used: {} }));
            setPlayers(clearedPlayers);
            setCurrentPlayer(prev => prev ? { ...prev, score: 0, last_answer: null, votes_used: {} } : prev);

            // Mark local update to block stale echoes from DB subscriptions
            lastPhaseUpdateRef.current = Date.now();

            const roundTime = gameSettings.roundTime || 60;
            const phaseExpiry = Date.now() + (roundTime * 1000) + 1000;

            // 4. GENERATE GAME STATE (Chains, Assignments, Names)
            const isSpectatorMode = gameSettings.spectatorEnabled && participants.length >= 4;
            const playerNames = participants.reduce((acc, p) => { acc[p.id] = p.name; return acc; }, {});

            // Filter participants for chains (exclude host if spectator mode is on)
            let filteredIds = participants
                .filter(p => !isSpectatorMode || !p.is_host)
                .map(p => p.id);

            // SHUFFLE FIX: Truly random start order every game
            let pIds = shuffleArr(filteredIds);

            const chains = {};
            const initialAssignments = {};
            pIds.forEach(pId => {
                const chainId = `chain_${pId}_${Date.now()}`;
                chains[chainId] = { id: chainId, creator_id: pId, history: [] };
                initialAssignments[pId] = chainId;
            });

            // 5. UPDATE ROOM (Optimistic + DB)
            setRoom(prev => ({
                ...prev,
                status: 'playing',
                settings: {
                    ...prev.settings,
                    phase_expiry: phaseExpiry,
                    player_order: pIds,
                    player_names: playerNames,
                    chains,
                    assignments: { 'text': initialAssignments },
                    reveal_chain_index: 0,
                    reveal_step: 0
                }
            }));

            await supabase.from('rooms').update({
                settings: {
                    ...gameSettings,
                    roundTime: gameSettings.roundTime || 60, // Ensure default if not provided
                    voteDuration: gameSettings.voteDuration || 30, // Ensure default if not provided
                    phase_expiry: phaseExpiry,
                    player_order: pIds,
                    player_names: playerNames,
                    chains: chains,
                    assignments: { 'text': initialAssignments },
                    reveal_chain_index: 0,
                    reveal_step: 0
                },
                status: 'playing'
            }).eq('id', room.id);

            // RESET VOTE BUDGETS FOR NEW GAME
            await supabase.from('players').update({ votes_used: {} }).eq('room_id', room.id);
            setPlayers(prev => prev.map(p => ({ ...p, votes_used: {} })));
            setCurrentPlayer(prev => prev ? ({ ...prev, votes_used: {} }) : prev);

            // 6. UPDATE PHASE (Triggering UI Switch)
            setGameState(prev => ({
                ...prev,
                phase: 'text',
                phase_expiry: phaseExpiry
            }));

            await supabase.from('game_state').update({
                phase: 'text',
                phase_expiry: phaseExpiry
            }).eq('room_id', room.id);

        } catch (err) {
            console.error('Error starting game:', err);
        } finally {
            // RELEASE LOCK: Wait for React state to fully settle and DB updates to broadcast
            setTimeout(() => {
                phaseTransitionLock.current = false;
            }, 1000);
        }
    };

    const submitAnswer = useCallback(async (answer) => {
        if (!currentPlayerRef.current?.id || !gameStateRef.current?.phase) return;
        const currentPhase = gameStateRef.current?.phase;

        // Check if answer already has a valid prefix
        let phasePrefixedAnswer = answer;
        const knownPrefixes = ['vote_multi:', 'vote:', 'text:', 'emoji:', 'guess:'];
        const hasPrefix = knownPrefixes.some(p => answer.startsWith(p));

        if (!hasPrefix) {
            phasePrefixedAnswer = currentPhase.startsWith('emoji') ? `emoji:${answer}` :
                currentPhase.startsWith('interpretation') ? `guess:${answer}` :
                    currentPhase === 'vote' ? `vote:${answer}` : `text:${answer}`;
        }

        try {
            // OPTIMISTIC UPDATE: Lock out server echoes for 2 seconds
            lastAnswerUpdateRef.current = Date.now();

            setPlayers(prev => prev.map(p => p.id === currentPlayerRef.current.id ? { ...p, last_answer: phasePrefixedAnswer } : p));
            setCurrentPlayer(prev => prev ? { ...prev, last_answer: phasePrefixedAnswer } : prev);

            const { error } = await supabase.from('players').update({ last_answer: phasePrefixedAnswer }).eq('id', currentPlayerRef.current.id);
            if (error) throw error;
            return { success: true };
        } catch (err) {
            console.error('Error submitting answer:', err);
            return { success: false, error: err };
        }
    }, []);

    // Autosave Draft
    const saveDraft = useCallback(async (draft, phase) => {
        if (!currentPlayerRef.current?.id || !gameStateRef.current?.phase) return;
        const prefix = phase === 'text' ? 'draft:' :
            phase.startsWith('emoji') ? 'draft_emoji:' :
                phase.startsWith('interpretation') ? 'draft_guess:' :
                    phase === 'vote' ? 'draft_vote:' : 'draft:'; // Added vote support

        // Don't save empty drafts
        if (!draft || draft.trim() === '') return;

        // CRITICAL: Never overwrite a submitted answer with a draft
        const currentAns = currentPlayerRef.current?.last_answer || '';
        if (currentAns.startsWith('vote:') || currentAns.startsWith('vote_multi:') ||
            currentAns.startsWith('text:') || currentAns.startsWith('emoji:') || currentAns.startsWith('guess:')) {
            console.log("RoomContext: blocked draft save because player already has a submission.");
            return;
        }

        const fullVal = `${prefix}${draft}`;
        try {
            // Optimistic update locally
            setPlayers(prev => prev.map(p => p.id === currentPlayerRef.current.id ? { ...p, last_answer: fullVal } : p));
            setCurrentPlayer(prev => prev ? { ...prev, last_answer: fullVal } : prev);

            const { error } = await supabase.from('players').update({ last_answer: fullVal }).eq('id', currentPlayerRef.current.id);
            if (error) throw error;
        } catch (err) {
            console.error('Error saving draft:', err);
        }
    }, []);

    const advancePhase = useCallback(async (nextPhase, skipGrace = false) => {
        if (!currentPlayerRef.current?.is_host || !roomRef.current?.id) return;

        if (phaseTransitionLock.current || gameStateRef.current?.phase === nextPhase) {
            console.warn(`RoomContext: Phase transition to ${nextPhase} blocked (Lock: ${phaseTransitionLock.current}, Current: ${gameStateRef.current?.phase})`);
            return;
        }
        phaseTransitionLock.current = true;
        // Mark local update to block stale echoes
        lastPhaseUpdateRef.current = Date.now();

        try {
            console.log(`RoomContext: Advancing phase to ${nextPhase}...`);
            const currentRoom = roomRef.current;
            const currentGameState = gameStateRef.current;

            let duration = 60;
            if (nextPhase.startsWith('text') || nextPhase.startsWith('emoji') || nextPhase.startsWith('interpretation')) {
                duration = currentRoom.settings?.roundTime || 60;
            } else if (nextPhase === 'vote') {
                duration = currentRoom.settings?.voteDuration || 30;
            }

            let phaseExpiry = null;
            if (nextPhase !== 'reveal' && nextPhase !== 'lobby' && nextPhase !== 'scoreboard' && nextPhase !== 'winner') {
                phaseExpiry = Date.now() + (duration * 1000) + 1000;
            }

            // SMART SYNC: Skip the 4s grace period for purely navigational phases
            const navigationalPhases = ['vote', 'scoreboard', 'lobby', 'winner'];
            if (navigationalPhases.includes(nextPhase)) {
                skipGrace = true;
            }

            const currentPhase = currentGameState?.phase;
            let syncPlayers = playersRef.current;
            let phaseAnswers = {};
            const brokenChains = new Set();
            const playerOrderToRecord = currentRoom?.settings?.player_order || [];

            // 1. DATA SYNCHRONIZATION (Only for gameplay phases)
            const isGameplayRound = currentPhase.startsWith('text') || currentPhase.startsWith('emoji') || currentPhase.startsWith('interpretation') || currentPhase === 'vote';

            // OPTIMISTIC UPDATE: Update gameState immediately for the host to provide instant feedback
            const nextGameState = { ...currentGameState, phase: nextPhase, phase_expiry: phaseExpiry || currentGameState.phase_expiry };
            setGameState(nextGameState);

            if (isGameplayRound) {
                const needsDelay = !skipGrace;
                if (needsDelay) {
                    const onlinePlayingIds = playerOrderToRecord.filter(id => onlinePlayerIdsRef.current.has(id));

                    const checkReadiness = (playerList) => {
                        return onlinePlayingIds.filter(id => {
                            const p = playerList.find(pd => pd.id === id);
                            if (!p?.last_answer) return false;
                            const ans = p.last_answer;
                            if (currentPhase === 'text') return ans.startsWith('text:') || ans.startsWith('draft:');
                            if (currentPhase.startsWith('emoji')) return ans.startsWith('emoji:') || ans.startsWith('draft_emoji:');
                            if (currentPhase.startsWith('interpretation')) return ans.startsWith('guess:') || ans.startsWith('draft_guess:');
                            if (currentPhase === 'vote') return ans.startsWith('vote:') || ans.startsWith('vote_multi:');
                            return false;
                        }).length;
                    };

                    const localReadyCount = checkReadiness(playersRef.current);
                    if (localReadyCount >= onlinePlayingIds.length) {
                        syncPlayers = playersRef.current;
                    } else {
                        const startTime = Date.now();
                        const maxWait = 2500; // Decreased from 4000ms for snappier feel
                        const pollInterval = 100;
                        let latestFetchedPlayers = [];

                        while (Date.now() - startTime < maxWait) {
                            const { data: pollData, error: pollError } = await supabase.from('players').select('*').eq('room_id', currentRoom.id);
                            if (!pollError && pollData) {
                                latestFetchedPlayers = pollData;
                                if (checkReadiness(pollData) >= onlinePlayingIds.length) {
                                    break;
                                }
                            }
                            await new Promise(r => setTimeout(r, pollInterval));
                        }

                        if (latestFetchedPlayers.length > 0) {
                            syncPlayers = latestFetchedPlayers.map(p => {
                                const decoded = decodePlayer(p);
                                const localP = playersRef.current.find(lp => lp.id === decoded.id);
                                const dbAns = decoded.last_answer || "";
                                const localAns = localP?.last_answer || "";

                                const getRank = (a) => {
                                    if (!a || a.trim() === "") return 0;
                                    const hasColon = a.includes(':');
                                    const expectedPrefixOverrides = {
                                        'text': ['text:', 'draft:'],
                                        'emoji': ['emoji:', 'draft_emoji:'],
                                        'interpretation': ['guess:', 'draft_guess:'],
                                        'vote': ['vote:', 'vote_multi:']
                                    };
                                    const pKey = Object.keys(expectedPrefixOverrides).find(k => (currentPhase || "").startsWith(k));
                                    if (pKey) {
                                        const valid = expectedPrefixOverrides[pKey];
                                        if (hasColon && !valid.some(v => a.startsWith(v))) return -1;
                                    }
                                    if (a.startsWith('draft')) return 1;
                                    if (hasColon) return 2;
                                    return 1;
                                };

                                const rankDB = getRank(dbAns);
                                const rankLocal = getRank(localAns);
                                let finalAns = dbAns;
                                if (rankLocal > rankDB) finalAns = localAns;
                                else if (rankLocal === rankDB && String(localAns).length > String(dbAns).length) finalAns = localAns;

                                if (finalAns !== dbAns) return { ...p, ...decoded, last_answer: finalAns };
                                return { ...p, ...decoded };
                            });

                            if (syncPlayers.length < playerOrderToRecord.length) {
                                playerOrderToRecord.forEach(id => {
                                    if (!syncPlayers.find(sp => sp.id === id)) {
                                        const lp = playersRef.current.find(l => l.id === id);
                                        if (lp) syncPlayers.push(lp);
                                    }
                                });
                            }
                        }
                    }
                }

                // 2. EXTRACT ANSWERS & CALCULATE BROKEN CHAINS
                const currentAssignments = currentRoom.settings?.assignments?.[currentPhase] || {};
                phaseAnswers = playerOrderToRecord.reduce((acc, pId) => {
                    const p = syncPlayers.find(sp => sp.id === pId) || playersRef.current.find(lp => lp.id === pId);
                    if (!p) return acc;
                    let ans = p.last_answer;
                    const hasFreshAns = ans && !ans.startsWith('draft');
                    const isTrulyOffline = !onlinePlayerIdsRef.current.has(pId) && !playersRef.current.find(lp => lp.id === pId) && !hasFreshAns;
                    const isOnline = !isTrulyOffline;

                    let isValid = false;
                    if (currentPhase === 'text') {
                        let content = '';
                        if (ans && (ans.startsWith('text:') || ans.startsWith('draft:'))) content = ans.split(':').slice(1).join(':');
                        else if (ans && !ans.includes(':')) content = ans;

                        if (content && content.trim()) {
                            ans = `text:${content.trim()}`;
                            isValid = true;
                        } else {
                            ans = isOnline
                                ? "text:I was too busy thinking of something brilliant! ✨"
                                : "text:Ghost writer took over! (Player disconnected) 👻";
                            isValid = true;
                        }
                    } else if (currentPhase.startsWith('emoji')) {
                        let content = '';
                        if (ans && (ans.startsWith('emoji:') || ans.startsWith('draft_emoji:'))) content = ans.split(':').slice(1).join(':');
                        if (content && content.trim()) {
                            ans = `emoji:${content.trim()}`;
                            isValid = true;
                        } else {
                            ans = isOnline ? "emoji:❓🤔✨" : "emoji:👻❌❓";
                            isValid = true;
                        }
                    } else if (currentPhase.startsWith('interpretation')) {
                        let content = '';
                        if (ans && (ans.startsWith('guess:') || ans.startsWith('draft_guess:'))) content = ans.split(':').slice(1).join(':');
                        if (content && content.trim()) {
                            ans = `guess:${content.trim()}`;
                            isValid = true;
                        } else {
                            ans = isOnline
                                ? "guess:Clearly a masterpiece, though my mind is blank! 🎨"
                                : "guess:A mystery lost to the phantom realm... (Disconnected) 🌫️";
                            isValid = true;
                        }
                    } else if (currentPhase === 'vote') {
                        isValid = true;
                        if (!ans) ans = '';
                    }

                    if (!isValid) {
                        const affectedChainId = currentAssignments[pId];
                        if (affectedChainId) brokenChains.add(affectedChainId);
                        ans = null;
                    }
                    acc[pId] = ans;
                    return acc;
                }, {});
            }

            // 3. PREPARE NEXT SETTINGS
            const { data: latestRoomData } = await supabase.from('rooms').select('settings').eq('id', currentRoom.id).single();
            const dbSettings = latestRoomData?.settings || currentRoom.settings || {};
            const activeChains = { ...(dbSettings.chains || {}) };
            let nextSettings = { ...dbSettings, phase: nextPhase, phase_expiry: phaseExpiry || dbSettings.phase_expiry };

            // Record History into Chains: Ensure EVERY chain advances every round.
            // If a player hasn't submitted (slow or offline), generate a GHOST FALLBACK.
            if (currentPhase.startsWith('text') || currentPhase.startsWith('emoji') || currentPhase.startsWith('interpretation')) {
                // Cache player names for RevealPhase
                const currentNames = { ...(dbSettings.player_names || {}) };
                playersRef.current.forEach(p => {
                    if (p.id && p.name) currentNames[p.id] = p.name;
                });
                nextSettings.player_names = currentNames;

                const currentAssignments = dbSettings.assignments?.[currentPhase] || {};

                // Iterate over ALL active chains in the room
                Object.keys(activeChains).forEach(chainId => {
                    // Find who was assigned to this chain
                    const playerId = Object.keys(currentAssignments).find(pId => currentAssignments[pId] === chainId);
                    let content = playerId ? phaseAnswers[playerId] : null;

                    // Clean prefix if exists
                    if (content && content.includes(':')) {
                        content = content.split(':').slice(1).join(':').trim();
                    }

                    // GHOST V5: Robust Fallback Generation
                    if (!content) {
                        const isOnline = playerId && onlinePlayerIdsRef.current.has(playerId);
                        if (currentPhase.startsWith('text')) {
                            content = isOnline
                                ? "Too busy thinking of something brilliant! ✨"
                                : "Ghost writer took over! (Disconnected) 👻";
                        } else if (currentPhase.startsWith('emoji')) {
                            content = isOnline ? "❓🤔✨" : "👻❌❓";
                        } else if (currentPhase.startsWith('interpretation')) {
                            content = isOnline
                                ? "Clearly a masterpiece, though my mind is blank! 🎨"
                                : "A mystery lost in the phantom realm... 🌫️";
                        }
                    }

                    if (activeChains[chainId]) {
                        activeChains[chainId].history.push({
                            phase: currentPhase,
                            playerId: playerId || 'ghost_player',
                            content: content
                        });
                    }
                });

                nextSettings.chains = activeChains;
                nextSettings.history = { ...(nextSettings.history || {}), [currentPhase]: phaseAnswers };
            } else if (currentPhase === 'vote') {
                nextSettings.history = { ...(nextSettings.history || {}), [currentPhase]: phaseAnswers };
            }
            const currentNames = { ...(nextSettings.player_names || {}) };
            playersRef.current.forEach(p => { if (p.name) currentNames[p.id] = p.name; });
            nextSettings.player_names = currentNames;

            // 4. GENERATE ASSIGNMENTS
            const allLegalPhases = ['text', 'emoji_1', 'interpretation_1', 'emoji_2', 'interpretation_2', 'emoji_3', 'emoji_4', 'emoji_5'];
            if (allLegalPhases.includes(nextPhase)) {
                let playingIds = [];
                if (nextPhase === 'text') {
                    const isSpecMode = nextSettings.spectatorEnabled && syncPlayers.length >= 4;
                    // SHUFFLE FIX: Randomized order for initial text phase
                    let newOrder = shuffleArr(syncPlayers
                        .filter(p => !isSpecMode || !p.is_host)
                        .filter(p => (onlinePlayerIdsRef.current.has(p.id) || p.id === currentPlayerRef.current?.id))
                        .map(p => p.id));

                    playingIds = newOrder;

                    const textAssignments = {};
                    const newChains = {};
                    playingIds.forEach(id => {
                        const chainId = `chain_${id}_${Date.now()}`;
                        newChains[chainId] = { id: chainId, creator_id: id, history: [] };
                        textAssignments[id] = chainId;
                    });
                    nextSettings.player_order = playingIds;
                    nextSettings.assignments = { 'text': textAssignments };
                    nextSettings.history = {};
                    nextSettings.chains = newChains;
                    await supabase.from('players').update({ last_answer: null }).eq('room_id', currentRoom.id);
                } else {
                    const prevPlayingIds = dbSettings.player_order || [];
                    // GHOST V5: Keep every player who has ever been in the game order.
                    // This ensures their "ghost" can still be assigned a chain.
                    playingIds = prevPlayingIds;

                    const allChainIds = Object.keys(activeChains);

                    // GHOST V5: Use ALL active chains to ensure none are left behind.
                    let chainsToUse = [...allChainIds];

                    // Match participant count to chain count (safety)
                    if (chainsToUse.length > playingIds.length) {
                        chainsToUse = chainsToUse.slice(0, playingIds.length);
                    }

                    const allAssignments = { ...(nextSettings.assignments || {}) };

                    // Attempt high-entropy random assignment with the SELECTED chains
                    console.log(`RoomContext: [GHOST V5] Assigning ${playingIds.length} original participants to ${chainsToUse.length} chains.`);
                    const randomAssignments = generateRandomAssignments(playingIds, activeChains, chainsToUse);

                    if (randomAssignments) {
                        allAssignments[nextPhase] = randomAssignments;
                    } else {
                        // Fallback to simple rotation if complex solving fails
                        console.warn("RoomContext: Random assignment failed, falling back to basic rotation.");
                        const fallbackAssignments = {};
                        playingIds.forEach((pId, idx) => {
                            const chainId = chainsToUse[idx];
                            if (chainId) fallbackAssignments[pId] = chainId;
                        });
                        allAssignments[nextPhase] = fallbackAssignments;
                    }

                    nextSettings.assignments = allAssignments;
                    nextSettings.player_order = playingIds; // Sync playing IDs
                    await supabase.from('players').update({ last_answer: null }).in('id', playingIds);
                }
            }

            if (nextPhase === 'reveal') {
                nextSettings.reveal_step = 0;
                nextSettings.reveal_chain_index = 0;
            }

            if (nextPhase === 'lobby') {
                nextSettings.history = {};
                nextSettings.assignments = {};
                nextSettings.player_order = [];
            }

            const isGameplay = nextPhase.startsWith('text') || nextPhase.startsWith('emoji') || nextPhase.startsWith('interpretation') || nextPhase === 'vote';
            if (isGameplay) {
                await supabase.from('players').update({ last_answer: null }).eq('room_id', currentRoom.id);
                setPlayers(prev => prev.map(p => ({ ...p, last_answer: null })));
            }

            const promises = [];
            const roomUpdate = { settings: nextSettings };
            if (nextPhase === 'lobby') {
                roomUpdate.status = 'lobby';
            }
            promises.push(supabase.from('rooms').update(roomUpdate).eq('id', currentRoom.id));

            promises.push(supabase.from('game_state').update({
                phase: nextPhase,
                timer: duration,
                phase_expiry: phaseExpiry
            }).eq('room_id', currentRoom.id));

            if (currentPhase === 'vote' && nextPhase === 'scoreboard') {
                console.log("RoomContext: Calculating scores from votes...");
                const scoreDelta = {};
                const usageDelta = {};

                Object.entries(phaseAnswers).forEach(([voterId, voteStr]) => {
                    if (!voteStr) return;
                    let votesToProcess = [];
                    if (voteStr.startsWith('vote_multi:')) {
                        try {
                            const jsonPart = voteStr.substring('vote_multi:'.length);
                            votesToProcess = JSON.parse(jsonPart);
                        } catch (e) { console.error("RoomContext: Failed to parse multi-vote", e); }
                    } else if (voteStr.includes(':')) {
                        const parts = voteStr.split(':');
                        votesToProcess.push({
                            category: parts.length === 3 ? parts[1] : parts[0],
                            targetId: parts.length === 3 ? parts[2] : parts[1]
                        });
                    }
                    votesToProcess.forEach(({ category, targetId }) => {
                        if (!scoreDelta[targetId]) scoreDelta[targetId] = 0;
                        if (category === 'funniest') scoreDelta[targetId] += 1;
                        else if (category === 'mostAccurate') scoreDelta[targetId] += 2;
                        else if (category === 'mostDestroyed') scoreDelta[targetId] -= 1;
                        if (!usageDelta[voterId]) usageDelta[voterId] = {};
                        if (!usageDelta[voterId][category]) usageDelta[voterId][category] = 0;
                        usageDelta[voterId][category] += 1;
                    });
                });

                const updates = playersRef.current.map(p => {
                    const currentScore = p.score || 0;
                    const delta = scoreDelta[p.id] || 0;
                    let newScore = currentScore + delta;
                    if (newScore < 0) newScore = 0;
                    const currentUsage = p.votes_used || {};
                    const myUsageDelta = usageDelta[p.id] || {};
                    const newUsage = { ...currentUsage };
                    Object.keys(myUsageDelta).forEach(cat => {
                        newUsage[cat] = (newUsage[cat] || 0) + myUsageDelta[cat];
                    });
                    return { id: p.id, score: newScore, votes_used: newUsage };
                });
                promises.push(...updates.map(update =>
                    supabase.from('players').update({ score: update.score, votes_used: update.votes_used }).eq('id', update.id)
                ));
            }

            console.log("RoomContext: Optimistically updating local state to:", nextPhase);
            setGameState(prev => ({
                ...prev,
                phase: nextPhase,
                timer: duration,
                phase_expiry: phaseExpiry
            }));
            const finalRoom = prev => prev ? ({ ...prev, ...roomUpdate }) : prev;
            setRoom(finalRoom);

            await Promise.all(promises);

            if (nextPhase === 'lobby') {
                console.log("RoomContext: Post-transition score reset for Lobby.");
                await supabase.from('players').update({ score: 0, last_answer: null }).eq('room_id', currentRoom.id);
                setPlayers(prev => prev.map(p => ({ ...p, score: 0, last_answer: null })));
                setCurrentPlayer(prev => prev ? { ...prev, score: 0, last_answer: null } : prev);
            }
            setPlayers(prev => prev.map(p => ({ ...p, last_answer: null })));

        } catch (err) {
            console.error('Error advancing phase:', err);
        } finally {
            setTimeout(() => {
                phaseTransitionLock.current = false;
            }, 1000);
        }
    }, []);

    useEffect(() => {
        if (!gameState?.phase || !room?.id || !room?.room_code || isExitingRef.current) return;

        // PHASE GUARD: Prevent backwards/stale navigation
        const currentP = gameState.phase;
        const currentWeight = phasePriority[currentP] ?? -1;

        // If we are moving backwards (and it's not a restart to lobby or a new round), block it.
        // This prevents the "wrong page" bug caused by late DB echoes of old phases.
        const isLobbyRestart = currentP === 'lobby';
        const isNewRound = currentP === 'text' && lastHighPhaseRef.current >= phasePriority['scoreboard'];

        if (currentWeight < lastHighPhaseRef.current && !isLobbyRestart && !isNewRound) {
            console.warn(`RoomContext: Blocking stale navigation from ${currentP} as we have already reached weight ${lastHighPhaseRef.current}`);
            return;
        }

        lastHighPhaseRef.current = currentWeight;

        // DEBOUNCE: Add a tiny delay to ensure all state chunks (room + players) have arrived
        const timerId = setTimeout(() => {
            // EXCLUDE: Don't force navigation if on main menus or setup
            const path = location.pathname;
            const isSetupPath = ['/', '/join-room', '/avatar-selection', '/how-to-play', '/terms'].includes(path);
            if (isSetupPath) return;

            // ONLY AUTO-NAVIGATE if the player has fully joined (has a name)
            if (!currentPlayer?.name) return;

            // Prevent redundant navigation to the same phase we are already on
            if (lastNavigatedPhaseRef.current === currentP && !isSetupPath) {
                // Check if current path already matches expected path for this phase
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

            // STAGGERED RENDERING: Decouple routing from synchronous DB state updates
            requestAnimationFrame(() => {
                switch (currentP) {
                    case 'text': navigate(target('/text-phase'), { replace: true }); break;
                    case 'emoji_1':
                    case 'emoji_2':
                    case 'emoji_3':
                        navigate(target('/emoji-phase'), { replace: true }); break;
                    case 'interpretation_1':
                    case 'interpretation_2':
                        navigate(target('/interpretation-phase'), { replace: true }); break;
                    case 'reveal': navigate(target('/reveal-phase'), { replace: true }); break;
                    case 'vote': navigate(target('/vote'), { replace: true }); break;
                    case 'scoreboard': navigate(target('/scoreboard'), { replace: true }); break;
                    case 'winner': navigate(target('/game-winner'), { replace: true }); break;
                    case 'lobby': navigate(target('/lobby'), { replace: true }); break;
                    default: break;
                }
                lastNavigatedPhaseRef.current = currentP;
            });
        }, 50); // 50ms stabilization delay

        return () => clearTimeout(timerId);
    }, [gameState?.phase, navigate, room?.id, room?.room_code, location.pathname, currentPlayer?.name]);

    useEffect(() => {
        if (!isHost || !room?.id || !players.length || ['lobby', 'reveal', 'scoreboard'].includes(gameState?.phase)) return;

        // INSTANT END: If only 1 playing player remains, go to scoreboard immediately
        // Check if we are in an active gameplay phase (not reveal/scoreboard/lobby)
        const currentPhasePhase = gameState?.phase;
        const inGameplay = !['lobby', 'reveal', 'scoreboard', 'winner'].includes(currentPhasePhase);
        const playingIds = room?.settings?.player_order || [];
        // Presence Resilience: If onlinePlayerIds is empty, we might have a sync issue. 
        // Fallback to trusting the players list for gameplay progression if presence seems dead.
        const isPresenceFailing = onlinePlayerIds.size === 0;
        const activePlayingPlayers = playingIds.filter(id => isPresenceFailing || onlinePlayerIds.has(id));

        if (inGameplay && activePlayingPlayers.length < 2) {
            console.log("RoomContext: CRITICAL - Only", activePlayingPlayers.length, "playing players online. Adding 1s grace before jumping to scoreboard...");
            // Non-blocking timeout to allow drafts to arrive
            setTimeout(() => {
                if (room?.id) advancePhase('scoreboard', true); // Skip grace period
            }, 1000);
            return;
        }

        const currentPhase = gameState?.phase;
        const isEmojiOnly = room?.settings?.selectedMode === 'Emoji Only';

        // Update prefix logic for multi-round
        const prefix = currentPhase.startsWith('emoji') ? 'emoji:' :
            currentPhase.startsWith('interpretation') ? 'guess:' :
                currentPhase === 'vote' ? 'vote' : // Change from 'vote:' to 'vote' to match 'vote_multi:' too
                    (currentPhase === 'text' ? 'text:' :
                        (isEmojiOnly ? 'emoji:' : 'text:')); // Safety fallback

        // Check readiness of online players only
        const onlinePlayingPlayers = players.filter(p => playingIds.includes(p.id) && (isPresenceFailing || onlinePlayerIds.has(p.id)));
        const allReady = onlinePlayingPlayers.length > 0 && onlinePlayingPlayers.every(p => {
            if (!p.last_answer) return false;
            // For voting, check for both vote: and vote_multi:
            if (currentPhase === 'vote') {
                return p.last_answer.startsWith('vote:') || p.last_answer.startsWith('vote_multi:');
            }
            return p.last_answer.startsWith(prefix);
        });

        if (allReady && activePlayingPlayers.length >= 2) {
            console.log("RoomContext: All online players ready! Advancing phase...");
            const nextP = getNextPhase(gameState.phase);
            if (nextP) advancePhase(nextP, true);
        }
    }, [players, isHost, gameState?.phase, room?.id, onlinePlayerIds]);

    // INTEGRITY CHECK: Host cleans up player_order if someone leaves
    // CRITICAL: Only perform this check in LOBBY or SCOREBOARD/WINNER phases
    // If done during gameplay, it shifts indices and breaks the chain rotation
    useEffect(() => {
        const canClean = ['lobby', 'scoreboard', 'winner'].includes(gameState?.phase);
        if (!isHost || !room?.id || !room?.settings?.player_order || players.length === 0 || !canClean) return;

        const currentOrder = room.settings.player_order;
        const activeIds = new Set(players.map(p => p.id));

        // Filter out IDs that are no longer in the room
        const cleanOrder = currentOrder.filter(id => activeIds.has(id));

        // Detect if changes are needed
        if (cleanOrder.length !== currentOrder.length) {
            console.log("RoomContext: Integrity Check - Cleaning up player_order (Found ghosts)",
                { before: currentOrder, after: cleanOrder });

            // Push update to DB
            const newSettings = { ...room.settings, player_order: cleanOrder };

            // Optimistic update locally to prevent jitter
            setRoom(prev => ({ ...prev, settings: newSettings }));

            supabase.from('rooms').update({ settings: newSettings }).eq('id', room.id)
                .then(({ error }) => {
                    if (error) console.error("RoomContext: Failed to update integrity check", error);
                });
        }
    }, [players, isHost, room?.id, room?.settings?.player_order]);

    const checkRoomExists = async (code) => {
        try {
            const { data: roomData, error } = await supabase.from('rooms').select('*').eq('room_code', code.trim().toUpperCase()).single();
            if (error || !roomData) return null;

            const { count } = await supabase.from('players').select('id', { count: 'exact', head: true }).eq('room_id', roomData.id);
            return { ...roomData, playerCount: count || 0 };
        } catch (err) {
            return null;
        }
    };

    const updatePlayerProfile = async (playerId, newName, newAvatar) => {
        try {
            await supabase.from('players').update({ name: newName, avatar: `${newAvatar} | ${fingerprint}` }).eq('id', playerId);
            setCurrentPlayer(prev => prev ? { ...prev, name: newName, avatar: newAvatar } : prev);
            return true;
        } catch (err) {
            return false;
        }
    };

    const leaveRoom = async (explicit = false) => {
        console.log("RoomContext: leaveRoom triggered, explicit:", explicit);
        if (explicit) {
            isExitingRef.current = true;
            // INSTANT NAVIGATION: Don't wait for DB if we are explicitly leaving
            // This prevents the "flash of loading screen" or "left the room" transient views.
            navigate('/', { replace: true });
        }

        const currentRoomCode = room?.room_code || roomRef.current?.room_code;
        const currentRoomId = room?.id || roomRef.current?.id;
        const currentId = currentPlayer?.id || currentPlayerRef.current?.id;

        // Reset game path tracker
        lastInGamePathRef.current = null;

        // Force removal of code from URL
        const params = new URLSearchParams(window.location.search);
        if (params.has('code')) {
            params.delete('code');
            navigate(location.pathname, { replace: true });
        }

        try {
            // 1. Delete Player FIRST (Network Call)
            if (currentId) {
                const currentPhase = gameState?.phase || gameStateRef.current?.phase;
                const isEndPhase = ['winner', 'scoreboard'].includes(currentPhase);
                const isPlaying = room?.status === 'playing' || roomRef.current?.status === 'playing';

                // It is only considered "mid-game" if the room is playing AND we are NOT in an end phase.
                const isMidGame = isPlaying && !isEndPhase;

                // GHOST V5: Never delete player row mid-game.
                // This allows for reconnection and keeps their history/drafts safe.
                if (!isMidGame) {
                    console.log("RoomContext: Deleting player row for exit (Lobby/Endgame).");
                    await supabase.from('players').delete().eq('id', currentId);
                } else {
                    console.log("RoomContext: Soft-leave mid-game. Skipping row deletion for reconnection support.");
                }
            }

            // 2. Check if Room is Empty and Delete
            if (currentRoomId) {
                const { count, error } = await supabase
                    .from('players')
                    .select('*', { count: 'exact', head: true })
                    .eq('room_id', currentRoomId);

                if (!error && count === 0) {
                    console.log("RoomContext: Room is empty, deleting room:", currentRoomId);
                    await supabase.from('rooms').delete().eq('id', currentRoomId);
                    await supabase.from('game_state').delete().eq('room_id', currentRoomId);
                }
            }
        } catch (err) {
            console.error('Error leaving room (DB):', err);
        }

        // 3. Clear Local State & Session (UI Update)
        setRoom(null);
        setPlayers([]);
        setGameState(null);
        setCurrentPlayer(null);
        setError(null); // Clear any fatal error states immediately

        // Clear Session Storage
        if (currentRoomCode) {
            sessionStorage.removeItem(`room_session_${currentRoomCode}`);
            if (explicit) sessionStorage.setItem(`explicit_leave_${currentRoomCode}`, 'true');
        }

        // Safety: Clear ALL room sessions
        Object.keys(sessionStorage).forEach(key => {
            if (key.startsWith('room_session_')) {
                sessionStorage.removeItem(key);
            }
        });
    };

    // HOST CHECK: Ensure someone is host (Auto-promote if missing)
    // Stability Buffer: Wait 5s before promoting to allow for refreshes
    useEffect(() => {
        if (!room?.id || players.length === 0) return;

        // Cancel any pending promotion if we see an ONLINE host
        const activeHost = players.find(p => p.is_host && onlinePlayerIds.has(p.id));
        if (activeHost) {
            if (hostCheckBuffer.current) {
                console.log("RoomContext: Online host detected, cancelling promotion.");
                clearTimeout(hostCheckBuffer.current);
                hostCheckBuffer.current = null;
            }
            return;
        }

        // If no host and no pending check, start buffer
        // ADAPTIVE BUFFER:
        // - If NO host record exists at all (they left): 0.5s for snappy transfer.
        // - If host record exists but they are offline: 5s to allow for reloads.
        const hostExists = players.some(p => p.is_host);

        // LOBBY TRUCE: If in lobby and host simply went offline (but is still in DB), wait for full timeout.
        if (roomRef.current?.status === 'lobby' && hostExists) {
            if (hostCheckBuffer.current) {
                clearTimeout(hostCheckBuffer.current.id);
                hostCheckBuffer.current = null;
            }
            console.log("RoomContext: Host is offline in Lobby. Waiting for timeout removal before transfer.");
            return;
        }

        const bufferMs = hostExists ? 5000 : 500;

        // NEW: If duration is different than what we expected (e.g. from 5s down to 0.5s), reset it!
        if (hostCheckBuffer.current && hostCheckBuffer.current.duration !== bufferMs) {
            console.log(`RoomContext: Host state changed.Switching buffer from ${hostCheckBuffer.current.duration}ms to ${bufferMs}ms.`);
            clearTimeout(hostCheckBuffer.current.id);
            hostCheckBuffer.current = null;
        }

        if (!hostCheckBuffer.current) {
            console.log(`RoomContext: No online host detected.Starting ${bufferMs}ms buffer(Host record exists: ${hostExists})...`);
            const timerId = setTimeout(() => {
                console.log("RoomContext: Buffer expired. Promoting new host.");

                // Re-check one last time: Is there an ONLINE host now?
                const currentPlayers = playersRef.current;
                const currentOnlineIds = onlinePlayerIdsRef.current; // access fresh ref
                const currentOnlineHost = currentPlayers.find(p => p.is_host && currentOnlineIds.has(p.id));

                if (!currentOnlineHost) {
                    console.log("RoomContext: Still no online host. Finding candidate...");
                    // Prefer manual host anchor if set AND online
                    const manualHostId = roomRef.current?.settings?.manual_host_id;
                    const manualCandidate = currentPlayers.find(p => p.id === manualHostId && currentOnlineIds.has(p.id));

                    if (manualCandidate) {
                        console.log("RoomContext: Promoting manual host anchor:", manualCandidate.name);
                        promotePlayerToHost(manualCandidate.id);
                    } else {
                        // Fallback: Oldest online player
                        const onlinePlayingPlayers = currentPlayers.filter(p => currentOnlineIds.has(p.id));
                        const oldest = onlinePlayingPlayers.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))[0];

                        if (oldest) {
                            console.log("RoomContext: Auto-promoting oldest online player:", oldest.name);
                            promotePlayerToHost(oldest.id);
                        } else {
                            console.warn("RoomContext: No online players found to promote!", { onlineCount: currentOnlineIds.size });
                        }
                    }
                }
                hostCheckBuffer.current = null;
            }, bufferMs);

            hostCheckBuffer.current = { id: timerId, duration: bufferMs };
        }
    }, [players, room?.id, onlinePlayerIds]);

    const clearError = useCallback(() => setError(null), []);

    const contextValue = useMemo(() => ({
        room, players, gameState, currentPlayer, error, onlinePlayerIds, notifications,
        createRoom, joinRoom, startGame, checkRoomExists, updatePlayerProfile, leaveRoom, clearError,
        promotePlayerToHost, kickPlayer, updateRoomSettings, markSettingsDirty,
        submitAnswer, saveDraft, advancePhase, refreshRoomState, addNotification, removeNotification,
        isHost: currentPlayer?.is_host,
        isSpectator: !!(room?.settings?.player_order?.length > 0 && currentPlayer?.id && !room.settings.player_order.includes(currentPlayer.id))
    }), [
        room, players, gameState, currentPlayer, error, onlinePlayerIds, notifications,
        joinRoom, startGame, checkRoomExists, updatePlayerProfile, leaveRoom, clearError,
        promotePlayerToHost, kickPlayer, updateRoomSettings, markSettingsDirty,
        submitAnswer, saveDraft, advancePhase, refreshRoomState, addNotification, removeNotification
    ]);

    return (
        <RoomContext.Provider value={contextValue}>
            {children}
        </ RoomContext.Provider>
    );
}

export const useRoom = () => useContext(RoomContext);
