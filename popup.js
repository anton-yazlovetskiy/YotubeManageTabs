document.addEventListener('DOMContentLoaded', () => {
    const valDisplay = document.getElementById('speed-val');
    
    chrome.storage.sync.get(['globalSpeed'], (res) => {
        // Дефолт 1.5 если пусто
        const val = (res.globalSpeed !== undefined) ? res.globalSpeed : 1.5;
        valDisplay.textContent = val.toFixed(2);
    });

    const updateSpeed = (delta) => {
        let current = parseFloat(valDisplay.textContent);
        let next = current + delta;
        if (next < 0.25) next = 0.25;
        if (next > 5.0) next = 5.0;
        
        valDisplay.textContent = next.toFixed(2);
        chrome.storage.sync.set({ globalSpeed: next });
    };

    document.getElementById('dec').addEventListener('click', () => updateSpeed(-0.25));
    document.getElementById('inc').addEventListener('click', () => updateSpeed(0.25));
});