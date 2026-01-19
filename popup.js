const speedValue = document.getElementById('speedValue');
const volSlider = document.getElementById('volSlider');
const volValue = document.getElementById('volValue');

// --- SPEED LOGIC ---
function updateSpeedDisplay() {
    chrome.storage.local.get(['preferredSpeed'], (res) => {
        let val = parseFloat(res.preferredSpeed || 1.5);
        speedValue.textContent = val.toFixed(2) + 'x';
    });
}

function changeSpeed(delta) {
    chrome.storage.local.get(['preferredSpeed'], (res) => {
        let current = parseFloat(res.preferredSpeed || 1.5);
        let next = current + delta;
        if (next < 0.25) next = 0.25;
        if (next > 3.0) next = 3.0;
        
        speedValue.textContent = next.toFixed(2) + 'x';
        chrome.storage.local.set({ preferredSpeed: next.toString() });
        broadcast({ action: "updateGlobalConfig", newSpeed: next });
    });
}

// --- VOLUME LOGIC ---
function updateVolumeDisplay() {
    chrome.storage.local.get(['globalVolume'], (res) => {
        let val = res.globalVolume !== undefined ? parseInt(res.globalVolume) : 100;
        volSlider.value = val;
        volValue.textContent = val + '%';
    });
}

volSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    volValue.textContent = val + '%';
    chrome.storage.local.set({ globalVolume: val });
    broadcast({ action: "updateGlobalVolume", newVolume: val });
});

// --- RESET LOGIC (RESTORED) ---
document.getElementById('resetBtn').onclick = () => {
    chrome.storage.local.get(['preferredSpeed'], (res) => {
        const global = parseFloat(res.preferredSpeed || 1.5);
        // Сбрасываем везде
        broadcast({ action: "resetToGlobal", speed: global });
        // Визуальный фидбек на кнопке (опционально)
        const btn = document.getElementById('resetBtn');
        const oldText = btn.textContent;
        btn.textContent = "DONE!";
        setTimeout(() => btn.textContent = oldText, 1000);
    });
};

// --- COMMON ---
function broadcast(msg) {
    chrome.tabs.query({url: "*://www.youtube.com/*"}, (tabs) => {
        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
        });
    });
}

// Init
document.getElementById('minus').onclick = () => changeSpeed(-0.25);
document.getElementById('plus').onclick = () => changeSpeed(0.25);

updateSpeedDisplay();
updateVolumeDisplay();