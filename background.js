// background.js

// Хранилище
let lastActiveTabId = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'OPEN_BACKGROUND_TAB') {
        handleOpenBackground(request.url, sender.tab);
    } else if (request.action === 'VIDEO_ENDED') {
        handleVideoEnded(sender.tab);
    }
});

async function handleOpenBackground(url, senderTab) {
    try {
        // 1. Создаем вкладку (сразу привязываем к родителю через openerTabId)
        const newTab = await chrome.tabs.create({ 
            url: url, 
            active: false,
            openerTabId: senderTab.id 
        });

        // 2. Логика группировки
        const senderGroupId = senderTab.groupId;
        let targetGroupId = senderGroupId;

        if (senderGroupId === -1) {
            // Если родитель не в группе, создаем новую
            targetGroupId = await chrome.tabs.group({
                tabIds: [senderTab.id, newTab.id]
            });
        } else {
            // Добавляем новую в существующую
            await chrome.tabs.group({
                groupId: senderGroupId,
                tabIds: [newTab.id]
            });
        }

        // 3. Красим и именуем группу (всегда, чтобы гарантировать свойства)
        await chrome.tabGroups.update(targetGroupId, { 
            title: "YouTube Tabs", 
            color: "green" 
        });

    } catch (e) {
        console.error("BG: Error creating/grouping tab", e);
    }
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const tabId = activeInfo.tabId;
    lastActiveTabId = tabId;

    try {
        const tab = await chrome.tabs.get(tabId);
        
        if (tab.url && tab.url.includes("youtube.com/watch")) {
            
            // 1. Перемещение в конец (работает внутри группы автоматически)
            try {
                // index: -1 перемещает в конец списка. 
                // Если вкладка в группе, она встанет в конец СВОЕЙ группы.
                await chrome.tabs.move(tabId, { index: -1 });
            } catch (err) {
                // Игнорируем, если вкладка одна или уже в конце
            }

            // 2. Управление воспроизведением
            const ytTabs = await chrome.tabs.query({ url: "*://www.youtube.com/*" });
            
            // Всем паузу
            for (const t of ytTabs) {
                if (t.id !== tabId) {
                    chrome.tabs.sendMessage(t.id, { action: "PAUSE_VIDEO" }).catch(() => {});
                }
            }
            // Текущей плей
            chrome.tabs.sendMessage(tabId, { action: "ACTIVATE_AND_PLAY" }).catch(() => {});
        }
    } catch (e) {
        console.error("BG: Activation logic error", e);
    }
});

async function handleVideoEnded(senderTab) {
    if (!senderTab) return;

    try {
        const allTabs = await chrome.tabs.query({ currentWindow: true });
        const currentIndex = allTabs.findIndex(t => t.id === senderTab.id);
        
        // Логика "предпоследняя вкладка" (index - 1)
        let targetIndex = currentIndex - 1;
        
        // Если закрываем самую первую (редкий кейс), берем следующую
        if (targetIndex < 0 && allTabs.length > 1) {
             targetIndex = currentIndex + 1;
        }

        if (targetIndex >= 0 && targetIndex < allTabs.length) {
            const targetTab = allTabs[targetIndex];
            
            // 1. Активируем
            await chrome.tabs.update(targetTab.id, { active: true });
            
            // 2. Запускаем (страховка)
            setTimeout(() => {
                 chrome.tabs.sendMessage(targetTab.id, { action: "ACTIVATE_AND_PLAY" }).catch(() => {});
            }, 300);

            // 3. Закрываем старую
            await chrome.tabs.remove(senderTab.id);
        }
    } catch (e) {
        console.error("BG: Auto-next error", e);
    }
}

// Агрессивная защита и активация по клику на группу
if (chrome.tabGroups) {
    chrome.tabGroups.onUpdated.addListener(async (group) => {
        // Если группа свернулась (пользователь кликнул на заголовок)
        if (group.collapsed) {
            try {
                const tabsInGroup = await chrome.tabs.query({ groupId: group.id });
                
                // Ищем вкладку, которая звучит (audible) или была последней активной
                // Примечание: audible надежнее для видео.
                const playingTab = tabsInGroup.find(t => t.audible);
                
                if (playingTab) {
                    // 1. Разворачиваем группу обратно
                    await chrome.tabGroups.update(group.id, { collapsed: false });
                    // 2. Активируем играющую вкладку
                    await chrome.tabs.update(playingTab.id, { active: true });
                }
            } catch (e) {
                console.error("BG: Group logic error", e);
            }
        }
    });
}