export const decodePlayer = (p) => {
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
export const shuffleArr = (arr) => {
    const newArr = [...arr];
    for (let i = newArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
};

// Helper: Cyclic chain assignment to ensure a perfect "Telephone Ring" pass.
// playerIds: array of strictly ordered player IDs for the current round.
// chains: the dictionary of all chains.
// currentPhase: the phase we are generating assignments for.
// randomOffsets: optional array of randomized offsets for each round.
export const generateChainAssignments = (playerIds, chains, currentPhase, randomOffsets = null) => {
    // 1. Determine which round we are on.
    const isEmojiOnly = false; // Logic handled by phase names
    let roundIndex = 0;

    if (currentPhase.startsWith('emoji_')) {
        const num = parseInt(currentPhase.split('_')[1], 10);
        roundIndex = (num * 2) - 1; // emoji_1 = 1, emoji_2 = 3, emoji_3 = 5
    } else if (currentPhase.startsWith('interpretation_')) {
        const num = parseInt(currentPhase.split('_')[1], 10);
        roundIndex = (num * 2); // interpretation_1 = 2, interpretation_2 = 4
    }

    const playerCount = playerIds.length;
    const assignments = {};

    // 2. Select offset (Randomized or Deterministic Fallback)
    let pushOffset = roundIndex;
    if (randomOffsets && Array.isArray(randomOffsets) && roundIndex > 0) {
        // Use the index directly. Offset 0 is reserved for 'text' phase (offset 0).
        pushOffset = randomOffsets[roundIndex - 1] || roundIndex;
    }

    // CRITICAL FIX: If the player count has changed (player left), a previously safe 
    // randomized offset might now align perfectly with the creator again (e.g. 3 % 3 = 0).
    // We MUST force a non-zero offset if there's more than one player.
    if (playerCount > 1 && (pushOffset % playerCount) === 0) {
        console.log(`generateChainAssignments: Offset ${pushOffset} collides with creator for pool of ${playerCount}. Forcing safe shift...`);
        // We use a deterministic but unique-per-round shift as a fallback: (roundIndex % (N-1)) + 1
        // This is guaranteed to be in range [1, playerCount-1], which is always a valid "pass".
        pushOffset = (roundIndex % (playerCount - 1)) + 1;
    }

    // Safety check: if only 1 player, no offset possible
    if (playerCount <= 1) {
        playerIds.forEach(pId => {
            const chainId = Object.keys(chains).find(cId => chains[cId].creator_id === pId);
            if (chainId) assignments[pId] = chainId;
        });
        return assignments;
    }

    // Pass the notebooks in a circle
    playerIds.forEach((pId, idx) => {
        // Find the creator we are receiving the chain from by moving BACKWARDS around the ring
        const originCreatorIdx = (idx - (pushOffset % playerCount) + playerCount) % playerCount;
        const originCreatorId = playerIds[originCreatorIdx];

        const chainId = Object.keys(chains).find(cId => chains[cId].creator_id === originCreatorId);
        if (chainId) {
            assignments[pId] = chainId;
        }
    });

    return assignments;
};

// Generate dynamic phase sequence strictly up to N players
export const getNextPhase = (currentPhase, roomSettings) => {
    const isEmojiOnly = roomSettings?.selectedMode === 'Emoji Only';
    const totalPlayers = roomSettings?.player_order?.length || 0;

    if (totalPlayers === 0) return null;

    // We build the phase list dynamically based on the total player count.
    // Length of the phase list MUST EQUAL the number of players.
    // e.g. 3 Players: text -> emoji_1 -> interpretation_1
    // 4 Players: text -> emoji_1 -> interpretation_1 -> emoji_2
    const phaseOrder = ['text'];
    for (let i = 1; i < totalPlayers; i++) {
        if (isEmojiOnly) {
            phaseOrder.push(`emoji_${i}`);
        } else {
            // Alternating pattern
            const roundNumber = Math.ceil(i / 2);
            if (i % 2 !== 0) {
                phaseOrder.push(`emoji_${roundNumber}`);
            } else {
                phaseOrder.push(`interpretation_${roundNumber}`);
            }
        }
    }

    // Add finishing phases
    phaseOrder.push('reveal', 'vote', 'scoreboard', 'winner');

    const currentIndex = phaseOrder.indexOf(currentPhase);

    // Fallback: If player count dropped and the current phase is no longer in the generated sequence,
    // safely jump to the Reveal phase to keep the game moving.
    if (currentIndex === -1) {
        const isGameplayPhase = currentPhase.startsWith('text') || currentPhase.startsWith('emoji') || currentPhase.startsWith('interpretation');
        if (isGameplayPhase) return 'reveal';
        return null;
    }

    if (currentIndex >= phaseOrder.length - 1) return null;

    return phaseOrder[currentIndex + 1];
};

// Dynamic Phase Priority: Higher number means later in the game.
// We evaluate it exactly the same way getNextPhase generates the list.
export const getPhasePriority = (currentPhase, roomSettings) => {
    if (currentPhase === 'lobby') return 0;
    if (currentPhase === 'text') return 1;

    // We can infer the priority quickly by rebuilding the list.
    const isEmojiOnly = roomSettings?.selectedMode === 'Emoji Only';
    const totalPlayers = roomSettings?.player_order?.length || 0;

    const phaseOrder = ['text'];
    for (let i = 1; i < totalPlayers; i++) {
        if (isEmojiOnly) {
            phaseOrder.push(`emoji_${i}`);
        } else {
            const roundNumber = Math.ceil(i / 2);
            if (i % 2 !== 0) {
                phaseOrder.push(`emoji_${roundNumber}`);
            } else {
                phaseOrder.push(`interpretation_${roundNumber}`);
            }
        }
    }
    phaseOrder.push('reveal', 'vote', 'scoreboard', 'winner');

    const idx = phaseOrder.indexOf(currentPhase);
    return idx !== -1 ? idx + 1 : -1;
};
