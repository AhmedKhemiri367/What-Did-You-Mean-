import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { decodePlayer, getPhasePriority } from './roomUtils';
import { useLanguage } from '../LanguageContext';

export const useRoomSync = (room, currentPlayerRef, playersRef, roomRef, onlinePlayerIdsRef, gameStateRef, setRoom, setPlayers, setCurrentPlayer, setGameState, isExitingRef, addNotification) => {
    const { t } = useLanguage();
    const [onlinePlayerIds, setOnlinePlayerIds] = useState(new Set());
    const [awayPlayerIds, setAwayPlayerIds] = useState(new Set());
    const [error, setError] = useState(null);

    const channelRef = useRef(null);
    const subscriptionStartTime = useRef(0);
    const lastSettingsUpdateRef = useRef(0);
    const lastAnswerUpdateRef = useRef(0);
    const lastPhaseUpdateRef = useRef(0);

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
                console.warn("useRoomSync: Game state not found during fetchPlayers. Initializing...");
                const fallbackState = { room_id: roomId, phase: 'lobby' };
                setGameState(fallbackState);
            }
        } catch (err) {
            console.error("useRoomSync: fetchPlayers error:", err);
        }
    }, [currentPlayerRef, setPlayers, setCurrentPlayer, setGameState]);

    const refreshRoomState = useCallback(async () => {
        if (roomRef.current?.id) await fetchPlayers(roomRef.current.id);
    }, [fetchPlayers, roomRef]);

    const markSettingsDirty = useCallback(() => {
        if (!currentPlayerRef.current?.is_host) return;
        lastSettingsUpdateRef.current = Date.now();
    }, [currentPlayerRef]);

    const markPhaseDirty = useCallback(() => {
        lastPhaseUpdateRef.current = Date.now();
    }, []);

    const markAnswerDirty = useCallback(() => {
        lastAnswerUpdateRef.current = Date.now();
    }, []);

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
            if (channelRef.current && currentPlayerRef.current?.id) {
                console.log("useRoomSync: Visibility changed. isAway:", isAway);
                await channelRef.current.track({ id: currentPlayerRef.current.id, isAway });
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
                console.log("useRoomSync: [PLAYERS REALTIME]", payload.eventType, payload.new?.id || payload.old?.id);

                if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
                    const updatedPlayer = decodePlayer(payload.new);

                    // ECHO PREVENTION
                    let finalPlayer = updatedPlayer;
                    if (updatedPlayer.id === currentPlayerRef.current?.id) {
                        const now = Date.now();
                        const isRecentUpdate = now - lastAnswerUpdateRef.current < 2500;
                        const serverAns = updatedPlayer.last_answer;
                        const localAns = currentPlayerRef.current?.last_answer;
                        const currentPhase = gameStateRef.current?.phase;

                        let isSamePhase = false;
                        if (!serverAns) isSamePhase = true;
                        else if (currentPhase === 'vote') isSamePhase = serverAns.startsWith('vote:') || serverAns.startsWith('vote_multi:') || serverAns.startsWith('draft');
                        else if (currentPhase === 'text') isSamePhase = serverAns.startsWith('text:') || serverAns.startsWith('draft');
                        else if (currentPhase?.startsWith('emoji')) isSamePhase = serverAns.startsWith('emoji:') || serverAns.startsWith('draft');
                        else if (currentPhase?.startsWith('interpretation')) isSamePhase = serverAns.startsWith('guess:') || serverAns.startsWith('draft');

                        const isLateEcho = (isRecentUpdate && !serverAns) || (serverAns && !isSamePhase && !['lobby', 'scoreboard', 'winner'].includes(currentPhase));

                        // RANK SYSTEM: 0 = Empty, 1 = Draft, 2 = Final
                        const getRank = (ans) => (!ans ? 0 : ans.startsWith('draft') ? 1 : 2);
                        const serverRank = getRank(serverAns);
                        const localRank = getRank(localAns);

                        const isRankRegression = serverRank < localRank;
                        const isRecentPhaseChange = (now - lastPhaseUpdateRef.current < 4000);

                        if (isLateEcho || (isRankRegression && !isRecentPhaseChange)) {
                            if (!serverAns && isRecentPhaseChange) {
                                console.log("useRoomSync: Server cleared answer and phase changed recently. NOT restoring local answer.");
                                finalPlayer = updatedPlayer;
                            } else {
                                console.log("useRoomSync: Shielding local state from late/stale answer echo.", { server: serverAns, local: localAns, serverRank, localRank });
                                finalPlayer = { ...updatedPlayer, last_answer: localAns };
                            }
                        }
                    }

                    setPlayers(prev => {
                        const exists = prev.some(p => p.id === finalPlayer.id);
                        if (exists) {
                            return prev.map(p => p.id === finalPlayer.id ? finalPlayer : p);
                        }
                        return [...prev, finalPlayer];
                    });

                    if (payload.eventType === 'INSERT') {
                        setOnlinePlayerIds(prev => new Set(prev).add(finalPlayer.id));
                    }

                    if (currentPlayerRef.current?.id === finalPlayer.id) {
                        setCurrentPlayer(prev => {
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

                    if (currentPlayerRef.current?.id === payload.old.id && !isExitingRef.current) {
                        console.warn("useRoomSync: I have been deleted from the players table.");
                        const isKicked = roomRef.current?.settings?.kicked_names?.includes(currentPlayerRef.current?.name);
                        if (isKicked) setError('kickedError');
                        else setError('afkTimeout');
                    }
                }
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state', filter: `room_id=eq.${room.id}` }, (payload) => {
                if (payload.new) {
                    const now = Date.now();
                    const isRecentUpdate = now - lastPhaseUpdateRef.current < 3000;
                    const amHost = currentPlayerRef.current?.is_host;

                    if (amHost && isRecentUpdate) {
                        console.log("useRoomSync: Skipping game_state echo to preserve local phase change.");
                        return;
                    }
                    setGameState(payload.new);
                }
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${room.id}` }, (payload) => {
                if (payload.new) {
                    const now = Date.now();
                    const isRecentUpdate = now - lastSettingsUpdateRef.current < 3000;

                    setRoom(prev => {
                        const amHost = currentPlayerRef.current?.is_host;
                        if (amHost && isRecentUpdate) {
                            console.log("useRoomSync: Skipping settings/status echo to preserve local changes.");
                            return { ...prev, ...payload.new, settings: prev.settings, status: prev.status };
                        }
                        return { ...prev, ...payload.new };
                    });

                    // Reactive Kick Detection
                    if (currentPlayerRef.current?.name) {
                        const kickedNames = payload.new.settings?.kicked_names || [];
                        const kickedFingerprints = payload.new.settings?.kicked_fingerprints || [];
                        if (kickedNames.includes(currentPlayerRef.current.name) || (currentPlayerRef.current.fingerprint && kickedFingerprints.includes(currentPlayerRef.current.fingerprint))) {
                            console.warn("useRoomSync: Detected my name/fingerprint in kicked list. Bouncing...");
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
                setAwayPlayerIds(awayIds);
            })
            .on('presence', { event: 'join' }, ({ key, newPresences }) => {
                if (Date.now() - subscriptionStartTime.current >= 3000) {
                    if (roomRef.current?.status === 'playing') {
                        newPresences.forEach(p => {
                            if (!onlinePlayerIdsRef.current.has(p.id) && String(p.id) !== String(currentPlayerRef.current?.id)) {
                                const name = playersRef.current.find(pl => pl.id === p.id)?.name || "Someone";
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
                const newState = channel.presenceState();
                const onlineIds = new Set();
                const awayIds = new Set();
                Object.values(newState).forEach(presences => {
                    presences.forEach(p => {
                        onlineIds.add(p.id);
                        if (p.isAway) awayIds.add(p.id);
                    });
                });

                if (roomRef.current?.status === 'playing') {
                    const activePlayerIds = roomRef.current?.settings?.player_order || [];
                    const onlinePlayingCount = activePlayerIds.filter(id => onlineIds.has(id)).length;

                    if (onlinePlayingCount < 2) {
                        addNotification(t('gameStoppedError'), 'error');
                        // Phase fallback handling is in useGamePhase/RoomContext monitors
                    } else {
                        leftPresences.forEach(p => {
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
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.error("useRoomSync: Realtime connection issue detected! Status:", status);
                    // Do NOT destroy the channel here. Supabase handles auto-reconnection internally.
                    // Destroying it permanently breaks the game for this player.

                    // We only log it and let Supabase Realtime client attempt to recover.
                } else if (status === 'SUBSCRIBED') {
                    console.log("useRoomSync: Realtime connected successfully.");
                } else if (status === 'CLOSED') {
                    console.warn("useRoomSync: Realtime connection closed.");
                }
            });

        channelRef.current = channel;

        fetchPlayers(room.id);

        const syncInterval = setInterval(() => {
            if (room?.id) {
                fetchPlayers(room.id);
                supabase.from('rooms').select('*').eq('id', room.id).single()
                    .then(({ data }) => {
                        if (!data) return;
                        const now = Date.now();
                        const isRecentUpdate = now - lastSettingsUpdateRef.current < 3000;
                        const amHost = currentPlayerRef.current?.is_host;

                        setRoom(prev => {
                            if (amHost && isRecentUpdate && prev?.settings) {
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

                        if (amHost && isRecentUpdate) return;
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
    }, [room?.id]); // Only re-run when room changes

    // Secondary effect: Track presence once channel exists AND player is loaded
    useEffect(() => {
        const trackPresence = async () => {
            if (channelRef.current && currentPlayerRef.current?.id) {
                try {
                    await channelRef.current.track({
                        id: currentPlayerRef.current.id,
                        isAway: document.visibilityState === 'hidden'
                    });
                } catch (err) {
                    console.error("useRoomSync: failed to track presence", err);
                }
            }
        };
        trackPresence();
    }, [room?.id, currentPlayerRef.current?.id]); // Re-run when room changes or player ID changes

    // STALE ROOM DETECTOR (Split Brain)
    useEffect(() => {
        if (!room?.id || !room?.room_code) return;

        const checkStale = async () => {
            const { data: candidates } = await supabase
                .from('rooms')
                .select('id, created_at, status')
                .eq('room_code', room.room_code)
                .order('created_at', { ascending: false });

            if (!candidates || candidates.length <= 1) return;

            const candidateIds = candidates.map(c => c.id);
            const { data: allPlayers } = await supabase.from('players').select('id, room_id, is_host, last_seen').in('room_id', candidateIds);

            const now = new Date();
            const activeThreshold = 45000;

            const stats = {};
            candidateIds.forEach(id => { stats[id] = { count: 0, hasActiveHost: false }; });

            allPlayers?.forEach(p => {
                const isOnline = (now - new Date(p.last_seen)) < activeThreshold;
                if (isOnline) {
                    stats[p.room_id].count++;
                    if (p.is_host) stats[p.room_id].hasActiveHost = true;
                }
            });

            const winnerId = candidateIds.sort((a, b) => {
                const scoreA = (stats[a].hasActiveHost ? 100 : 0) + stats[a].count;
                const scoreB = (stats[b].hasActiveHost ? 100 : 0) + stats[b].count;
                if (scoreA !== scoreB) return scoreB - scoreA;
                return new Date(candidates.find(c => c.id === b).created_at) - new Date(candidates.find(c => c.id === a).created_at);
            })[0];

            if (winnerId && winnerId !== room.id) {
                console.warn(`useRoomSync: SPLIT-BRAIN DETECTED! Merging to ${winnerId}...`);
                sessionStorage.removeItem(`room_session_${room.room_code}`);
                window.location.reload();
            }
        };

        const timer = setInterval(checkStale, 15000);
        checkStale();
        return () => clearInterval(timer);
    }, [room?.id, room?.room_code]);

    // PASSIVE CATCH-UP
    useEffect(() => {
        if (!room?.id) return;

        const catchUp = async () => {
            if (isExitingRef.current) return;

            const [{ data: latestGS }, { data: latestRoom }] = await Promise.all([
                supabase.from('game_state').select('*').eq('room_id', room.id).single(),
                supabase.from('rooms').select('*').eq('id', room.id).single()
            ]);

            if (latestGS) {
                const currentP = gameStateRef.current?.phase;
                const nextP = latestGS.phase;
                const now = Date.now();
                const isRecentPhaseUpdate = now - lastPhaseUpdateRef.current < 4000;
                const amHost = currentPlayerRef.current?.is_host;

                if (!amHost || !isRecentPhaseUpdate) {
                    const currentPri = getPhasePriority(currentP, latestRoom?.settings) ?? -1;
                    const nextPri = getPhasePriority(nextP, latestRoom?.settings) ?? -1;

                    if (nextPri > currentPri) {
                        setGameState(latestGS);
                    }
                }
            }

            if (latestRoom) {
                const now = Date.now();
                const isRecentSettingsUpdate = now - lastSettingsUpdateRef.current < 4000;
                const amHost = currentPlayerRef.current?.is_host;

                setRoom(prev => {
                    if (!prev) return latestRoom;
                    if (amHost && isRecentSettingsUpdate) return prev;

                    const hasStatusChange = prev.status !== latestRoom.status;
                    const hasSettingsChange = JSON.stringify(prev.settings) !== JSON.stringify(latestRoom.settings);

                    if (hasStatusChange || hasSettingsChange) {
                        if (amHost && isRecentSettingsUpdate) {
                            console.log("useRoomSync: Catch-up skipping status/settings update for host.");
                            return { ...prev, ...latestRoom, settings: prev.settings, status: prev.status };
                        }
                        return { ...prev, ...latestRoom };
                    }
                    return prev;
                });
            }
        };

        const timer = setInterval(catchUp, 8000);
        return () => clearInterval(timer);
    }, [room?.id, isExitingRef, gameStateRef, currentPlayerRef, setGameState, setRoom]);

    // HOST: ACTIVE AFK MONITOR & AUTO-HEAL
    useEffect(() => {
        if (!room?.id || !currentPlayerRef.current?.is_host) return;

        const monitorAFK = async () => {
            const currentPhase = gameStateRef.current?.phase;
            if (['scoreboard', 'winner', 'reveal'].includes(currentPhase)) return; // No strict AFK handling needed here

            const currentPlayers = playersRef.current || [];
            if (currentPhase === 'lobby') {
                for (const p of currentPlayers) {
                    if (!onlinePlayerIdsRef.current.has(p.id) && String(p.id) !== String(currentPlayerRef.current.id)) {
                        const lastSeenMs = p.last_seen ? new Date(p.last_seen).getTime() : Date.now();
                        const offlineDuration = Date.now() - lastSeenMs;
                        if (offlineDuration > 60000) {
                            console.log(`useRoomSync: Player ${p.name} offline for >60s in lobby. Kicking...`);
                            await supabase.from('players').delete().eq('id', p.id);
                        }
                    }
                }
                return;
            }

            // In-Game Logic
            const playingIds = roomRef.current?.settings?.player_order || [];

            for (const p of currentPlayers) {
                if (!playingIds.includes(p.id)) continue; // spectators ignored

                if (!onlinePlayerIdsRef.current.has(p.id)) {
                    const lastSeenMs = p.last_seen ? new Date(p.last_seen).getTime() : Date.now();
                    const offlineDuration = Date.now() - lastSeenMs;

                    // 1. Immediate Healing if no answer exists
                    if (!p.last_answer || p.last_answer.startsWith('draft')) {
                        let prefix = "";
                        if (currentPhase === 'text') prefix = 'text:';
                        else if (currentPhase.startsWith('emoji')) prefix = 'emoji:';
                        else if (currentPhase.startsWith('interpretation')) prefix = 'guess:';

                        if (prefix) {
                            let healedPostfix = "Healed: Random";
                            if (prefix === 'emoji:') {
                                const backupEmojis = ["👻", "🤖", "💤", "🏃", "🫥", "🐢", "🐌", "🛌", "🌪️", "📵", "🔌", "💥"];
                                const shuffled = [...backupEmojis].sort(() => 0.5 - Math.random());
                                healedPostfix = "Healed:" + shuffled.slice(0, 3).join("");
                            } else {
                                const backupTexts = ["A mysterious ghost", "Something completely forgotten", "A strange artifact", "The quiet breeze", "A sneaky ninja", "A broken robot", "A sleepy turtle", "Just vibing", "Error 404: Brain not found", "A magical potato"];
                                healedPostfix = "Healed:" + backupTexts[Math.floor(Math.random() * backupTexts.length)];
                            }
                            const healedAns = prefix + healedPostfix;

                            console.log(`useRoomSync: Healing missing answer for offline player ${p.name}...`);
                            // Update the player locally optimistic?
                            // No, just in db, sync will pick it up
                            await supabase.from('players').update({ last_answer: healedAns }).eq('id', p.id);
                        }
                    }

                    // 2. Spectator Timeout (> 60s)
                    if (offlineDuration > 60000) {
                        console.log(`useRoomSync: Player ${p.name} offline for >60s in-game. Moving to spectators...`);
                        const newOrder = playingIds.filter(id => id !== p.id);
                        await supabase.from('rooms').update({
                            settings: { ...roomRef.current.settings, player_order: newOrder }
                        }).eq('id', room.id);

                        addNotification(t('playerMovedToSpectator').replace('{name}', p.name), 'warning');
                    }
                }
            }
        };

        const interval = setInterval(monitorAFK, 4000);
        return () => clearInterval(interval);
    }, [room?.id, currentPlayerRef.current?.is_host]); // Relying on refs largely

    // HEARTBEAT
    useEffect(() => {
        if (!room?.id || !currentPlayerRef.current?.id) return;

        const updateHeartbeat = async () => {
            try {
                await supabase.from('players').update({ last_seen: new Date().toISOString() }).eq('id', currentPlayerRef.current.id);
            } catch (e) { console.error("Heartbeat exception:", e); }
        };

        updateHeartbeat();
        const heartbeatInterval = setInterval(updateHeartbeat, 10000);
        return () => clearInterval(heartbeatInterval);
    }, [room?.id, currentPlayerRef]);

    return {
        onlinePlayerIds,
        awayPlayerIds,
        error,
        setError,
        fetchPlayers,
        refreshRoomState,
        clearError: () => setError(null),
        markSettingsDirty,
        markPhaseDirty,
        markAnswerDirty
    };
};
