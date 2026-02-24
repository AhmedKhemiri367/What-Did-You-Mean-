import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

/**
 * Universal Navigation Gate
 * Listens for browser 'popstate' events (back/forward).
 * - Setup Pages: Forces redirect to Home.
 * - Game Pages: Shows confirmation alert before leaving.
 */
function NavigationGate() {
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        const path = location.pathname;
        const gamePaths = ['/lobby', '/text-phase', '/emoji-phase', '/interpretation-phase', '/reveal-phase', '/vote', '/scoreboard', '/game-winner'];
        const isGamePath = gamePaths.includes(path);

        const handleBrowserNavigation = (event) => {
            if (isGamePath) {
                // TRAP LOGIC: User tried to go back from a game page
                // Browser url has already changed by now.
                const confirmLeave = window.confirm("Are you sure you want to leave the game? Your progress will be lost.");

                if (confirmLeave) {
                    // User wants to leave -> Go to Home + Clear History Loop
                    navigate('/', { replace: true });
                } else {
                    // User wants to stay -> Restore the trap
                    // We push the current state again to undo the "back" action effectively
                    window.history.pushState(null, null, window.location.href);
                }
            } else {
                // UNIVERSAL HOME LOGIC: User tried to go back from non-game page
                if (window.location.pathname !== '/') {
                    navigate('/', { replace: true });
                }
            }
        };

        // SETUP TRAP: If in game, push a dummy state so "Back" stays on page (conceptually)
        // Check if we already have a dummy state for this path to avoid stack bloat
        if (isGamePath && window.history.state?.isTrap !== true) {
            window.history.pushState({ isTrap: true }, null, window.location.href);
        }

        window.addEventListener('popstate', handleBrowserNavigation);

        return () => {
            window.removeEventListener('popstate', handleBrowserNavigation);
        };
    }, [navigate, location.pathname]);

    return null; // Side-effect only component
}

export default NavigationGate;
