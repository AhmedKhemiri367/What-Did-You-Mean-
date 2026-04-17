import { useCallback, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { useLanguage } from '../LanguageContext';
import { shuffleArr } from './roomUtils';

export const useRoomActions = ({ roomRef, currentPlayerRef, playersRef, setRoom, setPlayers, setCurrentPlayer, setGameState, setError, isExitingRef, markPhaseDirty, markAnswerDirty, markSettingsDirty, isJoiningRef, onlinePlayerIdsRef }) => {
    const { t } = useLanguage();
    const activeUpdateRef = useRef(Promise.resolve());

    const checkRoomExists = useCallback(async (code) => {
        try {
            const { data: roomData, error } = await supabase.from('rooms').select('*').eq('room_code', code.trim().toUpperCase()).single();
            if (error || !roomData) return null;

            const { count } = await supabase.from('players').select('id', { count: 'exact', head: true }).eq('room_id', roomData.id);
            return { ...roomData, playerCount: count || 0 };
        } catch (err) {
            return null;
        }
    }, []);

    const updatePlayerProfile = useCallback(async (playerId, newName, newAvatar, fingerprint) => {
        try {
            const fullAvatar = fingerprint ? `${newAvatar} | ${fingerprint}` : newAvatar;
            await supabase.from('players').update({ name: newName, avatar: fullAvatar }).eq('id', playerId);
            setCurrentPlayer(prev => prev ? { ...prev, name: newName, avatar: newAvatar } : prev);
            return true;
        } catch (err) {
            return false;
        }
    }, [setCurrentPlayer]);

    const kickPlayer = useCallback(async (playerIdToKick, playerName) => {
        if (!currentPlayerRef.current?.is_host || !roomRef.current?.id) return;
        try {
            const currentRoom = roomRef.current;
            const targetPlayer = playersRef.current.find(p => p.id === playerIdToKick);

            const updatedNames = [...(currentRoom.settings?.kicked_names || []), playerName];
            let updatedFingerprints = [...(currentRoom.settings?.kicked_fingerprints || [])];

            if (targetPlayer?.fingerprint) {
                updatedFingerprints.push(targetPlayer.fingerprint);
            }

            const newSettings = {
                ...currentRoom.settings,
                kicked_names: updatedNames,
                kicked_fingerprints: updatedFingerprints,
                player_order: (currentRoom.settings?.player_order || []).filter(id => id !== playerIdToKick)
            };

            await Promise.all([
                supabase.from('rooms').update({ settings: newSettings }).eq('id', currentRoom.id),
                supabase.from('players').delete().eq('id', playerIdToKick)
            ]);

            setRoom(prev => ({ ...prev, settings: newSettings }));
            setPlayers(prev => prev.filter(p => p.id !== playerIdToKick));

        } catch (err) {
            console.error("Error kicking player:", err);
            setError(t('errorKickingPlayer'));
        }
    }, [currentPlayerRef, roomRef, playersRef, setRoom, setPlayers, setError, t]);

    const promotePlayerToHost = useCallback(async (playerIdToPromote) => {
        if (!roomRef.current?.id) return;
        try {
            const promises = playersRef.current.map(p =>
                supabase.from('players').update({ is_host: p.id === playerIdToPromote }).eq('id', p.id)
            );
            await Promise.all(promises);
            setPlayers(prev => prev.map(p => {
                const isNowHost = p.id === playerIdToPromote;
                if (currentPlayerRef.current?.id === p.id) {
                    setCurrentPlayer(cp => ({ ...cp, is_host: isNowHost }));
                }
                return { ...p, is_host: isNowHost };
            }));

            // Sync host anchor 
            if (playerIdToPromote !== roomRef.current.settings?.manual_host_id) {
                const newSettings = { ...roomRef.current.settings, manual_host_id: playerIdToPromote };
                setRoom(prev => ({ ...prev, settings: newSettings }));
                await supabase.from('rooms').update({ settings: newSettings }).eq('id', roomRef.current.id);
            }
        } catch (err) {
            console.error("Error promoting player:", err);
        }
    }, [roomRef, playersRef, setPlayers, setCurrentPlayer, setRoom]);

    const submitAnswer = useCallback(async (answer) => {
        if (!currentPlayerRef.current?.id || !roomRef.current?.id) return;
        markAnswerDirty();

        try {
            setCurrentPlayer(prev => ({ ...prev, last_answer: answer }));
            setPlayers(prev => prev.map(p => p.id === currentPlayerRef.current.id ? { ...p, last_answer: answer } : p));
            
            // Queue the write to prevent race conditions with stale drafts
            activeUpdateRef.current = activeUpdateRef.current.then(async () => {
                const { error } = await supabase.from('players').update({ last_answer: answer }).eq('id', currentPlayerRef.current.id);
                if (error) throw error;
            }).catch(err => {
                console.error('Error in queued submit:', err);
                setError(t('failedSubmit'));
            });
            
        } catch (err) {
            console.error('Error submitting answer locally:', err);
            setError(t('failedSubmit'));
        }
    }, [currentPlayerRef, roomRef, setPlayers, setCurrentPlayer, setError, t, markAnswerDirty]);

    const saveDraft = useCallback((draftContent) => {
        if (!currentPlayerRef.current?.id) return;
        markAnswerDirty();

        let ans;
        if (Array.isArray(draftContent)) {
            ans = `draft_guess:${draftContent.join(':')}`;
        } else if (typeof draftContent === 'string' && draftContent.startsWith('draft_')) {
            ans = draftContent;
        } else {
            ans = `draft:${draftContent}`;
        }

        if (ans.startsWith('draft_emoji:')) {
            setCurrentPlayer(prev => ({ ...prev, last_answer: ans }));
            return;
        }

        setCurrentPlayer(prev => ({ ...prev, last_answer: ans }));
        setPlayers(prev => prev.map(p => p.id === currentPlayerRef.current.id ? { ...p, last_answer: ans } : p));
        
        // Queue the write to prevent race conditions with final submits
        activeUpdateRef.current = activeUpdateRef.current.then(async () => {
            // Check state right before network call
            const currentAnswerState = currentPlayerRef.current?.last_answer;
            if (currentAnswerState && !currentAnswerState.startsWith('draft')) {
                // A final answer was submitted locally right before this draft could run on the network! Abort draft!
                return;
            }
            const { error } = await supabase.from('players').update({ last_answer: ans }).eq('id', currentPlayerRef.current.id);
            if (error) console.error("Error saving draft to database:", error);
        }).catch(() => {});
    }, [currentPlayerRef, setPlayers, setCurrentPlayer, markAnswerDirty]);

    // Used purely for updating standard room settings
    const updateRoomSettings = useCallback(async (newSettings) => {
        if (!currentPlayerRef.current?.is_host || !roomRef.current?.id) return;

        try {
            // OPTIMISTIC UPDATE
            const optimisticSettings = { ...roomRef.current.settings, ...newSettings };
            setRoom(prev => ({ ...prev, settings: optimisticSettings }));
            markSettingsDirty();

            const { error: err } = await supabase.from('rooms')
                .update({ settings: optimisticSettings })
                .eq('id', roomRef.current.id);

            if (err) throw err;
        } catch (err) {
            console.error('Error updating settings:', err);
            setError(t('failedUpdateSettings'));
        }
    }, [currentPlayerRef, roomRef, setRoom, setError, t]);

    const startGame = useCallback(async (settingsOverrides = {}) => {
        if (!currentPlayerRef.current?.is_host || !roomRef.current?.id) return;
        try {
            const currentRoom = roomRef.current;
            const { data: latestPlayers } = await supabase.from('players').select('*').eq('room_id', currentRoom.id);
            if (!latestPlayers) {
                setError(t('errorStartingGame'));
                return;
            }

            const onlineIds = onlinePlayerIdsRef.current || new Set();
            const now = Date.now();
            const activeIds = latestPlayers
                .filter(p => {
                    const isOnline = onlineIds.has(p.id);
                    const isMe = p.id === currentPlayerRef.current?.id;
                    const lastSeenMs = p.last_seen ? new Date(p.last_seen).getTime() : 0;
                    const wasRecentlySeen = (now - lastSeenMs) < 15000;
                    return isOnline || isMe || wasRecentlySeen;
                })
                .map(p => p.id);

            if (activeIds.length < 2) {
                setError(t('errorStartingGame'));
                return;
            }

            markPhaseDirty();
            markSettingsDirty();

            let playingIds = activeIds;
            const isSpecMode = currentRoom.settings?.spectatorEnabled && activeIds.length >= 4;

            const shuffledIds = shuffleArr(activeIds);
            if (isSpecMode) {
                const hostId = currentPlayerRef.current.id;
                playingIds = shuffledIds.filter(id => id !== hostId);
            } else {
                playingIds = shuffledIds;
            }

            const textAssignments = {};
            const initialChains = {};

            // Generate randomized offsets for all subsequent rounds
            // We need N-1 offsets (one for each phase after 'text')
            // By shuffling the array [1, 2, ..., N-1], we guarantee a player
            // never receives the same chain twice, and sees a different chain every round.
            const n = playingIds.length;
            let randomOffsets = [];
            if (n > 1) {
                const possibleOffsets = Array.from({ length: n - 1 }, (_, i) => i + 1);
                randomOffsets = shuffleArr(possibleOffsets);
            }

            playingIds.forEach((pId) => {
                const chainId = `chain_${pId}_${Date.now()}`;
                initialChains[chainId] = {
                    id: chainId,
                    creator_id: pId,
                    history: []
                };
                textAssignments[pId] = chainId;
            });

            const newSettings = {
                ...currentRoom.settings,
                ...settingsOverrides,
                history: {},
                assignments: { 'text': textAssignments },
                chains: initialChains,
                player_order: playingIds,
                random_offsets: randomOffsets
            };

            const phaseExpiry = new Date(Date.now() + ((currentRoom.settings?.roundTime || 60) * 1000) + 1000).getTime();

            setGameState({
                phase: 'text',
                timer: currentRoom.settings?.roundTime || 60,
                phase_expiry: phaseExpiry,
                room_id: currentRoom.id
            });
            setRoom({ ...currentRoom, status: 'playing', settings: newSettings });

            await Promise.all([
                supabase.from('rooms').update({ settings: newSettings, status: 'playing' }).eq('id', currentRoom.id),
                supabase.from('game_state').update({ phase: 'text', timer: currentRoom.settings?.roundTime || 60, phase_expiry: phaseExpiry }).eq('room_id', currentRoom.id),
                supabase.from('players').update({ score: 0, last_answer: null, votes_used: {} }).eq('room_id', currentRoom.id)
            ]);

            // HARD RESET: Ensure host local state is clean to prevent stale echoes
            setCurrentPlayer(prev => prev ? { ...prev, score: 0, last_answer: null, votes_used: {} } : prev);
            setPlayers(prev => prev.map(p => ({ ...p, score: 0, last_answer: null, votes_used: {} })));

        } catch (err) {
            console.error('Error starting game:', err);
            setError(t('errorStartingGame'));
        }
    }, [currentPlayerRef, roomRef, setError, t, markPhaseDirty, setGameState, setRoom]);

    const joinRoom = useCallback(async (code, name, avatar, fingerprint, isAutoReconnect = false) => {
        if (isJoiningRef.current) return;
        isJoiningRef.current = true;
        try {
            setError(null);

            const { data: rooms, error: roomError } = await supabase
                .from('rooms')
                .select('*')
                .eq('room_code', code.trim().toUpperCase())
                .order('created_at', { ascending: false });

            if (roomError || !rooms || rooms.length === 0) {
                if (isAutoReconnect) {
                    sessionStorage.removeItem(`room_session_${code}`);
                    return;
                }
                const msg = roomError ? roomError.message : t('roomNotFound');
                setError(`${t('errorJoining')}: ${msg}`);
                return;
            }

            const targetRoom = rooms[0];

            if (targetRoom.settings?.kicked_names?.includes(name) || targetRoom.settings?.kicked_fingerprints?.includes(fingerprint)) {
                setError(t('kickedError'));
                return;
            }

            const { data: existingPlayers } = await supabase.from('players').select('*').eq('room_id', targetRoom.id);

            // Allow multiple tabs by prioritizing explicit sessionStorage over generic fingerprint/name
            const savedSession = sessionStorage.getItem(`room_session_${code}`);
            let parsedSession = null;
            try { if (savedSession) parsedSession = JSON.parse(savedSession); } catch (e) { }

            let myExistingPlayer = null;
            if (parsedSession && parsedSession.playerId) {
                myExistingPlayer = existingPlayers?.find(p => p.id === parsedSession.playerId);
            }

            // If they are explicitly rejoining after a hard refresh/reconnect from the same exact device without a session, we can do a fallback
            // but we MUST ensure it's a perfect match on both name AND fingerprint to prevent accidental tab overwriting.
            if (!myExistingPlayer && fingerprint) {
                myExistingPlayer = existingPlayers?.find(p => {
                    const encodedFingerprint = p.avatar?.split(' | ')[1];
                    return encodedFingerprint === fingerprint && p.name === name;
                });
            }

            // EXTRA FALLBACK: If the game is already started, and they type EXACTLY the same name, 
            // assume they are trying to reconnect from a crashed/new browser in a panic and let them hijack the DB slot!
            if (!myExistingPlayer && targetRoom.status !== 'lobby') {
                myExistingPlayer = existingPlayers?.find(p => p.name.trim().toLowerCase() === name.trim().toLowerCase());
            }

            if (isAutoReconnect && !myExistingPlayer) {
                // If this is an automatic background reconnect on page load, and the DB slot is gone (AFK kick/manual kick),
                // do NOT silently recreate a new player. Abort and stay on home page.
                sessionStorage.removeItem(`room_session_${code}`);
                return;
            }

            let playerId;
            let isHost = targetRoom.settings?.manual_host_id ? false : existingPlayers?.length === 0;
            const fullAvatar = `${avatar} | ${fingerprint}`;

            if (myExistingPlayer) {
                playerId = myExistingPlayer.id;
                isHost = myExistingPlayer.is_host;
                if (targetRoom.settings?.manual_host_id === playerId) isHost = true;

                await supabase.from('players').update({
                    name: name,
                    avatar: fullAvatar,
                    last_seen: new Date().toISOString()
                }).eq('id', playerId);
            } else {
                if (targetRoom.status !== 'lobby') {
                    setError(t('gameAlreadyStarted'));
                    return;
                }

                if (existingPlayers?.length >= (targetRoom.settings?.maxPlayers || 8)) {
                    setError(t('roomFull'));
                    return;
                }

                const { data: newPlayer, error: joinError } = await supabase.from('players').insert([{
                    room_id: targetRoom.id,
                    name,
                    avatar: fullAvatar,
                    is_host: isHost,
                    last_seen: new Date().toISOString()
                }]).select().single();

                if (joinError) throw joinError;
                playerId = newPlayer.id;

                if (isHost && !targetRoom.settings?.manual_host_id) {
                    await supabase.from('rooms').update({
                        settings: { ...targetRoom.settings, manual_host_id: playerId }
                    }).eq('id', targetRoom.id);
                }
            }

            const { data: stateData } = await supabase.from('game_state').select('*').eq('room_id', targetRoom.id).single();
            sessionStorage.setItem(`room_session_${targetRoom.room_code}`, JSON.stringify({
                playerId, roomId: targetRoom.id, roomCode: targetRoom.room_code, fingerprint
            }));

            // Setting standard sync data allows useRoomSync.js to take over.
            setRoom(targetRoom);
            setGameState(stateData || { room_id: targetRoom.id, phase: 'lobby' });
            setCurrentPlayer({ id: playerId, name, avatar, fingerprint, is_host: isHost, room_id: targetRoom.id });

        } catch (err) {
            console.error('Error joining room:', err);
            setError(t('errorJoiningRoom', { message: err.message }));
        } finally {
            isJoiningRef.current = false;
        }
    }, [setError, t, setRoom, setGameState, setCurrentPlayer, isJoiningRef]);


    const createRoom = useCallback(async (hostName, avatar, fingerprint) => {
        if (isJoiningRef.current) return;
        isJoiningRef.current = true;
        try {
            setError(null);

            const genCode = () => {
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
            };

            let code = genCode();
            let unique = false;
            let attempts = 0;

            while (!unique && attempts < 10) {
                const { count, error: countError } = await supabase.from('rooms').select('id', { count: 'exact', head: true }).eq('room_code', code);
                
                if (countError) {
                    console.error("Error checking room code uniqueness:", countError);
                    throw new Error(`DB Error during uniqueness check: ${countError.message}`);
                }
                
                if (count === 0 || count === null) unique = true; // null usually means 0 in some Supabase responses if no rows match
                else {
                    code = genCode();
                    attempts++;
                }
            }
            if (!unique) throw new Error("Could not generate a unique room code. Too many collisions or DB timeout.");

            const { data: newRoom, error: roomError } = await supabase.from('rooms').insert([{
                room_code: code,
                status: 'lobby',
                settings: {
                    maxPlayers: 8,
                    roundTime: 60,
                    voteDuration: 30,
                    maxScore: 5,
                    kicked_names: [],
                    selectedMode: 'Classic',
                    spectatorEnabled: true,
                    manual_host_id: null
                }
            }]).select().single();

            if (roomError) throw roomError;

            const fullAvatar = `${avatar} | ${fingerprint}`;
            const { data: newPlayer, error: playerError } = await supabase.from('players').insert([{
                room_id: newRoom.id,
                name: hostName,
                avatar: fullAvatar,
                is_host: true
            }]).select().single();

            if (playerError) throw playerError;

            await supabase.from('rooms').update({
                settings: { ...newRoom.settings, manual_host_id: newPlayer.id }
            }).eq('id', newRoom.id);

            const { data: newState, error: stateError } = await supabase.from('game_state').insert([{
                room_id: newRoom.id,
                phase: 'lobby',
                timer: 0
            }]).select().single();

            if (stateError) throw stateError;

            sessionStorage.setItem(`room_session_${code}`, JSON.stringify({
                playerId: newPlayer.id,
                roomId: newRoom.id,
                roomCode: code,
                fingerprint
            }));

            setRoom(newRoom);
            setPlayers([newPlayer]);
            setGameState(newState);
            setCurrentPlayer({
                id: newPlayer.id,
                name: hostName,
                avatar,
                fingerprint,
                is_host: true,
                room_id: newRoom.id
            });

        } catch (err) {
            console.error('Error creating room:', err);
            setError(`${t('errorCreatingPhase')} - ${err.message || JSON.stringify(err)}`);
        } finally {
            isJoiningRef.current = false;
        }
    }, [setError, t, setRoom, setPlayers, setGameState, setCurrentPlayer, isJoiningRef]);

    return {
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
    };
};
