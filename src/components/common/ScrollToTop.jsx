import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const ScrollToTop = () => {
    const { pathname } = useLocation();

    useEffect(() => {
        // Scroll the window
        window.scrollTo({
            top: 0,
            left: 0,
            behavior: 'instant'
        });

        // Also scroll any potential scrollable containers
        const containers = document.querySelectorAll('.app-container, main, [style*="overflow-y: auto"]');
        containers.forEach(el => {
            el.scrollTo({ top: 0, behavior: 'instant' });
        });
    }, [pathname]);

    return null;
};

export default ScrollToTop;
