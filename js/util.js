//在后续的wps版本中，wps的所有枚举值都会通过wps.Enum对象来自动支持，现阶段先人工定义
var WPS_Enum = {
    msoCTPDockPositionLeft:0,
    msoCTPDockPositionRight:2
}

function GetUrlPath() {
    // 优先使用 manifest 中的基础路径
    let manifestPath = window.Application.PluginStorage.getItem("manifest_base_path");
    if (manifestPath) {
        return manifestPath;
    }
    // 回退：使用当前页面路径
    if (typeof document !== 'undefined' && document.location && document.location.toString) {
        let e = document.location.toString();
        return -1 != (e = decodeURI(e)).indexOf("/") && (e = e.substring(0, e.lastIndexOf("/"))), e;
    }
    // Ribbon 上下文：返回默认路径
    return "";
}
/**
 * 通过wps提供的接口执行一段脚本
 * @param {*} param 需要执行的脚本
 */
function shellExecuteByOAAssist(param) {
    if (window.Application != null) {
        window.Application.OAAssist.ShellExecute(param)
    }
}