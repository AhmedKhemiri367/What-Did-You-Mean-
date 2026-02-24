import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useSound } from '../contexts/SoundContext';

function TermsAndConditions({ isDarkMode }) {
    const navigate = useNavigate();
    const { t } = useLanguage();
    const { playSound } = useSound();

    const cardBg = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.9)';
    const textColor = isDarkMode ? '#F9FAFB' : '#1F2937';
    const subTextColor = isDarkMode ? '#9CA3AF' : '#6B7280';
    const primaryColor = '#6C63FF';

    return (
        <div className="app-container" style={{ padding: '2rem', minHeight: '100dvh', overflowY: 'auto' }}>

            <header style={{ marginBottom: '40px', textAlign: 'center' }}>
                <h1 style={{ color: isDarkMode ? '#C4B5FD' : '#4C1D95', fontSize: '2.5rem', fontWeight: '900', marginBottom: '10px' }}>
                    {t('termsTitle')}
                </h1>
            </header>

            <div style={{
                background: cardBg,
                padding: '40px',
                borderRadius: '35px',
                maxWidth: '700px',
                width: '100%',
                margin: '0 auto',
                boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
                backdropFilter: 'blur(10px)',
                border: isDarkMode ? '1px solid rgba(255,255,255,0.1)' : '1px solid white'
            }}>
                <div style={{ color: textColor, fontSize: '1.1rem', fontWeight: '600', lineHeight: '1.8', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <p>{t('termsContent')}</p>
                    <hr style={{ border: 'none', borderTop: isDarkMode ? '1px solid rgba(255,255,255,0.1)' : '1px solid #E5E7EB', margin: '10px 0' }} />
                    <p style={{ color: subTextColor, fontSize: '1rem', fontStyle: 'italic' }}>
                        {t('privacyNote')}
                    </p>
                </div>
            </div>

            <footer style={{ marginTop: '50px', display: 'flex', justifyContent: 'center' }}>
                <button
                    onClick={() => { playSound('tap'); navigate('/'); }}
                    className="action-btn"
                    style={{ width: '200px', backgroundColor: primaryColor }}
                >
                    {t('back')} 🏠
                </button>
            </footer>
        </div>
    );
}

export default TermsAndConditions;
