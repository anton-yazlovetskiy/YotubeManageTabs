/**
 * YouTube Aggressive Manager - Background Script
 * Версия: 7.3 (Fix: Decoupled Volume, No-Loop Resume, Manual Override)
 */

const GROUP_TITLE = "YouTube Tabs";
const GROUP_COLOR = "green";

let tabGroupsMap = {};

// === 1. FOCUS GUARD (ЗАЩИТНИК ФОКУСА)
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    const knownGroupId = tabGroupsMap[tabId];
    delete tabGroupsMap[tabId];

    if (removeInfo.isWindowClosing) return;

    if (knownGroupId && knownGroupId !== -1) {
        try {
            const tabsInGroup = await chrome.tabs.query({ groupId: knownGroupId });
            
            if (tabsInGroup.length > 0) {
                const currentTab = await chrome.tabs.query({ active: true, currentWindow: true });
                
                if (!currentTab[0] || currentTab[0].groupId !== knownGroupId) {
                    const targetTab = tabsInGroup[tabsInGroup.length - 1];
                    await chrome.tabs.update(targetTab.id, { active: true });
                    
                    // БУДИМ (Один раз, без цикла)
                    if (typeof forceResume === 'function') {
                        forceResume(targetTab.id);
                    }
                } 
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

    // VIDEO ENDED
    if (msg.action === 'VIDEO_ENDED' && sender.tab) {
        const closingTabId = sender.tab.id;
        const groupId = sender.tab.groupId;

        if (groupId !== -1) {
            chrome.tabs.query({ groupId: groupId }, (tabs) => {
                const currentIndex = tabs.findIndex(t => t.id === closingTabId);
                
                if (tabs.length > 1) {
                    const targetIndex = currentIndex > 0 ? currentIndex - 1 : currentIndex + 1;
                    const targetTab = tabs[targetIndex];

                    if (targetTab) {
                        chrome.tabs.update(targetTab.id, { active: true }, () => {
                            forceResume(targetTab.id);
                            setTimeout(() => {
                                chrome.tabs.remove(closingTabId).catch(() => {});
                            }, 500);
                        });
                        return;
                    }
                }
                chrome.tabs.remove(closingTabId).catch(() => {});
            });
        } else {
            chrome.tabs.remove(closingTabId).catch(() => {});
        }
    }
});

// === 3. FORCE RESUME (The Hammer - Fixed) ===
function forceResume(tabId) {
    // FIX: Убран setTimeout (цикл), который мешал паузе.
    // Теперь это просто "Толчок" для запуска.
    const run = () => {
        chrome.tabs.sendMessage(tabId, { action: "RESUME_PLAYBACK" }).catch(() => {
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => {
                    const v = document.querySelector('video');
                    if (v && v.paused) v.play().catch(() => {});
                }
            }).catch(() => {});
        });
    };
    run(); 
}

// === 4. ACTIVATION LOGIC ===
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        // FIX: Убрана принудительная отправка RESUME_PLAYBACK при каждой активации.
        // Это позволяло видео перезапускаться, если пользователь поставил паузу и переключил вкладку.

        if (!tab.url || !tab.url.includes("youtube.com/watch")) return;

        // B. PAUSE OTHERS (Оставляем только глушение остальных)
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

        // C. SORTING & GROUPING
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