import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useSound } from '../contexts/SoundContext';

function HowToPlay({ isDarkMode }) {
    const navigate = useNavigate();
    const { t, language } = useLanguage();
    const { playSound } = useSound();
    const isRTL = language === 'ar';

    const cardBg = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.9)';
    const textColor = isDarkMode ? '#F9FAFB' : '#1F2937';
    const subTextColor = isDarkMode ? '#9CA3AF' : '#6B7280';
    const primaryColor = '#6C63FF';

    const steps = [
        { title: t('step1Title'), desc: t('step1Desc'), emoji: '✍️' },
        { title: t('step2Title'), desc: t('step2Desc'), emoji: '🧩' },
        { title: t('step3Title'), desc: t('step3Desc'), emoji: '🧐' },
        { title: t('step4Title'), desc: t('step4Desc'), emoji: '🏆' }
    ];

    return (
        <div className="app-container" style={{ padding: '2rem', minHeight: '100dvh', overflowY: 'auto', direction: isRTL ? 'rtl' : 'ltr' }}>

            <header style={{ marginBottom: '40px', textAlign: 'center' }}>
                <h1 style={{ color: isDarkMode ? '#C4B5FD' : '#4C1D95', fontSize: '2.5rem', fontWeight: '900', marginBottom: '10px' }}>
                    {t('howToPlayTitle')}
                </h1>
                <p style={{ color: subTextColor, fontSize: '1.1rem', fontWeight: '600' }}>
                    {t('howToPlayDesc')}
                </p>
            </header>

            <div style={{ display: 'grid', gap: '20px', maxWidth: '600px', width: '100%', margin: '0 auto' }}>
                {steps.map((step, index) => (
                    <div key={index} style={{
                        background: cardBg,
                        padding: '25px',
                        borderRadius: '25px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '20px',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
                        backdropFilter: 'blur(10px)',
                        border: isDarkMode ? '1px solid rgba(255,255,255,0.1)' : '1px solid white'
                    }}>
                        <div style={{ fontSize: '3rem' }}>{step.emoji}</div>
                        <div style={{ textAlign: isRTL ? 'right' : 'left', flex: 1 }}>
                            <h3 style={{ color: primaryColor, fontSize: '1.3rem', fontWeight: '800', marginBottom: '5px' }}>
                                {step.title}
                            </h3>
                            <p style={{ color: textColor, fontSize: '1rem', fontWeight: '600', lineHeight: '1.4' }}>
                                {step.desc}
                            </p>
                        </div>
                    </div>
                ))}
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

export default HowToPlay;
