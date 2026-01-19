/**
 * YouTube Aggressive Manager - Background Script
 * Версия: 7.1 (Background Play & Reset Fix)
 */

const GROUP_TITLE = "YouTube Tabs";
const GROUP_COLOR = "green";

let tabGroupsMap = {};

// === 1. FOCUS GUARD ===
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    const knownGroupId = tabGroupsMap[tabId];
    delete tabGroupsMap[tabId];

    if (removeInfo.isWindowClosing) return;

    if (knownGroupId) {
        try {
            const tabsInGroup = await chrome.tabs.query({ groupId: knownGroupId });
            if (tabsInGroup.length > 0) {
                const targetTab = tabsInGroup[tabsInGroup.length - 1];
                await chrome.tabs.update(targetTab.id, { active: true });
                // ВАЖНО: Если браузер не в фокусе, onActivated может не сработать.
                // Принудительно запускаем видео здесь:
                forceResume(targetTab.id);
            }
        } catch (e) { console.error("Focus Guard error:", e); }
    }
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (tab.groupId !== -1) tabGroupsMap[tabId] = tab.groupId;
});

// === 2. MESSAGING ===
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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

    if (msg.action === 'VIDEO_ENDED' && sender.tab) {
        // Удаляем вкладку -> сработает onRemoved -> сработает Focus Guard -> сработает forceResume
        chrome.tabs.remove(sender.tab.id); 
    }
});

// === 3. LOGIC: FORCE RESUME ===
// Функция для агрессивного запуска видео, даже если вкладка в фоне/без фокуса
function forceResume(tabId) {
    // Посылаем сразу
    chrome.tabs.sendMessage(tabId, { action: "RESUME_PLAYBACK" }).catch(()=>{});
    
    // И еще раз через 500мс для надежности (если вкладка подгружается)
    setTimeout(() => {
        chrome.tabs.sendMessage(tabId, { action: "RESUME_PLAYBACK" }).catch(()=>{});
    }, 500);
}


// === 4. ACTIVATION LOGIC (СОРТИРОВКА + PAUSE + RESUME) ===
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (!tab.url || !tab.url.includes("youtube.com/watch")) return;

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

        // C. GROUPING & SORTING
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