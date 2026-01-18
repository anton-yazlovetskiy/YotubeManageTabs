const speedValue = document.getElementById('speedValue');

function updateDisplay() {
    chrome.storage.local.get(['preferredSpeed'], (res) => {
        let val = parseFloat(res.preferredSpeed);
        if (!val) {
            val = 1.5;
            chrome.storage.local.set({ preferredSpeed: '1.5' });
        }
        speedValue.textContent = val.toFixed(2) + 'x';
    });
}

updateDisplay();

function update(delta) {
    chrome.storage.local.get(['preferredSpeed'], (res) => {
        let current = parseFloat(res.preferredSpeed || 1.5);
        let next = current + delta;
        
        if (next < 0.25) next = 0.25;
        if (next > 3.0) next = 3.0;
        
        speedValue.textContent = next.toFixed(2) + 'x';
        chrome.storage.local.set({ preferredSpeed: next.toString() });
        
        chrome.tabs.query({url: "*://www.youtube.com/*"}, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { 
                    action: "updateGlobalConfig", 
                    newSpeed: next 
                }).catch(() => {});
            });
        });
    });
}

// КНОПКА СБРОСА
document.getElementById('resetBtn').onclick = () => {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action: "resetToGlobal" });
        }
    });
};

document.getElementById('minus').onclick = () => update(-0.25);
document.getElementById('plus').onclick = () => update(0.25);