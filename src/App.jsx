import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Lobby from './pages/Lobby';
import AvatarSelection from './pages/AvatarSelection';
import JoinRoom from './pages/JoinRoom';
import TextPhase from './pages/TextPhase';
import EmojiPhase from './pages/EmojiPhase';
import InterpretationPhase from './pages/InterpretationPhase';
import RevealPhase from './pages/RevealPhase';
import VotePhase from './pages/VotePhase';
import Scoreboard from './pages/Scoreboard';
import GameWinner from './pages/GameWinner';
import HowToPlay from './pages/HowToPlay';
import TermsAndConditions from './pages/TermsAndConditions';
import { LanguageProvider } from './contexts/LanguageContext';
import { RoomProvider, useRoom } from './contexts/RoomContext';
import { SoundProvider } from './contexts/SoundContext';
import NavigationGate from './components/NavigationGate';
import ScrollToTop from './components/common/ScrollToTop';
import NotificationToast from './components/common/NotificationToast';
import './App.css';

function App() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('isDarkMode');
    return saved === 'true' ? true : false;
  });

  const toggleTheme = () => setIsDarkMode(prev => !prev);

  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
    localStorage.setItem('isDarkMode', isDarkMode);
  }, [isDarkMode]);

  return (
    <LanguageProvider>
      <SoundProvider>
        <BrowserRouter>
          <RoomProvider>
            <ScrollToTop />
            <NavigationGate />
            <NotificationToast />
            {/* Global Background Elements */}
            <div className="bg-shape shape-purple"></div>
            <div className="bg-shape shape-yellow"></div>
            <div className="floating-emoji emoji-controller">🎮</div>
            <div className="floating-emoji emoji-cloud">☁️</div>

            <GameBody isDarkMode={isDarkMode} toggleTheme={toggleTheme} />
          </RoomProvider>
        </BrowserRouter>
      </SoundProvider>
    </LanguageProvider>
  );
}

function GameBody({ isDarkMode, toggleTheme }) {
  const { gameState } = useRoom();
  const phaseKey = gameState?.phase || 'initial';

  return (
    <Routes>
      <Route path="/" element={<Home isDarkMode={isDarkMode} toggleTheme={toggleTheme} />} />
      <Route path="/join-room" element={<JoinRoom isDarkMode={isDarkMode} />} />
      <Route path="/avatar-selection" element={<AvatarSelection isDarkMode={isDarkMode} />} />
      <Route path="/lobby" element={<Lobby isDarkMode={isDarkMode} />} />
      <Route path="/text-phase" element={<TextPhase isDarkMode={isDarkMode} />} />
      <Route path="/emoji-phase" element={<EmojiPhase isDarkMode={isDarkMode} />} />
      <Route path="/interpretation-phase" element={<InterpretationPhase isDarkMode={isDarkMode} />} />
      <Route path="/reveal-phase" element={<RevealPhase isDarkMode={isDarkMode} />} />
      <Route path="/vote" element={<VotePhase isDarkMode={isDarkMode} />} />
      <Route path="/scoreboard" element={<Scoreboard isDarkMode={isDarkMode} />} />
      <Route path="/game-winner" element={<GameWinner isDarkMode={isDarkMode} />} />
      <Route path="/how-to-play" element={<HowToPlay isDarkMode={isDarkMode} />} />
      <Route path="/terms" element={<TermsAndConditions isDarkMode={isDarkMode} />} />
    </Routes>
  );
}

export default App;
