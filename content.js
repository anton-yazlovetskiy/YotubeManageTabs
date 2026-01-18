// === 1. ВИЗУАЛ (Оверлей + Неон) ===
const styleEl = document.createElement('style');
styleEl.textContent = `
    .yt-ext-neon {
        outline: 4px solid #0f0 !important;
        outline-offset: -4px !important;
        box-shadow: inset 0 0 20px rgba(0, 255, 0, 0.7) !important;
        transition: all 0.1s ease-in-out !important;
        z-index: 9999 !important;
    }
    
    #yt-speed-overlay {
        position: fixed;
        top: 40%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.85);
        color: #fff;
        padding: 20px 50px;
        border-radius: 15px;
        font-family: sans-serif;
        font-size: 80px;
        font-weight: bold;
        z-index: 2147483647;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease-out;
        box-shadow: 0 0 40px rgba(0,0,0,0.8);
        text-shadow: 0 0 10px black;
        border: 2px solid rgba(255,255,255,0.2);
    }
`;
(document.documentElement || document.head).appendChild(styleEl);


// === 2. ХЕЛПЕРЫ ===
function getVideoId(url) {
    if (!url) return null;
    const match = url.match(/(?:v=|shorts\/|youtu\.be\/)([\w-]{11})/);
    return match ? match[1] : null;
}

// Оверлей
let overlayTimer;
function showOverlay(text) {
    let overlay = document.getElementById('yt-speed-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'yt-speed-overlay';
        (document.documentElement || document.body).appendChild(overlay);
    }

    overlay.textContent = text;
    overlay.style.transition = 'none'; 
    overlay.style.opacity = '1';
    
    if (overlayTimer) clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => {
        overlay.style.transition = 'opacity 0.5s ease-out';
        overlay.style.opacity = '0';
    }, 600);
}


// === 3. ЛОГИКА СКОРОСТИ (УПРОЩЕННАЯ СЕССИОННАЯ) ===

let CACHE = {
    global: 1.5,
    lastKnownRate: 1.5
};

// Загрузка глобальной скорости
chrome.storage.local.get(['preferredSpeed'], (res) => {
    let val = parseFloat(res.preferredSpeed);
    if (!val) { val = 1.5; chrome.storage.local.set({ preferredSpeed: '1.5' }); }
    CACHE.global = val;
});

// Функция применения (PEACEFUL)
function applySpeedOnce() {
    const video = document.querySelector('video');
    if (!video) return;

    // 1. Проверяем ОБЩУЮ локальную настройку для этой вкладки
    // Больше не привязываемся к ID видео.
    const localVal = sessionStorage.getItem('yt_manual_speed');

    // 2. Выбираем скорость: Локальная > Глобальная
    const target = localVal ? parseFloat(localVal) : CACHE.global;

    // 3. Применяем (только если отличается, чтобы не спамить)
    if (Math.abs(video.playbackRate - target) > 0.05) {
        video.playbackRate = target;
    }
    
    CACHE.lastKnownRate = target;
}


// === 4. ХОТКЕИ ===

window.addEventListener('keydown', (e) => {
    if (e.shiftKey && (e.key === '.' || e.key === '>' || e.key === ',' || e.key === '<')) {
        e.preventDefault();
        e.stopPropagation();

        const video = document.querySelector('video');
        if (!video) return;

        let current = video.playbackRate;
        let delta = (e.key === '.' || e.key === '>') ? 0.25 : -0.25;
        let next = current + delta;

        // Лимиты
        if (next < 0.25) next = 0.25;
        if (next > 3.0) next = 3.0;

        // ЗАПИСЫВАЕМ В ПАМЯТЬ СЕССИИ (Для вкладки в целом)
        sessionStorage.setItem('yt_manual_speed', next);
        
        // Применяем
        video.playbackRate = next;
        CACHE.lastKnownRate = next;
        showOverlay(`${next.toFixed(2)}x`);
    }
}, true);


// === 5. ИНИЦИАЛИЗАЦИЯ ВИДЕО ===

function initVideo(video) {
    if (video.dataset.ytExtInit) return;
    video.dataset.ytExtInit = "true";

    // Применяем скорость при старте
    applySpeedOnce();

    // Слушаем изменения (чтобы хоткеи работали плавно от текущей)
    video.addEventListener('ratechange', () => {
        CACHE.lastKnownRate = video.playbackRate;
    });

    // Конец видео
    video.addEventListener('ended', () => {
        if (!location.search.includes('list=')) {
            chrome.runtime.sendMessage({ action: 'VIDEO_ENDED' });
        }
    });
}


// === 6. ПЕРЕХВАТ КЛИКОВ ===

window.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;

    const vid = getVideoId(link.href);
    const isTarget = vid && (link.href.includes('/watch') || link.href.includes('/shorts/') || location.pathname === '/' || location.pathname.includes('/feed'));

    if (isTarget) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // История для подсветки
        let history = new Set();
        try {
            const s = localStorage.getItem('yt_history_ids');
            if (s) history = new Set(JSON.parse(s));
        } catch(e){}
        history.add(vid);
        
        if (history.size > 500) {
            const arr = Array.from(history);
            history = new Set(arr.slice(arr.length - 500));
        }
        localStorage.setItem('yt_history_ids', JSON.stringify(Array.from(history)));

        link.classList.add('yt-ext-neon');
        chrome.runtime.sendMessage({ action: 'OPEN_BACKGROUND_TAB', url: link.href });

        return false;
    }
}, true);


// === 7. МУТАЦИИ И ТАЙМЕРЫ ===

const observer = new MutationObserver(() => {
    const video = document.querySelector('video');
    if (video) {
        // Мы больше не сбрасываем manual override при смене URL.
        // Если юзер поставил 2х, следующее видео в этой вкладке тоже будет 2х.
        initVideo(video);
    }
});
observer.observe(document.documentElement, { childList: true, subtree: true });

// Подсветка (Loop)
function highlightLoop() {
    let history = new Set();
    try {
        const s = localStorage.getItem('yt_history_ids');
        if (s) history = new Set(JSON.parse(s));
    } catch(e){}

    const links = document.querySelectorAll('a#thumbnail, a.ytd-thumbnail');
    for (let i = 0; i < links.length; i++) {
        const link = links[i];
        if (!link.href) continue;
        const vid = getVideoId(link.href);
        
        if (vid && history.has(vid)) {
            if (!link.classList.contains('yt-ext-neon')) link.classList.add('yt-ext-neon');
        } else {
            if (link.classList.contains('yt-ext-neon')) link.classList.remove('yt-ext-neon');
        }
    }
    requestAnimationFrame(highlightLoop);
}
highlightLoop();


// === 8. СООБЩЕНИЯ ===
chrome.runtime.onMessage.addListener((msg) => {
    // 1. Изменение глобальной настройки
    if (msg.action === 'updateGlobalConfig') {
        CACHE.global = msg.newSpeed;
        // Если ручной настройки нет - обновляем текущее видео сразу
        if (!sessionStorage.getItem('yt_manual_speed')) {
            applySpeedOnce();
        }
    }
    
    // 2. Сброс (RESET)
    if (msg.action === 'resetToGlobal') {
        sessionStorage.removeItem('yt_manual_speed'); // Просто удаляем ключ сессии
        applySpeedOnce(); // Применится глобальная
        showOverlay(`Reset: ${CACHE.global}x`);
    }

    // 3. Активация вкладки
    if (msg.action === 'syncPlayAndSpeed') {
        const video = document.querySelector('video');
        if (video) {
            applySpeedOnce();
            if (video.paused) video.play().catch(()=>{});
            showOverlay(`${video.playbackRate.toFixed(2)}x`);
        }
    }
    
    if (msg.action === 'pauseVideo') {
        const video = document.querySelector('video');
        if (video && !video.paused) video.pause();
    }
});