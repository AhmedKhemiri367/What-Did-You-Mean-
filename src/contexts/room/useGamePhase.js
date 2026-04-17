import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { decodePlayer, getNextPhase, shuffleArr, generateChainAssignments } from './roomUtils';

export const useGamePhase = ({ roomRef, gameStateRef, playersRef, currentPlayerRef, onlinePlayerIdsRef, setGameState, setRoom, setPlayers, setCurrentPlayer, markPhaseDirty, phaseTransitionLock, isAdvancingRef }) => {
    const criticalDisconnectTimerRef = useRef(null);

    // Global Host Sync fallback: Force advance if stuck OR everyone is ready
    useEffect(() => {
        if (!currentPlayerRef.current?.is_host || !roomRef.current?.id || !gameStateRef.current?.phase) return;

        const monitorInterval = setInterval(() => {
            if (phaseTransitionLock.current) return;

            const currentPhase = gameStateRef.current.phase;
            if (['lobby', 'reveal', 'scoreboard', 'winner'].includes(currentPhase)) return;

            const playingIds = roomRef.current?.settings?.player_order || [];
            if (playingIds.length === 0) return;

            const total = playingIds.length;

            if (total > 0) {
                const prefix = currentPhase.startsWith('text') ? 'text:' :
                    currentPhase.startsWith('emoji') ? 'emoji:' :
                        currentPhase.startsWith('interpretation') ? 'guess:' :
                            currentPhase === 'vote' ? 'vote:' : null;

                if (prefix) {
                    const readyCount = playersRef.current.filter(p =>
                        playingIds.includes(p.id) &&
                        p.last_answer && (p.last_answer.startsWith('vote:') || p.last_answer.startsWith('vote_multi:') || p.last_answer.startsWith(prefix))
                    ).length;

                    if (readyCount >= total) {
                        console.log(`useGamePhase: Host detected everyone ready (${readyCount}/${total}). Advancing...`);
                        const next = getNextPhase(currentPhase, roomRef.current?.settings);
                        if (next) advancePhase(next);
                        return;
                    }
                }
            }

            // 2. Check for "Timer Expired" (Fallback)
            const expirySource = gameStateRef.current?.phase_expiry || roomRef.current?.settings?.phase_expiry;
            if (expirySource) {
                const now = Date.now();
                const expiry = new Date(expirySource).getTime();
                // Add a small delay (2.5s) to allow for network sync drift before forcing
                if (now > (expiry + 2500)) {
                    console.log(`useGamePhase: Host Monitor forcing advance from ${currentPhase} due to timeout.`);
                    const next = getNextPhase(currentPhase, roomRef.current?.settings);
                    if (next) advancePhase(next);
                }
            }
        }, 1000);
        return () => clearInterval(monitorInterval);
    }, [currentPlayerRef.current?.is_host, roomRef.current?.id, gameStateRef.current?.phase]); // Trigger effectively when these fundamental identifiers change

    // Client-Side Answer Clearing
    useEffect(() => {
        if (!gameStateRef.current?.phase || !currentPlayerRef.current?.id || gameStateRef.current.phase === 'lobby') return;
        const lastClearedPhase = sessionStorage.getItem(`cleared_phase_${roomRef.current?.id}`);
        if (lastClearedPhase !== gameStateRef.current.phase) {
            const ans = currentPlayerRef.current.last_answer || '';
            const newPhase = gameStateRef.current.phase;

            const isCoded = ans.includes(':');
            let isCurrentPhaseData = false;

            if (newPhase === 'text') isCurrentPhaseData = ans.startsWith('text:');
            else if (newPhase.startsWith('emoji')) isCurrentPhaseData = ans.startsWith('emoji:');
            else if (newPhase.startsWith('interpretation')) isCurrentPhaseData = ans.startsWith('guess:');
            else if (newPhase === 'vote') isCurrentPhaseData = ans.startsWith('vote:') || ans.startsWith('vote_multi:');

            if (isCurrentPhaseData) {
                console.log("useGamePhase: Skipping client-side clear, player already has fresh data for phase:", newPhase);
                sessionStorage.setItem(`cleared_phase_${roomRef.current?.id}`, newPhase);
                return;
            }

            console.log("useGamePhase: Clearing local old answer state for new phase:", newPhase);
            sessionStorage.setItem(`cleared_phase_${roomRef.current?.id}`, newPhase);
            setPlayers(prev => prev.map(p => p.id === currentPlayerRef.current.id ? { ...p, last_answer: null } : p));
        }
    }, [gameStateRef, currentPlayerRef, roomRef, setPlayers]);

    // Fast Forward End Phase Check
    useEffect(() => {
        if (!currentPlayerRef.current?.is_host || !roomRef.current?.id || !playersRef.current.length || ['lobby', 'reveal', 'scoreboard'].includes(gameStateRef.current?.phase)) return;

        const currentPhasePhase = gameStateRef.current?.phase;
        const inGameplay = !['lobby', 'reveal', 'scoreboard', 'winner'].includes(currentPhasePhase);
        const playingIds = roomRef.current?.settings?.player_order || [];

        const isPresenceFailing = onlinePlayerIdsRef.current.size === 0;
        const activePlayingPlayers = playingIds.filter(id => isPresenceFailing || onlinePlayerIdsRef.current.has(id));

        if (inGameplay && activePlayingPlayers.length < 2) {
            if (!criticalDisconnectTimerRef.current) {
                console.warn(`useGamePhase: CRITICAL - Only ${activePlayingPlayers.length} playing players online. Terminating game in 2s...`);
                criticalDisconnectTimerRef.current = setTimeout(() => {
                    console.log("useGamePhase: Solo player detected. Jumping to scoreboard...");
                    if (roomRef.current?.id) advancePhase('scoreboard', true);
                    criticalDisconnectTimerRef.current = null;
                }, 2000);
            }
            return;
        } else {
            // Recovered: Active players is >= 2
            if (criticalDisconnectTimerRef.current) {
                console.log(`useGamePhase: RECOVERY - Player count restored to ${activePlayingPlayers.length}. Cancelling scoreboard jump...`);
                clearTimeout(criticalDisconnectTimerRef.current);
                criticalDisconnectTimerRef.current = null;
            }
        }

        const isEmojiOnly = roomRef.current?.settings?.selectedMode === 'Emoji Only';
        const prefix = currentPhasePhase.startsWith('emoji') ? 'emoji:' :
            currentPhasePhase.startsWith('interpretation') ? 'guess:' :
                currentPhasePhase === 'vote' ? 'vote' :
                    (currentPhasePhase === 'text' ? 'text:' :
                        (isEmojiOnly ? 'emoji:' : 'text:'));

        const onlinePlayingPlayers = playersRef.current.filter(p => playingIds.includes(p.id) && (isPresenceFailing || onlinePlayerIdsRef.current.has(p.id)));
        const allReady = onlinePlayingPlayers.length > 0 && onlinePlayingPlayers.every(p => {
            if (!p.last_answer) return false;
            if (currentPhasePhase === 'vote') {
                return p.last_answer.startsWith('vote:') || p.last_answer.startsWith('vote_multi:');
            }
            return p.last_answer.startsWith(prefix);
        });

        if (allReady && activePlayingPlayers.length >= 2) {
            console.log("useGamePhase: All online players ready! Advancing phase...");
            const nextP = getNextPhase(gameStateRef.current.phase, roomRef.current?.settings);
            if (nextP) advancePhase(nextP, true);
        }
    }, [currentPlayerRef.current?.is_host, roomRef.current?.id, gameStateRef.current?.phase, onlinePlayerIdsRef.current?.size, playersRef.current]); // React to changes in arrays directly

    const advancePhase = useCallback(async (nextPhase, skipGrace = false) => {
        if (!currentPlayerRef.current?.is_host || !roomRef.current?.id) return;

        if (phaseTransitionLock.current || isAdvancingRef.current || gameStateRef.current?.phase === nextPhase) {
            console.warn(`useGamePhase: Phase transition to ${nextPhase} blocked (Lock: ${phaseTransitionLock.current}, AdvRef: ${isAdvancingRef.current})`);
            return;
        }
        phaseTransitionLock.current = true;
        isAdvancingRef.current = true;
        markPhaseDirty();

        try {
            console.log(`useGamePhase: Advancing phase to ${nextPhase}...`);
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
                phaseExpiry = new Date(Date.now() + (duration * 1000) + 1000).getTime();
            }

            const navigationalPhases = ['vote', 'scoreboard', 'lobby', 'winner'];
            if (navigationalPhases.includes(nextPhase)) {
                skipGrace = true;
            }

            const currentPhase = currentGameState?.phase;
            let syncPlayers = playersRef.current;
            let phaseAnswers = {};
            const brokenChains = new Set();
            const playerOrderToRecord = currentRoom?.settings?.player_order || [];

            const isGameplayRound = currentPhase.startsWith('text') || currentPhase.startsWith('emoji') || currentPhase.startsWith('interpretation') || currentPhase === 'vote';

            // WAIT FOR DB: To perfectly synchronize transitions across clients,
            // the Host will now wait for promises to resolve before setting local state.
            const nextGameState = { ...currentGameState, phase: nextPhase, phase_expiry: phaseExpiry || currentGameState.phase_expiry };

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
                        const maxWait = 2500;
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

                // 2. EXTRACT ANSWERS
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

            if (currentPhase.startsWith('text') || currentPhase.startsWith('emoji') || currentPhase.startsWith('interpretation')) {
                const currentNames = { ...(dbSettings.player_names || {}) };
                playersRef.current.forEach(p => {
                    if (p.id && p.name) currentNames[p.id] = p.name;
                });
                nextSettings.player_names = currentNames;

                const currentAssignments = dbSettings.assignments?.[currentPhase] || {};

                Object.keys(activeChains).forEach(chainId => {
                    const playerId = Object.keys(currentAssignments).find(pId => currentAssignments[pId] === chainId);
                    let content = playerId ? phaseAnswers[playerId] : null;

                    if (content && content.includes(':')) {
                        content = content.split(':').slice(1).join(':').trim();
                    }

                    if (content && content.startsWith('Healed:')) {
                        content = content.replace('Healed:', '').trim();
                    }

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

            const promises = [];
            const isGameplay = nextPhase.startsWith('text') || nextPhase.startsWith('emoji') || nextPhase.startsWith('interpretation') || nextPhase === 'vote';

            if (isGameplay) {
                let playingIds = [];
                if (nextPhase === 'text') {
                    const isSpecMode = nextSettings.spectatorEnabled && syncPlayers.length >= 4;
                    const now = Date.now();
                    let newOrder = shuffleArr(syncPlayers
                        .filter(p => !isSpecMode || !p.is_host)
                        .filter(p => {
                            const isOnline = onlinePlayerIdsRef.current.has(p.id);
                            const isMe = p.id === currentPlayerRef.current?.id;
                            const lastSeenMs = p.last_seen ? new Date(p.last_seen).getTime() : 0;
                            const wasRecentlySeen = (now - lastSeenMs) < 15000;
                            return isOnline || isMe || wasRecentlySeen;
                        })
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
                    promises.push(supabase.from('players').update({ last_answer: null }).eq('room_id', currentRoom.id));
                } else {
                    const prevPlayingIds = dbSettings.player_order || [];

                    // Filter out truly offline players if there are >= 4 players originally
                    let newPlayingIds = prevPlayingIds;
                    if (prevPlayingIds.length >= 4) {
                        newPlayingIds = prevPlayingIds.filter(id => {
                            const p = playersRef.current.find(lp => lp.id === id);
                            const hasFreshAns = p?.last_answer && !p.last_answer.startsWith('draft');
                            const isTrulyOffline = !onlinePlayerIdsRef.current.has(id) && !hasFreshAns;
                            return !isTrulyOffline;
                        });
                    }
                    playingIds = newPlayingIds;

                    const allChainIds = Object.keys(activeChains);

                    // Only keep chains whose creator is STILL in playingIds
                    let chainsToUse = allChainIds.filter(cId => {
                        const creatorId = activeChains[cId]?.creator_id;
                        return playingIds.includes(creatorId);
                    });

                    // Fallback to slicing if sizes still don't match for some reason
                    if (chainsToUse.length > playingIds.length) {
                        chainsToUse = chainsToUse.slice(0, playingIds.length);
                    }

                    const allAssignments = { ...(nextSettings.assignments || {}) };
                    const randomOffsets = nextSettings.random_offsets || null;

                    // Pass chainsToUse dictionary into generator
                    const filteredChains = {};
                    chainsToUse.forEach(cId => filteredChains[cId] = activeChains[cId]);

                    const chainAssignments = generateChainAssignments(playingIds, filteredChains, nextPhase, randomOffsets);
                    allAssignments[nextPhase] = chainAssignments;

                    nextSettings.assignments = allAssignments;
                    nextSettings.player_order = playingIds;
                    promises.push(supabase.from('players').update({ last_answer: null }).in('id', playingIds));
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

            if (isGameplay) {
                promises.push(supabase.from('players').update({ last_answer: null }).eq('room_id', currentRoom.id));
                setPlayers(prev => prev.map(p => ({ ...p, last_answer: null })));
            }

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
                console.log("useGamePhase: Calculating scores from votes...");
                const scoreDelta = {};
                const usageDelta = {};

                Object.entries(phaseAnswers).forEach(([voterId, voteStr]) => {
                    if (!voteStr) return;
                    let votesToProcess = [];
                    if (voteStr.startsWith('vote_multi:')) {
                        try {
                            const jsonPart = voteStr.substring('vote_multi:'.length);
                            votesToProcess = JSON.parse(jsonPart);
                        } catch (e) { console.error("useGamePhase: Failed to parse multi-vote", e); }
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

                // Calculate new scores to preserve offline player progression
                const cachedScores = { ...(dbSettings.cached_scores || {}) };
                const updates = [];

                playerOrderToRecord.forEach(pId => {
                    const activeP = playersRef.current.find(p => p.id === pId);
                    const currentScore = activeP?.score ?? cachedScores[pId] ?? 0;
                    const delta = scoreDelta[pId] || 0;
                    let newScore = currentScore + delta;
                    if (newScore < 0) newScore = 0;

                    cachedScores[pId] = newScore; // Retain exactly what happened this round

                    if (activeP) {
                        const currentUsage = activeP.votes_used || {};
                        const myUsageDelta = usageDelta[pId] || {};
                        const newUsage = { ...currentUsage };
                        Object.keys(myUsageDelta).forEach(cat => {
                            newUsage[cat] = (newUsage[cat] || 0) + myUsageDelta[cat];
                        });
                        updates.push({ id: pId, score: newScore, votes_used: newUsage });
                    }
                });

                nextSettings.cached_scores = cachedScores;

                promises.push(...updates.map(update =>
                    supabase.from('players').update({ score: update.score, votes_used: update.votes_used }).eq('id', update.id)
                ));
            }

            await Promise.all(promises);

            setGameState(prev => ({
                ...prev,
                phase: nextPhase,
                timer: duration,
                phase_expiry: phaseExpiry
            }));
            setRoom(prev => prev ? ({ ...prev, ...roomUpdate }) : prev);

            if (nextPhase === 'lobby') {
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
                isAdvancingRef.current = false;
            }, 1000);
        }
    }, [currentPlayerRef, roomRef, gameStateRef, playersRef, onlinePlayerIdsRef, setGameState, setRoom, setPlayers, setCurrentPlayer, markPhaseDirty]);

    return { advancePhase };
};
