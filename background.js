const GROUP_TITLE = "YouTube Tabs";
const GROUP_COLOR = "green";

// Кэш состояний групп (чтобы отличать клик юзера от скрипта)
let groupCollapseState = {};

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===

async function ensureInGroup(tabId) {
    try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.groupId !== -1) return;

        const groups = await chrome.tabGroups.query({ title: GROUP_TITLE });
        
        if (groups.length > 0) {
            await chrome.tabs.group({ groupId: groups[0].id, tabIds: tabId });
        } else {
            const gid = await chrome.tabs.group({ tabIds: tabId });
            const group = await chrome.tabGroups.get(gid);
            groupCollapseState[gid] = group.collapsed;
            await chrome.tabGroups.update(gid, { title: GROUP_TITLE, color: GROUP_COLOR });
        }
    } catch (e) {
        console.error("Group error:", e);
    }
}

// === УПРАВЛЕНИЕ ВОСПРОИЗВЕДЕНИЕМ ===

async function syncPlayback(activeTabId) {
    try {
        const activeTab = await chrome.tabs.get(activeTabId);
        // Проверка: работаем только с YouTube
        if (!activeTab || !activeTab.url || !activeTab.url.includes("youtube.com/watch")) return;

        // 1. Сортировка (кидаем активную в конец списка)
        try { await chrome.tabs.move(activeTabId, { index: -1 }); } catch (e) {}

        // 2. Группировка
        await ensureInGroup(activeTabId);

        // 3. Управление плеерами
        const tabs = await chrome.tabs.query({ url: "*://www.youtube.com/*" });
        
        for (const tab of tabs) {
            if (tab.id === activeTabId) {
                // ТЕКУЩАЯ: ИГРАТЬ (и применить скорость)
                chrome.tabs.sendMessage(tab.id, { action: "syncPlayAndSpeed" }).catch(() => {});
            } else {
                // ОСТАЛЬНЫЕ: ПАУЗА
                chrome.tabs.sendMessage(tab.id, { action: "pauseVideo" }).catch(() => {});
            }
        }
    } catch (e) {}
}

// === АВТО-ПЕРЕКЛЮЧЕНИЕ (ВОССТАНОВЛЕННАЯ ЛОГИКА) ===

async function handleVideoEnded(senderTab) {
    if (!senderTab) return;
    try {
        const allTabs = await chrome.tabs.query({ currentWindow: true });
        const currentIndex = allTabs.findIndex(t => t.id === senderTab.id);
        
        // Логика: Текущая вкладка всегда в конце (из-за сортировки).
        // Значит, следующая по очереди — это та, что стоит перед ней (index - 1),
        // или самая первая, если мы в начале.
        let targetIndex = currentIndex - 1;
        
        // Если список был пуст или мы удалили единственную - ничего не делаем
        // Если есть куда переключаться:
        if (allTabs.length > 1) {
            // Если вдруг индекс ушел в минус (защита), берем первую
            if (targetIndex < 0) targetIndex = 0; 
            
            const targetTab = allTabs[targetIndex];
            
            // 1. АКТИВИРУЕМ НОВУЮ ВКЛАДКУ
            await chrome.tabs.update(targetTab.id, { active: true });
            
            // 2. !!! ПРИНУДИТЕЛЬНЫЙ ЗАПУСК !!!
            // Мы не ждем onActivated. Мы прямо сейчас говорим новой вкладке "Играй!"
            // Это решает проблему фонового режима.
            await syncPlayback(targetTab.id);
            
            // 3. УДАЛЯЕМ СТАРУЮ
            await chrome.tabs.remove(senderTab.id);
        }
    } catch (e) {
        console.error("Auto-next error:", e);
    }
}


// === СЛУШАТЕЛИ ===

// 1. Обычная активация (кликом мышки)
chrome.tabs.onActivated.addListener((info) => {
    // Небольшая задержка для плавности UI при ручном клике
    setTimeout(() => syncPlayback(info.tabId), 200);
});

// 2. Обновление страницы (F5 или переход по ссылке)
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status === 'complete' && tab.active && tab.url?.includes("youtube.com/watch")) {
        syncPlayback(tabId);
    }
});

// 3. Сообщения
chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!sender.tab) return;

    if (msg.action === 'OPEN_BACKGROUND_TAB') {
        chrome.tabs.create({ 
            url: msg.url, 
            active: false, 
            openerTabId: sender.tab.id 
        }, async (newTab) => {
            // Группируем
            const parentGroupId = sender.tab.groupId;
            if (parentGroupId !== -1) {
                await chrome.tabs.group({ groupId: parentGroupId, tabIds: newTab.id });
            } else {
                // Создаем группу
                const newGroupId = await chrome.tabs.group({ tabIds: [sender.tab.id, newTab.id] });
                const group = await chrome.tabGroups.get(newGroupId);
                groupCollapseState[newGroupId] = group.collapsed;
                await chrome.tabGroups.update(newGroupId, { title: GROUP_TITLE, color: GROUP_COLOR });
            }
        });
    }

    if (msg.action === 'VIDEO_ENDED') {
        handleVideoEnded(sender.tab);
    }
});

// 4. Клик по группе (Smart Uncollapse)
chrome.tabGroups.onUpdated.addListener(async (group) => {
    if (group.title !== GROUP_TITLE) return;
    if (groupCollapseState[group.id] === group.collapsed) return; 
    
    groupCollapseState[group.id] = group.collapsed;

    const tabs = await chrome.tabs.query({ groupId: group.id });
    if (tabs.length === 0) return;

    const playingTab = tabs.find(t => t.audible);

    if (playingTab) {
        if (group.collapsed) await chrome.tabGroups.update(group.id, { collapsed: false });
        if (!playingTab.active) await chrome.tabs.update(playingTab.id, { active: true });
    } else {
        if (!group.collapsed) {
            const isAnyActiveInGroup = tabs.some(t => t.active);
            if (!isAnyActiveInGroup) {
                const lastTab = tabs[tabs.length - 1];
                await chrome.tabs.update(lastTab.id, { active: true });
            }
        }
    }
});