



// ========== 统一获取 Application 对象 ==========
function getApp() {
    if (typeof window !== 'undefined' && window.Application) {
        return window.Application;
    }
    if (typeof Application !== 'undefined') {
        return Application;
    }
    return null;
}

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
                showTokenDialog(window.Application.PluginStorage.getItem("bgm_token"));
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
        alert("执行出错: " + e.message);
    }
    return true
}

function GetImage(control) {
    const eleId = control.Id
    switch (eleId) {
        case "btnShowMsg":
            return "images/1.svg"
        case "btnShowDialog":
            return "images/2.svg"
        case "btnShowTaskPane":
            return "images/3.svg"
        default:
            ;
    }
    return "images/newFromTemp.svg"
}

function GetBangumiImage(control) {
    return "images/newFromTemp.svg"
}

// ========== 显示同步面板 ==========
function showBangumiPanel() {
    let app = getApp();
    if (!app) {
        alert("无法获取 WPS Application 对象！");
        return;
    }
    
    let tsId = app.PluginStorage.getItem("taskpane_id");

    if (!tsId) {
        let tskpane = app.CreateTaskPane(GetUrlPath() + "/ui/taskpane.html");
        let id = tskpane.ID;
        app.PluginStorage.setItem("taskpane_id", id);
        tskpane.Visible = true;
    } else {
        let tskpane = app.GetTaskPane(tsId);
        tskpane.Visible = !tskpane.Visible;
    }
}

// ========== 获取 URL 路径 ==========
function GetUrlPath() {
    // manifest 中的基础路径
    if (window.location && window.location.href) {
        let currentUrl = window.location.href;
        let lastSlash = currentUrl.lastIndexOf("/");
        return currentUrl.substring(0, lastSlash);
    }
    return "";
}







