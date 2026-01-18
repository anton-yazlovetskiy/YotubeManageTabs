// === 1. ВНЕДРЕНИЕ СТИЛЕЙ (AGRESSIVE NEON) ===
// Используем outline, так как box-shadow часто обрезается youtube-ом (overflow: hidden)
const styleEl = document.createElement('style');
styleEl.textContent = `
    .yt-ext-neon {
        outline: 4px solid #0f0 !important;
        outline-offset: -4px !important;
        box-shadow: inset 0 0 20px rgba(0, 255, 0, 0.7) !important;
        transition: all 0.1s ease-in-out !important;
        z-index: 9999 !important;
    }
    /* Дополнительно подсвечиваем прогресс-бар, если он есть, чтобы видно было наверняка */
    .yt-ext-neon #progress {
        background: #0f0 !important;
    }
`;
(document.documentElement || document.head).appendChild(styleEl);


// === 2. STATE & STORAGE ===
const STATE = {
    speed: 1.5,
    clickedIds: new Set() // Используем Set для мгновенного доступа O(1)
};

// Восстановление истории (синхронно, сразу при старте)
try {
    const saved = localStorage.getItem('yt_history_ids');
    if (saved) {
        const parsed = JSON.parse(saved);
        parsed.forEach(id => STATE.clickedIds.add(id));
    }
} catch(e) {}


// === 3. СКОРОСТЬ ===

function loadSpeed() {
    chrome.storage.local.get(['preferredSpeed'], (res) => {
        let val = parseFloat(res.preferredSpeed);
        if (!val || val === 1.0) {
            val = 1.5;
            chrome.storage.local.set({ preferredSpeed: '1.5' });
        }
        STATE.speed = val;
        applySpeed();
    });
}
loadSpeed();

chrome.storage.onChanged.addListener((changes) => {
    if (changes.preferredSpeed) {
        STATE.speed = parseFloat(changes.preferredSpeed.newValue);
        applySpeed();
        showToast(`Скорость: ${STATE.speed.toFixed(2)}x`);
    }
});

function applySpeed() {
    const video = document.querySelector('video');
    if (video && Math.abs(video.playbackRate - STATE.speed) > 0.05) {
        video.playbackRate = STATE.speed;
    }
}


// === 4. ПОДСВЕТКА (ВЕЧНЫЙ ЦИКЛ 60FPS) ===

// Надежный парсер ID из любой ссылки
function getVideoId(url) {
    if (!url) return null;
    // Регулярка ловит: v=ID, shorts/ID, youtu.be/ID
    const match = url.match(/(?:v=|shorts\/|youtu\.be\/)([\w-]{11})/);
    return match ? match[1] : null;
}

function highlightLoop() {
    // Селектор берет и обычные видео, и шортсы, и результаты поиска
    const links = document.querySelectorAll('a#thumbnail, a.ytd-thumbnail');
    
    for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const href = link.href;
        
        // Оптимизация: если нет href, пропускаем
        if (!href) continue;

        const vid = getVideoId(href);

        if (vid && STATE.clickedIds.has(vid)) {
            // Проверка класса быстрее, чем его добавление
            if (!link.classList.contains('yt-ext-neon')) {
                link.classList.add('yt-ext-neon');
            }
        } else {
            // Если видео НЕ в списке, но класс есть (ютуб подменил контент) -> убираем
            if (link.classList.contains('yt-ext-neon')) {
                link.classList.remove('yt-ext-neon');
            }
        }
    }
    
    // Бесконечный цикл без таймеров, синхронно с рендером браузера
    requestAnimationFrame(highlightLoop);
}

// Запускаем цикл подсветки
highlightLoop();


// === 5. ПЕРЕХВАТ КЛИКОВ ===

window.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;

    const vid = getVideoId(link.href);
    
    // Условия: Есть ID + это ссылка на просмотр (или главная, чтобы ловить клики по тумбам)
    const isTarget = vid && (link.href.includes('/watch') || link.href.includes('/shorts/') || location.pathname === '/' || location.pathname.includes('/feed'));

    if (isTarget) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // 1. Сохраняем (в Set и в LocalStorage)
        STATE.clickedIds.add(vid);
        
        // Лимит истории (превращаем в массив, режем, возвращаем в Set)
        if (STATE.clickedIds.size > 500) {
            const arr = Array.from(STATE.clickedIds);
            STATE.clickedIds = new Set(arr.slice(arr.length - 500));
        }
        localStorage.setItem('yt_history_ids', JSON.stringify(Array.from(STATE.clickedIds)));

        // 2. Мгновенно красим нажатый элемент (не ждем цикла)
        link.classList.add('yt-ext-neon');

        // 3. Открываем
        chrome.runtime.sendMessage({ 
            action: 'OPEN_BACKGROUND_TAB', 
            url: link.href 
        });

        return false;
    }
}, true);


// === 6. TOAST (SHADOW DOM) ===

let toastRoot = null;

function showToast(text) {
    if (!toastRoot) {
        const host = document.createElement('div');
        host.style.cssText = "position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%); z-index: 2147483647; pointer-events: none;";
        (document.documentElement || document.body).appendChild(host);
        toastRoot = host.attachShadow({mode: 'open'});
    }
    
    toastRoot.innerHTML = '';
    const div = document.createElement('div');
    div.textContent = text;
    div.style.cssText = `
        background: white; color: black; padding: 12px 24px; border-radius: 25px;
        font-family: sans-serif; font-weight: bold; font-size: 18px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.5); opacity: 0; transition: opacity 0.2s;
    `;
    toastRoot.appendChild(div);
    
    requestAnimationFrame(() => div.style.opacity = '1');
    setTimeout(() => {
        div.style.opacity = '0';
        setTimeout(() => { if (div.parentNode) div.remove(); }, 200);
    }, 2000);
}


// === 7. СЛУШАТЕЛИ ФОНА И ВИДЕО ===

setInterval(() => {
    applySpeed();
    
    const v = document.querySelector('video');
    if (v && !v.dataset.endListener) {
        v.dataset.endListener = "true";
        v.addEventListener('ended', () => {
            if (!location.search.includes('list=')) {
                chrome.runtime.sendMessage({ action: 'VIDEO_ENDED' });
            }
        });
    }
}, 500);

chrome.runtime.onMessage.addListener((msg) => {
    const video = document.querySelector('video');
    
    if (msg.action === 'syncPlayAndSpeed') {
        if (video) {
            applySpeed();
            if (video.paused) video.play().catch(() => {});
        }
    } 
    else if (msg.action === 'pauseVideo') {
        if (video && !video.paused) video.pause();
    }
    else if (msg.action === 'forceUpdateSpeed') {
        STATE.speed = msg.newSpeed;
        applySpeed();
        showToast(`Скорость: ${STATE.speed.toFixed(2)}x`);
    }
});

// Хоткеи
window.addEventListener('keydown', (e) => {
    if (e.shiftKey && (e.key === '.' || e.key === '>' || e.key === ',' || e.key === '<')) {
        e.preventDefault(); e.stopPropagation();
        
        let delta = (e.key === '.' || e.key === '>') ? 0.25 : -0.25;
        let newVal = STATE.speed + delta;
        if (newVal < 0.25) newVal = 0.25;
        if (newVal > 3.0) newVal = 3.0;
        
        STATE.speed = newVal;
        chrome.storage.local.set({ preferredSpeed: newVal.toString() });
        
        applySpeed();
        showToast(`Скорость: ${newVal.toFixed(2)}x`);
    }
}, true);