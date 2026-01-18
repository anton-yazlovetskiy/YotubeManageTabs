const speedValue = document.getElementById('speedValue');

// Функция отрисовки значения
function updateDisplay() {
    chrome.storage.local.get(['preferredSpeed'], (res) => {
        let val = parseFloat(res.preferredSpeed);
        
        // Фикс бага: если 1.0 или undefined -> показываем 1.5
        if (!val || val === 1.0) {
            val = 1.5;
            // Сразу лечим сторадж
            chrome.storage.local.set({ preferredSpeed: '1.5' });
        }
        
        speedValue.textContent = val.toFixed(2) + 'x';
    });
}

// Запуск при открытии
updateDisplay();

// Функция обновления (кнопки)
function update(delta) {
    chrome.storage.local.get(['preferredSpeed'], (res) => {
        let current = parseFloat(res.preferredSpeed || 1.5);
        
        // Если база была кривая (1.0), считаем от 1.5
        if (current === 1.0) current = 1.5;
        
        let next = current + delta;
        
        // Ограничения
        if (next < 0.25) next = 0.25;
        if (next > 3.0) next = 3.0; // ТЗ: до 3х

        // 1. Обновляем UI
        speedValue.textContent = next.toFixed(2) + 'x';
        
        // 2. Сохраняем
        chrome.storage.local.set({ preferredSpeed: next.toString() });
        
        // 3. Шлем сигнал в текущую активную вкладку (чтобы применилось мгновенно)
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { 
                    action: "forceUpdateSpeed", 
                    newSpeed: next 
                });
            }
        });
    });
}

document.getElementById('minus').onclick = () => update(-0.25);
document.getElementById('plus').onclick = () => update(0.25);