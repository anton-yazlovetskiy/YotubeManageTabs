const speedValue = document.getElementById('speedValue');

// Функция отрисовки значения
function updateDisplay() {
    chrome.storage.local.get(['preferredSpeed'], (res) => {
        let val = parseFloat(res.preferredSpeed);
        
        // Фикс инициализации: только если значения НЕТ (undefined/NaN), ставим 1.5
        // Если там 1.0 - оставляем 1.0 (теперь разрешаем)
        if (!val && val !== 0) { 
            val = 1.5;
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
        // Берем текущее или дефолт
        let current = parseFloat(res.preferredSpeed || 1.5);
        
        // Математика (без лишних проверок на 1.0)
        let next = current + delta;
        
        // Ограничения
        if (next < 0.25) next = 0.25;
        if (next > 3.0) next = 3.0;

        // 1. Обновляем UI
        speedValue.textContent = next.toFixed(2) + 'x';
        
        // 2. Сохраняем глобально
        chrome.storage.local.set({ preferredSpeed: next.toString() });
        
        // 3. Шлем сигнал в текущую активную вкладку
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