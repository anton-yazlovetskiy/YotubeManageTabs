// === 1. ВИЗУАЛ (Стили) ===
const styleEl = document.createElement('style');
styleEl.textContent = `
    /* Подсветка (Neon) */
    .yt-ext-neon {
        outline: 4px solid #0f0 !important;
        outline-offset: -4px !important;
        box-shadow: inset 0 0 20px rgba(0, 255, 0, 0.7) !important;
        transition: all 0.1s ease-in-out !important;
        z-index: 9999 !important;
        border-radius: 12px !important;
        display: block !important;
    }
    
    /* Уведомление (Toast) - ТЗ: 16px, снизу по центру */
    #yt-speed-toast {
        position: fixed;
        bottom: 15%; /* Чуть выше прогрессбара */
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.8);
        color: #fff;
        padding: 12px 24px;
        border-radius: 8px;
        font-family: Roboto, Arial, sans-serif;
        font-size: 16px; 
        font-weight: bold;
        z-index: 2147483647; /* Max Int */
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease-out;
        box-shadow: 0 4px 15px rgba(0,0,0,0.5);
        border: 1px solid rgba(255,255,255,0.1);
        text-align: center;
        text-shadow: 0 1px 2px black;
    }
`;
(document.documentElement || document.head).appendChild(styleEl);


// === 2. ХЕЛПЕРЫ ===

function getVideoId(url) {
    if (!url) return null;
    const match = url.match(/(?:v=|shorts\/|youtu\.be\/)([\w-]{11})/);
    return match ? match[1] : null;
}

let toastTimer;
function showToast(text) {
    let toast = document.getElementById('yt-speed-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'yt-speed-toast';
        (document.documentElement || document.body).appendChild(toast);
    }

    toast.textContent = text;
    toast.style.transition = 'none'; 
    toast.style.opacity = '1';
    
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.style.transition = 'opacity 0.5s ease-out';
        toast.style.opacity = '0';
    }, 2000);
}


// === 3. ЛОГИКА СКОРОСТИ ===

let CACHE = {
    global: 1.5,
    // Используем Map для хранения ручных настроек в рамках сессии вкладки,
    // чтобы при навигации "Назад/Вперед" настройки сохранялись корректно.
    manualSpeeds: new Map() 
};

// Загрузка глобальной скорости
chrome.storage.local.get(['preferredSpeed'], (res) => {
    let val = parseFloat(res.preferredSpeed);
    if (!val) { val = 1.5; chrome.storage.local.set({ preferredSpeed: '1.5' }); }
    CACHE.global = val;
});

function applySpeed(targetSpeed = null) {
    const video = document.querySelector('video');
    if (!video) return;

    // 1. Определяем какую скорость ставить
    let finalSpeed;
    const vid = getVideoId(location.href);

    if (targetSpeed !== null) {
        // Явная команда (хоткей или попап)
        finalSpeed = targetSpeed;
    } else {
        // Автоматический выбор: Если есть ручная для этого видео -> берем её, иначе Глобальная
        if (vid && CACHE.manualSpeeds.has(vid)) {
            finalSpeed = CACHE.manualSpeeds.get(vid);
        } else {
            finalSpeed = CACHE.global;
        }
    }

    // 2. Применяем
    if (Math.abs(video.playbackRate - finalSpeed) > 0.05) {
        video.playbackRate = finalSpeed;
    }
}


// === 4. ПЕРЕХВАТ КЛАВИАТУРЫ (ВАЖНО: Capture Phase) ===
// Мы слушаем события на window с флагом true. Это значит, мы ловим их ПЕРВЫМИ.

window.addEventListener('keydown', (e) => {
    // Shift + > (.) или Shift + < (,)
    if (e.shiftKey && (e.key === '.' || e.key === '>' || e.key === ',' || e.key === '<')) {
        
        // 1. БЛОКИРУЕМ YouTube
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation(); // Самое важное: не дать сработать другим скриптам

        const video = document.querySelector('video');
        if (!video) return;

        // 2. Логика изменения
        // Берем текущую скорость видео как базу (чтобы изменение было интуитивным)
        let current = video.playbackRate;
        let delta = (e.key === '.' || e.key === '>') ? 0.25 : -0.25;
        let next = current + delta;

        // 3. Лимиты (0.25 - 3.0)
        if (next < 0.25) next = 0.25;
        if (next > 3.0) next = 3.0;

        // 4. Сохраняем как ручную настройку для ЭТОГО видео
        const vid = getVideoId(location.href);
        if (vid) {
            CACHE.manualSpeeds.set(vid, next);
        }

        // 5. Применяем и уведомляем
        applySpeed(next);
        showToast(`${next.toFixed(2)}x`);
    }
}, true); // <--- TRUE (Capture)


// === 5. ПЕРЕХВАТ КЛИКОВ (ГЛАВНАЯ И ФИДЫ) ===

window.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;

    const vid = getVideoId(link.href);
    // Ловим клики везде: watch, shorts, feed, результаты поиска
    const isTarget = vid && (
        link.href.includes('/watch') || 
        link.href.includes('/shorts/') || 
        location.pathname === '/' || 
        location.pathname.includes('/feed') || 
        location.pathname.includes('/results')
    );

    if (isTarget) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // История (localStorage)
        let history = new Set();
        try {
            const s = localStorage.getItem('yt_history_ids');
            if (s) history = new Set(JSON.parse(s));
        } catch(e){}
        history.add(vid);
        
        if (history.size > 500) { // Чистка
            const arr = Array.from(history);
            history = new Set(arr.slice(arr.length - 500));
        }
        localStorage.setItem('yt_history_ids', JSON.stringify(Array.from(history)));

        // Визуал
        link.classList.add('yt-ext-neon');
        
        // Открытие
        chrome.runtime.sendMessage({ action: 'OPEN_BACKGROUND_TAB', url: link.href });

        return false;
    }
}, true);


// === 6. ПОДСВЕТКА (LOOP) ===
// Обновленные селекторы для Главной страницы и Поиска
function highlightLoop() {
    let history = new Set();
    try {
        const s = localStorage.getItem('yt_history_ids');
        if (s) history = new Set(JSON.parse(s));
    } catch(e){}

    // Селекторы:
    // a#thumbnail - классика (боковая панель, старая главная)
    // a.ytd-thumbnail - универсальный
    // ytd-rich-item-renderer a - главная страница (Grid)
    // ytd-video-renderer a - поиск
    const links = document.querySelectorAll('a#thumbnail, a.ytd-thumbnail, a[href^="/watch"]');
    
    for (let i = 0; i < links.length; i++) {
        const link = links[i];
        if (!link.href) continue;
        
        // Фильтруем мусор (ссылки на каналы, плейлисты без видео и т.д.)
        const vid = getVideoId(link.href);
        
        if (vid && history.has(vid)) {
            // Чтобы не было ложных срабатываний, проверяем, что это действительно тумбнейл видео
            // Обычно они содержат картинку yt-img-shadow
            if (link.querySelector('img') || link.id === 'thumbnail') {
                 if (!link.classList.contains('yt-ext-neon')) link.classList.add('yt-ext-neon');
            }
        } else {
            if (link.classList.contains('yt-ext-neon')) link.classList.remove('yt-ext-neon');
        }
    }
    requestAnimationFrame(highlightLoop);
}
highlightLoop();


// === 7. ИНИЦИАЛИЗАЦИЯ И СООБЩЕНИЯ ===

function initVideo(video) {
    if (video.dataset.ytExtInit) return;
    video.dataset.ytExtInit = "true";

    // При старте применяем скорость
    applySpeed();

    // Листенер конца
    video.addEventListener('ended', () => {
        if (!location.search.includes('list=')) {
            chrome.runtime.sendMessage({ action: 'VIDEO_ENDED' });
        }
    });
}

// SPA Навигация
const observer = new MutationObserver(() => {
    const video = document.querySelector('video');
    if (video) {
        initVideo(video);
    }
});
observer.observe(document.documentElement, { childList: true, subtree: true });

chrome.runtime.onMessage.addListener((msg) => {
    // 1. Активация вкладки (информирование о скорости)
    if (msg.action === 'syncPlayAndSpeed') {
        const video = document.querySelector('video');
        if (video) {
            applySpeed(); // Проверка на всякий случай
            if (video.paused) video.play().catch(()=>{});
            showToast(`${video.playbackRate.toFixed(2)}x`);
        }
    }

    // 2. Глобальное обновление
    if (msg.action === 'updateGlobalConfig') {
        CACHE.global = msg.newSpeed;
        // Если для текущего видео нет ручной настройки - обновляем
        const vid = getVideoId(location.href);
        if (vid && !CACHE.manualSpeeds.has(vid)) {
            applySpeed();
            showToast(`Global: ${CACHE.global}x`);
        }
    }

    // 3. Сброс (Reset Button)
    if (msg.action === 'resetToGlobal') {
        const vid = getVideoId(location.href);
        if (vid) {
            CACHE.manualSpeeds.delete(vid); // Удаляем ручную настройку
            applySpeed(); // Применится глобальная
            showToast(`Reset to ${CACHE.global}x`);
        }
    }
    
    if (msg.action === 'pauseVideo') {
        const video = document.querySelector('video');
        if (video && !video.paused) video.pause();
    }
});