import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useRoom } from '../contexts/RoomContext';
import { useSound } from '../contexts/SoundContext';

function Home({ isDarkMode, toggleTheme }) {
    const navigate = useNavigate();
    const { language, setLanguage, t } = useLanguage();
    const location = useLocation();
    const { leaveRoom, clearError } = useRoom();
    const { isMuted, toggleMute, playSound } = useSound();
    const [redirectError, setRedirectError] = useState(location.state?.error || null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isLanguageOpen, setIsLanguageOpen] = useState(false);
    const [isClosing, setIsClosing] = useState(false);

    // Ensure we are not in any room when on the home page
    useEffect(() => {
        leaveRoom();
    }, [location.pathname]);

    // Auto-clear redirect error
    useEffect(() => {
        if (redirectError) {
            const timer = setTimeout(() => {
                setRedirectError(null);
                // Clear the state from location history
                navigate(location.pathname, { replace: true, state: {} });
            }, 4000);
            return () => clearTimeout(timer);
        }
    }, [redirectError]);

    const handleCloseSettings = () => {
        setIsClosing(true);
        setTimeout(() => {
            setIsSettingsOpen(false);
            setIsClosing(false);
            setIsLanguageOpen(false);
        }, 300); // Match animation duration
    };

    // Prevent body scroll when settings menu is open
    useEffect(() => {
        if (isSettingsOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [isSettingsOpen]);

    const palette = {
        primary: '#6C63FF',
        darkPurple: '#4C1D95',
        bgLight: '#F3F4F6',
        textDark: '#1F2937',
        textLight: '#F9FAFB'
    };

    const languages = [
        { name: 'en', label: 'English' },
        { name: 'fr', label: 'French' },
        { name: 'ar', label: 'Arabic' }
    ];

    return (
        <div className="app-container" style={{ position: 'relative', minHeight: '100dvh', overflow: 'hidden' }}>
            {/* Settings Trigger Button */}
            <button
                className="settings-btn"
                aria-label="Settings"
                onClick={() => {
                    playSound('tap');
                    setIsSettingsOpen(true);
                }}
                style={{ zIndex: 10 }}
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="settings-icon">
                    <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L3.15 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
                </svg>
            </button>

            {/* Settings Menu Overlay */}
            {isSettingsOpen && (
                <div
                    className={`settings-overlay ${isClosing ? 'fadeOut' : 'fadeIn'}`}
                    onClick={handleCloseSettings}
                    style={{
                        position: 'fixed', top: 0, left: 0, width: '100%', height: '100dvh',
                        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)',
                        zIndex: 100, display: 'flex', justifyContent: 'center', alignItems: 'center'
                    }}
                >
                    <div
                        className={`settings-menu ${isClosing ? 'slideOutDown' : 'slideInUp'}`}
                        onClick={e => e.stopPropagation()}
                        style={{
                            background: isDarkMode ? '#1F2937' : 'white',
                            width: '90%', maxWidth: '400px', borderRadius: '40px',
                            padding: '40px 30px', position: 'relative',
                            boxShadow: '0 25px 50px rgba(0,0,0,0.2)'
                        }}
                    >
                        {/* Mute/Unmute Button (Matching main settings btn style) */}
                        <button
                            className="settings-btn"
                            aria-label={isMuted ? "Unmute" : "Mute"}
                            onClick={() => {
                                playSound('tap');
                                toggleMute();
                            }}
                            style={{
                                position: 'absolute',
                                top: '20px',
                                left: '25px', // Adjusted for modal padding
                                transform: 'rotate(4deg)', // Different tilt for variety
                                zIndex: 10
                            }}
                        >
                            {isMuted ? (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="settings-icon">
                                    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                                </svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="settings-icon">
                                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                                </svg>
                            )}
                        </button>
                        {/* Close Button */}
                        <button
                            onClick={() => {
                                playSound('tap');
                                handleCloseSettings();
                            }}
                            style={{
                                position: 'absolute', top: '20px', right: '25px',
                                background: 'none', border: 'none', fontSize: '1.5rem',
                                color: isDarkMode ? '#F9FAFB' : '#1F2937', cursor: 'pointer', opacity: 0.6,
                                zIndex: 10
                            }}
                        >
                            ✕
                        </button>

                        <h2 style={{
                            textAlign: 'center', color: isDarkMode ? '#F9FAFB' : palette.darkPurple,
                            fontWeight: '900', fontSize: '2.2rem', marginBottom: '35px'
                        }}>
                            {t('settings')}
                        </h2>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            {/* Dark Mode Toggle */}
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                background: isDarkMode ? 'rgba(255,255,255,0.05)' : '#F3F4F6',
                                padding: '15px 20px', borderRadius: '20px'
                            }}>
                                <span style={{ fontWeight: '800', color: isDarkMode ? '#F9FAFB' : '#4B5563', fontSize: '1.1rem' }}>
                                    {t('darkMode')}
                                </span>
                                <div
                                    onClick={() => {
                                        playSound('tap');
                                        toggleTheme();
                                    }}
                                    style={{
                                        width: '60px', height: '32px', borderRadius: '20px',
                                        background: isDarkMode ? palette.primary : '#D1D5DB',
                                        position: 'relative', cursor: 'pointer', transition: 'all 0.3s ease'
                                    }}
                                >
                                    <div style={{
                                        position: 'absolute', top: '4px',
                                        left: isDarkMode ? '32px' : '4px',
                                        width: '24px', height: '24px', borderRadius: '50%',
                                        background: 'white', transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem'
                                    }}>
                                        {isDarkMode ? '🌙' : '☀️'}
                                    </div>
                                </div>
                            </div>

                            {/* Language Selector */}
                            <div>
                                <button
                                    onClick={() => {
                                        playSound('tap');
                                        setIsLanguageOpen(!isLanguageOpen);
                                    }}
                                    className="menu-item-btn"
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        flexDirection: 'inherit'
                                    }}
                                >
                                    {language === 'ar' ? (
                                        <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', pointerEvents: 'none' }}>
                                            <span>{t('language')}:</span>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <span style={{ color: palette.primary }}>{languages.find(l => l.name === language)?.label}</span>
                                                <span style={{
                                                    transform: isLanguageOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                                                    transition: 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                                                    display: 'inline-flex'
                                                }}>
                                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                                                </span>
                                            </span>
                                        </div>
                                    ) : (
                                        <>
                                            <div style={{ display: 'flex', gap: '5px', flexDirection: 'inherit' }}>
                                                <span>{t('language')}:</span>
                                                <span style={{ color: palette.primary }}>{languages.find(l => l.name === language)?.label}</span>
                                            </div>
                                            <span style={{
                                                transform: isLanguageOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                                                transition: 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                                                display: 'inline-flex'
                                            }}>
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                                            </span>
                                        </>
                                    )}
                                </button>

                                <div style={{
                                    maxHeight: isLanguageOpen ? '200px' : '0',
                                    opacity: isLanguageOpen ? '1' : '0',
                                    overflow: 'hidden',
                                    transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '8px',
                                    marginTop: isLanguageOpen ? '10px' : '0',
                                    paddingLeft: '10px'
                                }}>
                                    {languages.map(lang => (
                                        <div
                                            key={lang.name}
                                            onClick={() => {
                                                playSound('tap');
                                                setLanguage(lang.name);
                                                setIsLanguageOpen(false);
                                            }}
                                            style={{
                                                padding: '12px 15px',
                                                borderRadius: '15px',
                                                background: language === lang.name ? (isDarkMode ? 'rgba(108, 99, 255, 0.2)' : '#EEF2FF') : 'transparent',
                                                color: language === lang.name ? palette.primary : (isDarkMode ? '#9CA3AF' : '#6B7280'),
                                                fontWeight: '700',
                                                cursor: 'pointer',
                                                fontSize: '1rem',
                                                transition: 'all 0.2s ease',
                                                textAlign: language === 'ar' ? 'right' : 'left'
                                            }}
                                        >
                                            {lang.label}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <button className="menu-item-btn" onClick={() => { playSound('tap'); navigate('/how-to-play'); }}>{t('howToPlay')}</button>
                            <button className="menu-item-btn" onClick={() => { playSound('tap'); navigate('/terms'); }}>{t('terms')}</button>
                        </div>

                        {/* Social Icons */}
                        <div style={{
                            marginTop: '40px', display: 'flex', justifyContent: 'center', gap: '25px',
                            borderTop: `2px solid ${isDarkMode ? 'rgba(255,255,255,0.1)' : '#F3F4F6'}`,
                            paddingTop: '30px'
                        }}>
                            <a href="#" className="social-icon" onClick={() => playSound('tap')}>
                                <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" /></svg>
                            </a>
                            <a href="#" className="social-icon" onClick={() => playSound('tap')}>
                                <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.894.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" /></svg>
                            </a>
                            <a href="#" className="social-icon" onClick={() => playSound('tap')}>
                                <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M22.675 0h-21.35c-.732 0-1.325.593-1.325 1.325v21.351c0 .731.593 1.324 1.325 1.324h11.495v-9.294h-3.128v-3.622h3.128v-2.671c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.763v2.313h3.587l-.467 3.622h-3.12v9.293h6.116c.73 0 1.323-.593 1.323-1.325v-21.35c0-.732-.593-1.325-1.325-1.325z" /></svg>
                            </a>
                        </div>
                    </div>
                </div>
            )
            }



            {/* Error Popover from Redirects */}
            {
                redirectError && (
                    <div style={{
                        position: 'fixed',
                        top: '20px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        backgroundColor: '#EF4444',
                        color: 'white',
                        padding: '12px 24px',
                        borderRadius: '50px',
                        fontWeight: '800',
                        fontSize: '1.1rem',
                        boxShadow: '0 10px 25px rgba(239, 68, 68, 0.4)',
                        animation: 'slideInUpCentered 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                        display: 'flex', alignItems: 'center', gap: '8px',
                        zIndex: 2000
                    }}>
                        ⚠️ {t(redirectError) || redirectError}
                    </div>
                )
            }

            {/* Header Section */}
            <header className="header-section">
                <div className="title-container">
                    <h1 className="main-title">
                        What Did<br />You Mean<span className="bounce-emoji">?</span>
                    </h1>
                    <div className="confused-emoji">😵‍💫</div>
                </div>
            </header>

            {/* Main Actions */}
            <main className="actions-section">
                <button className="action-btn btn-join" onClick={() => {
                    playSound('tap');
                    clearError();
                    navigate('/join-room');
                }}>
                    {t('joinOnline')}
                </button>

                <button className="action-btn btn-create" onClick={() => {
                    playSound('tap');
                    clearError();
                    navigate('/avatar-selection?mode=create');
                }}>
                    {t('createRoom')}
                </button>
            </main>

            {/* Footer */}
            <footer className="footer-section">
                <p>
                    {t('poweredBy')} <a href="mailto:ahmedkhemiri454@gmail.com" className="footer-link-actual" style={{
                        cursor: 'pointer',
                        textDecoration: 'none',
                        color: palette.primary
                    }}>Ahmed Khemiri</a>
                </p>
                <p style={{ marginTop: '10px', fontSize: '10px', opacity: 0.7 }}>
                    v1.1.0
                </p>
            </footer>

            <style>{`
                .menu-item-btn {
                    width: 100%;
                    padding: 18px;
                    border: none;
                    background: ${isDarkMode ? 'rgba(255,255,255,0.05)' : '#F3F4F6'};
                    color: ${isDarkMode ? '#F9FAFB' : '#4B5563'};
                    border-radius: 20px;
                    font-size: 1.1rem;
                    font-weight: 800;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    text-align: start;
                }
                .menu-item-btn:hover {
                    background: ${isDarkMode ? 'rgba(255,255,255,0.1)' : '#E5E7EB'};
                    transform: ${language === 'ar' ? 'translateX(-5px)' : 'translateX(5px)'};
                }
                .menu-item-btn:active { transform: scale(0.98); }

                .social-icon {
                    color: ${isDarkMode ? '#F9FAFB' : palette.darkPurple};
                    opacity: 0.7;
                    transition: all 0.3s ease;
                }
                .social-icon:hover {
                    opacity: 1;
                    transform: translateY(-5px) scale(1.1);
                }

                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes fadeOut {
                    from { opacity: 1; }
                    to { opacity: 0; }
                }
                @keyframes slideInUp {
                    from { transform: translateY(100px) scale(0.9); opacity: 0; }
                    to { transform: translateY(0) scale(1); opacity: 1; }
                }
                @keyframes slideOutDown {
                    from { transform: translateY(0) scale(1); opacity: 1; }
                    to { transform: translateY(100px) scale(0.9); opacity: 0; }
                }
                @keyframes slideInUpCentered {
                    from { transform: translate(-50%, 100%) scale(0.9); opacity: 0; }
                    to { transform: translate(-50%, 0) scale(1); opacity: 1; }
                }

                .settings-overlay.fadeIn { animation: fadeIn 0.3s ease forwards; }
                .settings-overlay.fadeOut { animation: fadeOut 0.3s ease forwards; }
                .settings-menu.slideInUp { animation: slideInUp 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
                .settings-menu.slideOutDown { animation: slideOutDown 0.3s ease forwards; }

                /* Dark Mode Global Overrides */
                .dark-mode .app-container {
                    color: #F9FAFB !important;
                }
                .dark-mode .footer-section p {
                    color: #9CA3AF !important;
                }
                .dark-mode .main-title {
                    color: #F9FAFB !important;
                }
                .dark-mode .confused-emoji {
                    filter: drop-shadow(0 0 20px rgba(108, 99, 255, 0.3));
                }
                .dark-mode .bg-shape.shape-purple {
                    background: radial-gradient(circle, #4C1D95 0%, transparent 70%);
                }
            `}</style>
        </div >
    );
}

export default Home;
