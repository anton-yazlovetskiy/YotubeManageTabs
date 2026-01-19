/**
 * YouTube Aggressive Manager - Content Script
 * Версия: 7.2 (Playlist Fix & Reset)
 */

const CONFIG = {
    minSpeed: 0.25,
    maxSpeed: 3.0,
    step: 0.25,
    debounceTime: 500
};

let CACHE = {
    globalSpeed: 1.5,
    globalVolume: 100,
    seenVideos: new Set(),
    observerTimeout: null
};

// === 1. STYLES ===
function injectStyles() {
    const old = document.getElementById('yt-manager-styles');
    if (old) old.remove();

    const css = `
        .yt-ext-neon {
            box-shadow: 0 0 5px #0f0, 0 0 10px #0f0, 0 0 20px #0f0 !important;
            border: 1px solid rgba(0, 255, 0, 0.8) !important;
            transition: all 0.3s ease-in-out !important;
            border-radius: 6px !important;
            z-index: 10;
            position: relative;
        }
        #yt-speed-toast {
            position: fixed;
            bottom: 120px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.85);
            color: #0f0;
            padding: 12px 30px;
            border-radius: 50px;
            font-family: 'Roboto', sans-serif;
            font-size: 24px; 
            font-weight: 900;
            text-shadow: 0 0 10px #0f0;
            border: 2px solid #0f0;
            box-shadow: 0 0 20px rgba(0, 255, 0, 0.4);
            z-index: 2147483647;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s ease-out;
        }
    `;
    const styleEl = document.createElement('style');
    styleEl.id = 'yt-manager-styles';
    styleEl.textContent = css;
    (document.documentElement || document.head).appendChild(styleEl);
}

// === 2. UI UTILS ===
function showToast(text) {
    let toast = document.getElementById('yt-speed-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'yt-speed-toast';
        (document.body || document.documentElement).appendChild(toast);
    }
    toast.textContent = text;
    requestAnimationFrame(() => toast.style.opacity = '1');
    if (toast.hideTimeout) clearTimeout(toast.hideTimeout);
    toast.hideTimeout = setTimeout(() => toast.style.opacity = '0', 1500);
}

function getVideoId(url) {
    try { return new URL(url).searchParams.get('v'); } catch (e) { return null; }
}

// === 3. MEDIA CONTROLLER ===
function applyMediaSettings(targetSpeed = null) {
    const video = document.querySelector('video');
    if (!video) return;

    // Speed
    if (targetSpeed !== null) {
        video.playbackRate = targetSpeed;
        showToast(`${targetSpeed.toFixed(2)}x`);
    } else if (Math.abs(video.playbackRate - CACHE.globalSpeed) > 0.1) {
        video.playbackRate = CACHE.globalSpeed;
    }

    // Volume
    const targetVol = CACHE.globalVolume / 100;
    if (Math.abs(video.volume - targetVol) > 0.05) {
        video.volume = targetVol;
    }
}

function initVideoHandler() {
    const video = document.querySelector('video');
    if (video && !video.dataset.ytExtInitialized) {
        video.dataset.ytExtInitialized = "true";
        video.addEventListener('loadedmetadata', () => applyMediaSettings());
        applyMediaSettings();
        
        // --- PLAYLIST LOGIC FIX ---
        video.addEventListener('ended', () => {
            // Если это плейлист (есть параметр list), НЕ закрываем вкладку.
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.has('list')) {
                console.log("Playlist detected, keeping tab open.");
                return;
            }
            
            // 1. Проигрываем звук
            playCompletionSound();
            
            // 2. Закрываем вкладку с небольшой задержкой (чтобы звук прозвучал)
            setTimeout(() => {
                chrome.runtime.sendMessage({ action: "VIDEO_ENDED" });
            }, 700);
        });
    }
}

// === 4. MESSAGING ===
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'updateGlobalConfig') {
        CACHE.globalSpeed = msg.newSpeed;
        applyMediaSettings();
        showToast(`Speed: ${msg.newSpeed}x`);
    }
    if (msg.action === 'updateGlobalVolume') {
        CACHE.globalVolume = msg.newVolume;
        applyMediaSettings();
    }
    // RESET HANDLER
    if (msg.action === 'resetToGlobal') {
        CACHE.globalSpeed = msg.speed;
        const video = document.querySelector('video');
        if (video) {
            video.playbackRate = msg.speed;
            showToast(`Reset: ${msg.speed}x`);
        }
    }
    // FORCE PLAY
    if (msg.action === 'RESUME_PLAYBACK') {
        const video = document.querySelector('video');
        if (video) {
            applyMediaSettings();
            if (video.paused) {
                video.play().catch(() => console.log("Autoplay blocked/throttled"));
            }
        }
    }
});

// === 5. HISTORY & HIGHLIGHT ===
function syncHistory() {
    chrome.storage.local.get(['openedVideos'], (res) => {
        CACHE.seenVideos = new Set(res.openedVideos || []);
        runHighlighter();
    });
}
function addToHistory(vid) {
    if (!vid) return;
    CACHE.seenVideos.add(vid);
    runHighlighter();
    chrome.storage.local.get(['openedVideos'], (res) => {
        let list = res.openedVideos || [];
        list = list.filter(id => id !== vid);
        list.push(vid);
        if (list.length > 1000) list = list.slice(-1000);
        chrome.storage.local.set({ openedVideos: list });
    });
}
function runHighlighter() {
    const links = document.querySelectorAll('a[href^="/watch?v="]');
    links.forEach(link => {
        const vid = getVideoId(link.href);
        if (vid && CACHE.seenVideos.has(vid)) {
            const target = link.closest('ytd-thumbnail') || link;
            if (!target.classList.contains('yt-ext-neon')) target.classList.add('yt-ext-neon');
        }
    });
}

// === 6. INPUT & CLICK ===
function handleHotkeys(e) {
    if (['INPUT', 'TEXTAREA', 'DIV'].includes(e.target.tagName) && e.target.isContentEditable) return;
    if (e.shiftKey && (e.code === 'Period' || e.code === 'Comma')) {
        const video = document.querySelector('video');
        if (!video) return;
        e.preventDefault(); e.stopPropagation();
        
        let newRate = video.playbackRate + (e.code === 'Period' ? CONFIG.step : -CONFIG.step);
        newRate = Math.min(Math.max(newRate, CONFIG.minSpeed), CONFIG.maxSpeed);
        newRate = Math.round(newRate * 100) / 100;
        
        applyMediaSettings(newRate);
    }
}

function setupClickTrap() {
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[href*="/watch?v="]');
        if (link && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            if (link.href === location.href) return;
            e.preventDefault(); e.stopImmediatePropagation();
            
            showToast(">>> Background");
            addToHistory(getVideoId(link.href));
            chrome.runtime.sendMessage({ action: "OPEN_BACKGROUND", url: link.href });
        }
    }, true);
}

// Функция для создания приятного "динь" (две ноты)
function playCompletionSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        const playNote = (freq, startTime, duration) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, startTime);
            
            gain.gain.setValueAtTime(0.1, startTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            
            osc.start(startTime);
            osc.stop(startTime + duration);
        };

        // Две гармоничные ноты (Ми и Ля)
        playNote(659.25, audioCtx.currentTime, 0.5); 
        playNote(880.00, audioCtx.currentTime + 0.1, 0.4);
    } catch (e) {
        console.error("Audio playback failed:", e);
    }
}

// === 7. INIT ===
function init() {
    injectStyles();
    syncHistory();
    const vid = getVideoId(location.href);
    if (vid) addToHistory(vid);

    chrome.storage.local.get(['preferredSpeed', 'globalVolume'], (res) => {
        if (res.preferredSpeed) CACHE.globalSpeed = parseFloat(res.preferredSpeed);
        if (res.globalVolume !== undefined) CACHE.globalVolume = parseInt(res.globalVolume);
        initVideoHandler();
    });

    window.addEventListener('keydown', handleHotkeys, true);
    setupClickTrap();

    const observer = new MutationObserver(() => {
        initVideoHandler();
        const newVid = getVideoId(location.href);
        if (newVid && !CACHE.seenVideos.has(newVid)) addToHistory(newVid);
        
        if (CACHE.observerTimeout) clearTimeout(CACHE.observerTimeout);
        CACHE.observerTimeout = setTimeout(runHighlighter, CONFIG.debounceTime);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(runHighlighter, 1000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();