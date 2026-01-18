// content.js

// === КОНФИГУРАЦИЯ ===
const STATE = {
    globalSpeed: 1.5, // ЖЕСТКИЙ ДЕФОЛТ
    clickedVideos: [], 
    videoElement: null
};

// Загружаем историю кликов из localStorage (для живучести подсветки)
try {
    const saved = localStorage.getItem('yt_ext_clicked_videos');
    if (saved) {
        STATE.clickedVideos = JSON.parse(saved);
    }
} catch(e) {}

// Асинхронно обновляем глобальную скорость, если она была сохранена
chrome.storage.sync.get(['globalSpeed'], (res) => {
    // Если в сторадже есть значение, берем его. Если нет - оставляем 1.5
    if (res.globalSpeed !== undefined) {
        STATE.globalSpeed = res.globalSpeed;
    }
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.globalSpeed) {
        STATE.globalSpeed = changes.globalSpeed.newValue;
        applySpeed(); 
    }
});

// === ПОДСВЕТКА И КЛИКИ ===

function getVideoId(url) {
    try {
        const u = new URL(url);
        return u.searchParams.get('v');
    } catch (e) { return null; }
}

function saveClickedVideo(vidId) {
    if (!STATE.clickedVideos.includes(vidId)) {
        STATE.clickedVideos.push(vidId);
        if (STATE.clickedVideos.length > 200) STATE.clickedVideos.shift();
        localStorage.setItem('yt_ext_clicked_videos', JSON.stringify(STATE.clickedVideos));
    }
}

function highlightVideos() {
    // Используем Set для быстрого поиска
    const markedSet = new Set(STATE.clickedVideos);
    
    const links = document.querySelectorAll('a#thumbnail, a.ytd-thumbnail');
    for (let link of links) {
        // Пропускаем уже обработанные
        if (link.dataset.ytExtMarked) continue;

        const vid = getVideoId(link.href);
        if (vid && markedSet.has(vid)) {
            link.style.boxShadow = "0 0 15px 3px #0f0";
            link.style.transition = "box-shadow 0.3s";
            link.style.borderRadius = "12px";
            link.style.display = "block"; // Фикс для inline элементов
            link.dataset.ytExtMarked = "true";
        }
    }
}

window.addEventListener('click', function(e) {
    const link = e.target.closest('a');
    if (!link) return;

    const vidId = getVideoId(link.href);
    
    // Работаем только с ссылками на видео и только на главной или фиде
    if (vidId && (link.href.includes('/watch') || window.location.pathname === '/' || window.location.pathname === '/feed/subscriptions')) {
        
        // Игнорируем клики, если это Ctrl+Click (стандартное открытие в новой вкладке)
        // Но по ТЗ "максимально агрессивно", поэтому перехватываем всё
        
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // Сохраняем и подсвечиваем
        saveClickedVideo(vidId);
        
        link.style.boxShadow = "0 0 15px 3px #0f0";
        link.dataset.ytExtMarked = "true";

        chrome.runtime.sendMessage({
            action: 'OPEN_BACKGROUND_TAB',
            url: link.href
        });

        return false;
    }
}, true); // Capture phase

// Observer: используем более агрессивный подход для YouTube (SPA)
const observer = new MutationObserver((mutations) => {
    // YouTube часто меняет DOM. Просто запускаем подсветку.
    // Throttling не нужен, requestAnimationFrame внутри highlightVideos справится
    requestAnimationFrame(highlightVideos);
});

const startObserver = () => {
    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
        // Первый прогон
        highlightVideos();
    } else {
        setTimeout(startObserver, 100);
    }
};
startObserver();


// === ВИДЕО ПЛЕЕР И СКОРОСТЬ ===

function getSessionSpeed() {
    const vid = getVideoId(window.location.href);
    if (!vid) return null;
    const val = sessionStorage.getItem(`yt_speed_${vid}`);
    return val ? parseFloat(val) : null;
}

function setSessionSpeed(val) {
    const vid = getVideoId(window.location.href);
    if (vid) {
        sessionStorage.setItem(`yt_speed_${vid}`, val);
    }
}

function showToast(text) {
    let toast = document.getElementById('yt-ext-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'yt-ext-toast';
        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '100px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'white',
            color: 'black',
            padding: '10px 20px',
            borderRadius: '20px',
            zIndex: '2147483647',
            boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
            fontWeight: 'bold',
            fontSize: '16px',
            fontFamily: 'sans-serif',
            opacity: '0',
            transition: 'opacity 0.3s',
            pointerEvents: 'none'
        });
        document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.style.opacity = '1';
    
    if (toast.hideTimer) clearTimeout(toast.hideTimer);
    toast.hideTimer = setTimeout(() => {
        toast.style.opacity = '0';
    }, 2000);
}

function applySpeed() {
    const video = document.querySelector('video');
    if (!video) return;

    const session = getSessionSpeed();
    // Логика: если есть сессия - она главная. Если нет - глобал. 
    // Глобал уже равен 1.5 по дефолту.
    const targetSpeed = session !== null ? session : STATE.globalSpeed;
    
    if (Math.abs(video.playbackRate - targetSpeed) > 0.01) {
        video.playbackRate = targetSpeed;
    }
}

function initVideoHandler() {
    const video = document.querySelector('video');
    if (!video || video.dataset.ytExtInitialized) return;

    video.dataset.ytExtInitialized = "true";
    STATE.videoElement = video;

    applySpeed();

    video.addEventListener('ended', () => {
        const urlParams = new URLSearchParams(window.location.search);
        // Не закрывать если это плейлист
        if (!urlParams.has('list')) {
            chrome.runtime.sendMessage({ action: 'VIDEO_ENDED' });
        }
    });
    
    // Таймер для надежности
    setInterval(applySpeed, 1000);
}

// Слушаем сообщения от background
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'ACTIVATE_AND_PLAY') {
        const video = document.querySelector('video');
        if (video) {
            // Promise-based play чтобы избежать ошибок
            video.play().then(() => applySpeed()).catch(e => console.log("Autoplay blocked:", e));
        }
    } else if (request.action === 'PAUSE_VIDEO') {
        const video = document.querySelector('video');
        if (video && !video.paused) {
            video.pause();
        }
    }
});

// Хоткеи
window.addEventListener('keydown', (e) => {
    // Shift + > (.) и Shift + < (,)
    if (e.shiftKey && (e.key === '.' || e.key === '>' || e.key === ',' || e.key === '<')) {
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();

        // База: либо текущая сессионная, либо глобальная (которая 1.5)
        const currentSession = getSessionSpeed();
        let base = currentSession !== null ? currentSession : STATE.globalSpeed;
        
        let delta = (e.key === '.' || e.key === '>') ? 0.25 : -0.25;
        let newVal = base + delta;
        
        if (newVal < 0.25) newVal = 0.25;
        if (newVal > 5.0) newVal = 5.0;
        
        setSessionSpeed(newVal);
        applySpeed();
        showToast(`Скорость: ${newVal.toFixed(2)}x`);
    }
}, true);

// SPA навигация check
setInterval(initVideoHandler, 500);

let lastUrl = location.href; 
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    const v = document.querySelector('video');
    if(v) delete v.dataset.ytExtInitialized;
    initVideoHandler();
  }
}).observe(document, {subtree: true, childList: true});