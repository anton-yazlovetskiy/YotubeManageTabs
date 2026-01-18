const GROUP_TITLE = "YouTube Tabs";
const GROUP_COLOR = "green";

// Хранилище состояний свернутости групп, чтобы отличать клик пользователя от системных обновлений
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
            // При создании группы запоминаем её состояние
            const group = await chrome.tabGroups.get(gid);
            groupCollapseState[gid] = group.collapsed;
            
            await chrome.tabGroups.update(gid, { title: GROUP_TITLE, color: GROUP_COLOR });
        }
    } catch (e) {
        console.error("Group error:", e);
    }
}

// === УПРАВЛЕНИЕ ВОСПРОИЗВЕДЕНИЕМ И СОРТИРОВКОЙ ===

async function syncPlayback(activeTabId) {
    try {
        const activeTab = await chrome.tabs.get(activeTabId);
        
        if (!activeTab || !activeTab.url || !activeTab.url.includes("youtube.com/watch")) return;

        // 1. ПЕРЕМЕЩЕНИЕ В КОНЕЦ
        try {
            await chrome.tabs.move(activeTabId, { index: -1 });
        } catch (e) {}

        // 2. ГАРАНТИЯ ГРУППЫ
        await ensureInGroup(activeTabId);

        // 3. УПРАВЛЕНИЕ ПЛЕЕРАМИ
        const tabs = await chrome.tabs.query({ url: "*://www.youtube.com/*" });
        
        for (const tab of tabs) {
            if (tab.id === activeTabId) {
                chrome.tabs.sendMessage(tab.id, { action: "syncPlayAndSpeed" }).catch(() => {});
            } else {
                chrome.tabs.sendMessage(tab.id, { action: "pauseVideo" }).catch(() => {});
            }
        }
    } catch (e) {
        // Игнорируем ошибки доступа
    }
}

// === ЛОГИКА ЗАВЕРШЕНИЯ ВИДЕО (AUTO-NEXT) ===

async function handleVideoEnded(senderTab) {
    if (!senderTab) return;
    try {
        const allTabs = await chrome.tabs.query({ currentWindow: true });
        const currentIndex = allTabs.findIndex(t => t.id === senderTab.id);
        
        // Идем на предыдущую (т.к. текущая в конце списка)
        let targetIndex = currentIndex - 1;
        if (targetIndex < 0 && allTabs.length > 1) {
            targetIndex = currentIndex + 1;
        }

        if (targetIndex >= 0 && targetIndex < allTabs.length) {
            const targetTab = allTabs[targetIndex];
            await chrome.tabs.update(targetTab.id, { active: true });
            await chrome.tabs.remove(senderTab.id);
        }
    } catch (e) {}
}


// === СЛУШАТЕЛИ СОБЫТИЙ ===

// 1. Активация вкладки
chrome.tabs.onActivated.addListener((info) => {
    setTimeout(() => syncPlayback(info.tabId), 200);
});

// 2. Обновление вкладки
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
            const parentGroupId = sender.tab.groupId;
            
            if (parentGroupId !== -1) {
                // Если родитель УЖЕ в группе - просто добавляем новую туда
                await chrome.tabs.group({ groupId: parentGroupId, tabIds: newTab.id });
            } else {
                // === ИЗМЕНЕНИЕ ЗДЕСЬ ===
                // Если родитель БЕЗ группы - создаем группу для РОДИТЕЛЯ и НОВОЙ вкладки
                const newGroupId = await chrome.tabs.group({ tabIds: [sender.tab.id, newTab.id] });
                
                // Фиксируем состояние в кэше, чтобы Smart Group Click не дергался
                const group = await chrome.tabGroups.get(newGroupId);
                groupCollapseState[newGroupId] = group.collapsed;
                
                // Красим и именуем
                await chrome.tabGroups.update(newGroupId, { title: GROUP_TITLE, color: GROUP_COLOR });
            }
        });
    }

    if (msg.action === 'VIDEO_ENDED') {
        handleVideoEnded(sender.tab);
    }
});

// 4. SMART GROUP CLICK
chrome.tabGroups.onUpdated.addListener(async (group) => {
    if (group.title !== GROUP_TITLE) return;

    // Проверка на изменение состояния (отсекаем системные апдейты)
    if (groupCollapseState[group.id] === group.collapsed) {
        return; 
    }
    
    groupCollapseState[group.id] = group.collapsed;

    const tabs = await chrome.tabs.query({ groupId: group.id });
    if (tabs.length === 0) return;

    const playingTab = tabs.find(t => t.audible);

    if (playingTab) {
        // Сценарий А: Есть звук
        if (group.collapsed) {
            await chrome.tabGroups.update(group.id, { collapsed: false });
        }
        if (!playingTab.active) {
            await chrome.tabs.update(playingTab.id, { active: true });
        }
    } else {
        // Сценарий Б: Тишина
        if (!group.collapsed) {
            // Если фокус не внутри группы - активируем последнюю
            const isAnyActiveInGroup = tabs.some(t => t.active);
            if (!isAnyActiveInGroup) {
                const lastTab = tabs[tabs.length - 1];
                await chrome.tabs.update(lastTab.id, { active: true });
            }
        }
    }
});