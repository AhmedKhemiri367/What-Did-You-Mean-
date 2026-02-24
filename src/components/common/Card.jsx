import React from 'react';

const Card = ({ children, className = '' }) => {
    return (
        <div className={`bg-white rounded-2xl shadow-lg p-6 w-full max-w-md mx-auto ${className}`} style={{ borderRadius: '24px', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}>
            {children}
        </div>
    );
};

export default Card;
