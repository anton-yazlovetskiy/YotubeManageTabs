/**
 * YouTube Aggressive Manager - Background Script
 * Версия: 7.2 (Fix: Playlists & Background Play)
 */

const GROUP_TITLE = "YouTube Tabs";
const GROUP_COLOR = "green";

let tabGroupsMap = {};

// === 1. FOCUS GUARD (ЗАЩИТНИК ФОКУСА)
// Срабатывает при закрытии вкладки
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    const knownGroupId = tabGroupsMap[tabId];
    delete tabGroupsMap[tabId];

    if (removeInfo.isWindowClosing) return;

    if (knownGroupId && knownGroupId !== -1) {
        try {
            // 1. Проверяем, остались ли вкладки в группе
            const tabsInGroup = await chrome.tabs.query({ groupId: knownGroupId });
            
            if (tabsInGroup.length > 0) {
                // ИНТЕГРАЦИЯ v5.4: Проверка текущего фокуса
                // Получаем текущую активную вкладку в этом окне
                const currentTab = await chrome.tabs.query({ active: true, currentWindow: true });
                
                // ЛОГИКА: Если активная вкладка "вылетела" из нашей группы (или её нет),
                // ТОЛЬКО ТОГДА мы вмешиваемся и возвращаем фокус.
                if (!currentTab[0] || currentTab[0].groupId !== knownGroupId) {
                    
                    // Берем последнюю вкладку (как самую свежую)
                    const targetTab = tabsInGroup[tabsInGroup.length - 1];
                    
                    // АКТИВИРУЕМ
                    await chrome.tabs.update(targetTab.id, { active: true });
                    
                    // БУДИМ (HAMMER METHOD из v7.2)
                    // Вызываем только если пришлось принудительно переключать
                    if (typeof forceResume === 'function') {
                        forceResume(targetTab.id);
                    }
                } 
                // ELSE: Если фокус уже на вкладке нашей группы (Chrome сам переключил),
                // мы ничего не делаем, чтобы не сбивать нативный процесс.
            }
        } catch (e) { console.error("Focus Guard error:", e); }
    }
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (tab.groupId !== -1) tabGroupsMap[tabId] = tab.groupId;
});

// === 2. MESSAGING ===
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // OPEN BACKGROUND
    if (msg.action === 'OPEN_BACKGROUND' && msg.url) {
        chrome.tabs.create({ url: msg.url, active: false }, async (newTab) => {
            const sourceTab = sender.tab;
            let targetGroupId = null;
            
            if (sourceTab && sourceTab.groupId !== -1) {
                targetGroupId = sourceTab.groupId;
            } else {
                const groups = await chrome.tabGroups.query({ windowId: newTab.windowId, title: GROUP_TITLE });
                if (groups.length > 0) targetGroupId = groups[0].id;
            }

            if (targetGroupId) {
                await chrome.tabs.group({ groupId: targetGroupId, tabIds: newTab.id });
                if (sourceTab && sourceTab.groupId === -1) {
                    await chrome.tabs.group({ groupId: targetGroupId, tabIds: sourceTab.id });
                }
            } else {
                const ids = [newTab.id];
                if (sourceTab) ids.unshift(sourceTab.id);
                const gid = await chrome.tabs.group({ tabIds: ids });
                await chrome.tabGroups.update(gid, { title: GROUP_TITLE, color: GROUP_COLOR });
            }
        });
        return;
    }

    // VIDEO ENDED (Только если это не плейлист - фильтр в content.js)
    if (msg.action === 'VIDEO_ENDED' && sender.tab) {
        // Просто удаляем вкладку. Остальное сделает Focus Guard (см. выше)
        chrome.tabs.remove(sender.tab.id); 
    }
});

// === 3. FORCE RESUME (The Hammer) ===
function forceResume(tabId) {
    // Посылаем серию сигналов, чтобы пробить троттлинг браузера
    const send = () => chrome.tabs.sendMessage(tabId, { action: "RESUME_PLAYBACK" }).catch(()=>{});
    
    send(); // Сразу
    setTimeout(send, 500);  // Через полсекунды
    setTimeout(send, 1500); // Контрольный
}

// === 4. ACTIVATION LOGIC ===
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (!tab.url || !tab.url.includes("youtube.com/watch")) {
            // ВАЖНО: Отправляем команду на возобновление воспроизведения
            chrome.tabs.sendMessage(tab.id, { action: "RESUME_PLAYBACK" }).catch(()=>{});
            return;
        };

        // A. RESUME
        forceResume(tab.id);

        // B. PAUSE OTHERS
        chrome.tabs.query({ url: "*://www.youtube.com/*" }, (allTabs) => {
            allTabs.forEach(t => {
                if (t.id !== tab.id && t.audible) {
                    chrome.scripting.executeScript({
                        target: { tabId: t.id },
                        func: () => { 
                            const v = document.querySelector('video'); 
                            if(v && !v.paused) v.pause(); 
                        }
                    }).catch(()=>{});
                }
            });
        });

        // C. SORTING
        const groups = await chrome.tabGroups.query({ windowId: tab.windowId, title: GROUP_TITLE });
        let groupId = (groups.length > 0) ? groups[0].id : null;

        if (tab.groupId === -1 && groupId) {
            await chrome.tabs.group({ groupId: groupId, tabIds: tab.id });
        } else {
            groupId = tab.groupId;
        }

        if (groupId) {
            const groupTabs = await chrome.tabs.query({ groupId: groupId });
            const lastTab = groupTabs[groupTabs.length - 1];
            if (tab.index !== lastTab.index) {
                await chrome.tabs.move(tab.id, { index: lastTab.index });
            }
        }
    } catch (e) {}
});

// === 5. UNCOLLAPSE ===
chrome.tabGroups.onUpdated.addListener(async (group) => {
    if (group.title !== GROUP_TITLE) return;
    if (group.collapsed) {
        const tabs = await chrome.tabs.query({ groupId: group.id });
        if (tabs.some(t => t.audible)) {
            await chrome.tabGroups.update(group.id, { collapsed: false });
            const singer = tabs.find(t => t.audible);
            if(singer) chrome.tabs.update(singer.id, { active: true });
        }
    }
});