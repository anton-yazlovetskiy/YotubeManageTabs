// === 1. ВНЕДРЕНИЕ СТИЛЕЙ (Neon) ===
const styleEl = document.createElement('style');
styleEl.textContent = `
    .yt-ext-neon {
        outline: 4px solid #0f0 !important;
        outline-offset: -4px !important;
        box-shadow: inset 0 0 20px rgba(0, 255, 0, 0.7) !important;
        transition: all 0.1s ease-in-out !important;
        z-index: 9999 !important;
    }
    .yt-ext-neon #progress { background: #0f0 !important; }
`;
(document.documentElement || document.head).appendChild(styleEl);


// === 2. STATE & STORAGE ===
const STATE = {
    globalSpeed: 1.5,      // Значение из настроек расширения
    manualSpeed: null,     // Значение для ТЕКУЩЕГО видео (установленное вручную)
    clickedIds: new Set(),
    currentVideoId: null,  // ID текущего видео (для SPA)
    isProgrammaticChange: false // Флаг: "это мы меняем скорость?"
};

// Восстановление истории просмотров
try {
    const saved = localStorage.getItem('yt_history_ids');
    if (saved) {
        JSON.parse(saved).forEach(id => STATE.clickedIds.add(id));
    }
} catch(e) {}


// === 3. СКОРОСТЬ (АГРЕССИВНАЯ ЗАЩИТА) ===

function loadGlobalSpeed() {
    chrome.storage.local.get(['preferredSpeed'], (res) => {
        let val = parseFloat(res.preferredSpeed);
        // Дефолт 1.5 только если совсем пусто
        if (!val && val !== 0) {
            val = 1.5;
            chrome.storage.local.set({ preferredSpeed: '1.5' });
        }
        STATE.globalSpeed = val;
        applySpeed();
    });
}
loadGlobalSpeed();

// Слушаем изменения глобальных настроек
chrome.storage.onChanged.addListener((changes) => {
    if (changes.preferredSpeed) {
        STATE.globalSpeed = parseFloat(changes.preferredSpeed.newValue);
        // Если меняем через настройки - это считается ручной установкой
        updateManualSpeed(STATE.globalSpeed);
        showToast(`Скорость: ${STATE.globalSpeed.toFixed(2)}x`);
    }
});

// Получить сохраненную скорость для конкретного видео
function restoreManualSpeed(vid) {
    const saved = sessionStorage.getItem(`yt_speed_${vid}`);
    return saved ? parseFloat(saved) : null;
}

// Обновить ручную скорость (и сохранить)
function updateManualSpeed(val) {
    STATE.manualSpeed = val;
    STATE.isProgrammaticChange = true; // Поднимаем флаг перед применением
    applySpeed();
    
    // Сохраняем в сессию
    const vid = getVideoId(location.href);
    if (vid) {
        sessionStorage.setItem(`yt_speed_${vid}`, val);
    }
}

// ГЛАВНАЯ ФУНКЦИЯ ПРИМЕНЕНИЯ
function applySpeed() {
    const video = document.querySelector('video');
    if (!video) return;

    // Приоритет: Ручная для этого видео > Глобальная
    const targetSpeed = STATE.manualSpeed !== null ? STATE.manualSpeed : STATE.globalSpeed;

    // Применяем, только если есть различие (защита от бесконечных триггеров)
    if (Math.abs(video.playbackRate - targetSpeed) > 0.05) {
        STATE.isProgrammaticChange = true; // Это МЫ меняем
        video.playbackRate = targetSpeed;
        
        // Сбрасываем флаг через мгновение (ratechange асинхронен)
        setTimeout(() => { STATE.isProgrammaticChange = false; }, 200);
    }
}


// === 4. ПОДСВЕТКА И TOOLS ===

function getVideoId(url) {
    if (!url) return null;
    const match = url.match(/(?:v=|shorts\/|youtu\.be\/)([\w-]{11})/);
    return match ? match[1] : null;
}

function highlightLoop() {
    const links = document.querySelectorAll('a#thumbnail, a.ytd-thumbnail');
    for (let i = 0; i < links.length; i++) {
        const link = links[i];
        if (!link.href) continue;
        const vid = getVideoId(link.href);

        if (vid && STATE.clickedIds.has(vid)) {
            if (!link.classList.contains('yt-ext-neon')) link.classList.add('yt-ext-neon');
        } else {
            if (link.classList.contains('yt-ext-neon')) link.classList.remove('yt-ext-neon');
        }
    }
    requestAnimationFrame(highlightLoop);
}
highlightLoop();


// === 5. ПЕРЕХВАТ КЛИКОВ ===

window.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;

    const vid = getVideoId(link.href);
    const isTarget = vid && (link.href.includes('/watch') || link.href.includes('/shorts/') || location.pathname === '/' || location.pathname.includes('/feed'));

    if (isTarget) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        STATE.clickedIds.add(vid);
        if (STATE.clickedIds.size > 500) {
            const arr = Array.from(STATE.clickedIds);
            STATE.clickedIds = new Set(arr.slice(arr.length - 500));
        }
        localStorage.setItem('yt_history_ids', JSON.stringify(Array.from(STATE.clickedIds)));

        link.classList.add('yt-ext-neon');
        chrome.runtime.sendMessage({ action: 'OPEN_BACKGROUND_TAB', url: link.href });

        return false;
    }
}, true);


// === 6. TOAST ===

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


// === 7. ТАЙМЕРЫ И СЛУШАТЕЛИ ===

// Проверка SPA и навешивание листенеров
setInterval(() => {
    // 1. Проверка смены видео (SPA)
    const currentVid = getVideoId(location.href);
    if (currentVid && currentVid !== STATE.currentVideoId) {
        STATE.currentVideoId = currentVid;
        // Восстанавливаем сохраненную скорость для ЭТОГО видео или сбрасываем в null
        STATE.manualSpeed = restoreManualSpeed(currentVid);
        applySpeed();
    }

    const v = document.querySelector('video');
    if (v) {
        // 2. Листенер окончания
        if (!v.dataset.endListener) {
            v.dataset.endListener = "true";
            v.addEventListener('ended', () => {
                if (!location.search.includes('list=')) {
                    chrome.runtime.sendMessage({ action: 'VIDEO_ENDED' });
                }
            });
        }

        // 3. Листенер изменения скорости (RATECHANGE)
        // Логика: если скорость изменилась "извне" (ютуб или юзер через плеер)
        if (!v.dataset.rateListener) {
            v.dataset.rateListener = "true";
            v.addEventListener('ratechange', () => {
                // Если это сделали МЫ (applySpeed) - игнорируем
                if (STATE.isProgrammaticChange) return;

                const newRate = v.playbackRate;
                
                // === АГРЕССИВНАЯ ЗАЩИТА ОТ СБРОСА ===
                // Если скорость стала 1.0, НО у нас была установлена другая ручная скорость (напр. 2.0)
                // Значит это Ютуб сбросил её (реклама, баг, простой).
                // МЫ ОТКАТЫВАЕМ ЭТО ИЗМЕНЕНИЕ.
                if (Math.abs(newRate - 1.0) < 0.01 && STATE.manualSpeed !== null && Math.abs(STATE.manualSpeed - 1.0) > 0.01) {
                    // console.log('YouTube reset detected. Reverting to:', STATE.manualSpeed);
                    applySpeed(); // Форсируем обратно наше значение
                    return;
                }

                // В любом другом случае (юзер поставил 1.25, 1.5 и т.д.) - запоминаем как новую норму
                updateManualSpeed(newRate);
            });
        }
        
        // 4. Мягкая проверка раз в полсекунды (на случай, если event не сработал)
        applySpeed();
    }
}, 500);

// Обработка сообщений
chrome.runtime.onMessage.addListener((msg) => {
    const video = document.querySelector('video');
    
    if (msg.action === 'syncPlayAndSpeed') {
        if (video) {
            applySpeed(); // Проверит сохраненную или глобальную и выставит
            if (video.paused) video.play().catch(() => {});
        }
    } 
    else if (msg.action === 'pauseVideo') {
        if (video && !video.paused) video.pause();
    }
    else if (msg.action === 'forceUpdateSpeed') {
        // Изменение из Popup всегда приоритетно
        updateManualSpeed(msg.newSpeed);
        showToast(`Скорость: ${msg.newSpeed.toFixed(2)}x`);
    }
});

// Хоткеи
window.addEventListener('keydown', (e) => {
    if (e.shiftKey && (e.key === '.' || e.key === '>' || e.key === ',' || e.key === '<')) {
        e.preventDefault(); e.stopPropagation();
        
        // База: текущая ручная или глобальная
        const base = STATE.manualSpeed !== null ? STATE.manualSpeed : STATE.globalSpeed;
        
        let delta = (e.key === '.' || e.key === '>') ? 0.25 : -0.25;
        let newVal = base + delta;
        if (newVal < 0.25) newVal = 0.25;
        if (newVal > 3.0) newVal = 3.0;
        
        // Хоткеи считаются ручной установкой
        updateManualSpeed(newVal);
        showToast(`Скорость: ${newVal.toFixed(2)}x`);
    }
}, true);