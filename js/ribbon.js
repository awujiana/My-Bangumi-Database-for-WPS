




//这个函数在整个wps加载项中是第一个执行的
function OnAddinLoad(ribbonUI){
    if (typeof (window.Application.ribbonUI) != "object"){
		window.Application.ribbonUI = ribbonUI
    }
    
    if (typeof (window.Application.Enum) != "object") { // 如果没有内置枚举值
        window.Application.Enum = WPS_Enum
    }

    window.Application.PluginStorage.setItem("EnableFlag", false)
    window.Application.PluginStorage.setItem("ApiEventFlag", false)
    return true
}

var WebNotifycount = 0;
function OnAction(control) {
    console.log("OnAction called with:", control.Id);
    const eleId = control.Id
    try {
        switch (eleId) {
            // ========== Bangumi 同步相关 ==========
            case "btnShowPanel":
                showBangumiPanel();
                break;
            case "btnSyncBangumi":
                SyncToBangumi();
                break;
            case "btnSetToken":
                showTokenDialog(loadBgToken());
                break;
            case "btnSetUserId":
                showUserIdDialog();
                break;
            case "btnOpenCollection":
                openUserCollection();
                break;
            case "btnClearColors":
                clearRowColors();
                break;

            default:
                break
        }
    } catch (e) {
        console.error("OnAction error:", e);
        showDialogRibbon("执行出错", e.message);
    }
    return true
}

// ========== 向后兼容的别名（已迁移到 util.js 的 BGM 命名空间）==========
/**
 * @deprecated 使用 BGM.showDialog() 替代
 * @param {string} title - 标题
 * @param {string} message - 消息内容
 */
function showDialogRibbon(title, message) {
    BGM.showDialog(title, message);
}

function GetBangumiImage(control) {
    const id = control.Id
    switch (id) {
        case "btnShowPanel":     return "images/panel.svg"
        case "btnSyncBangumi":   return "images/sync.svg"
        case "btnSetToken":      return "images/key.svg"
        case "btnSetUserId":     return "images/user.svg"
        case "btnOpenCollection": return "images/link.svg"
        case "btnClearColors":   return "images/delete.svg"
        default:                return "images/newFromTemp.svg"
    }
}











