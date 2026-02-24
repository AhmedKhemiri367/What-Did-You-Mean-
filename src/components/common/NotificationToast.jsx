import React, { useState, useEffect, useRef } from 'react';
import { useRoom } from '../../contexts/RoomContext';
import './NotificationToast.css';

const SwipableToast = ({ notification, onDismiss }) => {
    const [dragX, setDragX] = useState(0);
    const [dragY, setDragY] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [isDismissing, setIsDismissing] = useState(null); // 'right', 'up', or 'auto'
    const startPos = useRef({ x: 0, y: 0 });

    // Handle smooth auto-dismiss (trigger animation 400ms before removal)
    useEffect(() => {
        const timer = setTimeout(() => {
            setIsDismissing('auto');
            setDragX(500); // Auto-dismiss slides to the right
            setTimeout(onDismiss, 400);
        }, 4600);
        return () => clearTimeout(timer);
    }, [onDismiss]);

    const handlePointerDown = (e) => {
        if (isDismissing) return;
        setIsDragging(true);
        startPos.current = { x: e.clientX, y: e.clientY };
        e.target.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startPos.current.x;
        const dy = e.clientY - startPos.current.y;

        // Only allow dragging in "dismiss" directions (Right or Up/Down-ish but capped)
        setDragX(Math.max(-50, dx)); // Little bit of left-drag allowed for weight
        setDragY(dy);
    };

    const handlePointerUp = (e) => {
        if (!isDragging) return;
        setIsDragging(false);
        e.target.releasePointerCapture(e.pointerId);

        // Thresholds with dynamic exit vectors
        if (dragX > 100) {
            setIsDismissing('right');
            setDragX(window.innerWidth > 0 ? window.innerWidth : 500);
            setTimeout(onDismiss, 400);
        } else if (dragY < -60) {
            setIsDismissing('up');
            setDragY(-window.innerHeight > 0 ? -window.innerHeight : -500);
            setTimeout(onDismiss, 400);
        } else {
            // Reset
            setDragX(0);
            setDragY(0);
        }
    };

    const style = {
        transform: `translate(${dragX}px, ${dragY}px) scale(${isDismissing ? 0.9 : 1})`,
        maxHeight: isDismissing ? '0px' : '300px',
        margin: isDismissing ? '0px' : '6px 0',
        opacity: isDismissing ? 0 : 1,
        paddingTop: isDismissing ? '0px' : '12px',
        paddingBottom: isDismissing ? '0px' : '12px',
        transition: isDragging ? 'none' : 'all 0.4s cubic-bezier(0.19, 1, 0.22, 1)',
        touchAction: 'none'
    };

    const className = `notification-toast ${notification.type} ${isDismissing ? `dismissing-${isDismissing}` : ''}`;

    return (
        <div
            className={className}
            style={style}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
        >
            <span className="notification-icon">
                {notification.type === 'success' ? '⚡' : notification.type === 'error' ? '🛑' : notification.type === 'info' ? '👻' : '⚠️'}
            </span>
            <span className="notification-message">{notification.message}</span>
        </div>
    );
};

const NotificationToast = () => {
    const { notifications, removeNotification } = useRoom();

    if (!notifications || notifications.length === 0) return null;

    return (
        <div className="notification-stack">
            {notifications.map((n) => (
                <SwipableToast
                    key={n.id}
                    notification={n}
                    onDismiss={() => removeNotification(n.id)}
                />
            ))}
        </div>
    );
};

export default NotificationToast;
