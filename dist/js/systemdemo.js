
/**
 * 系统演示模块
 * @module systemdemo
 * @description 处理来自业务系统的调用
 */

function openOfficeFileFromSystemDemo(param) {
    let jsonObj = (typeof(param) == 'string' ? JSON.parse(param) : param);
    let message = "从业务系统传过来的参数为：" + JSON.stringify(jsonObj);
    
    // 使用自定义对话框
    if (typeof window.BGMAlert === 'function') {
        window.BGMAlert(message, '系统演示');
    } else {
        window.alert(message);
    }
    
    return { wps加载项项返回: jsonObj.filepath + ", 这个地址给的不正确" };
}

function InvokeFromSystemDemo(param) {
    let jsonObj = (typeof(param) == 'string' ? JSON.parse(param) : param);
    let handleInfo = jsonObj.Index;
    switch (handleInfo) {
        case "getDocumentName": {
            let docName = "";
            if (window.Application && window.Application.ActiveWorkbook) {
                docName = window.Application.ActiveWorkbook.Name;
            }
            return { 当前打开的文件名为: docName };
        }

        case "newDocument": {
            let newDocName = "";
            if (window.Application) {
                let doc = window.Application.Workbooks.Add();
                newDocName = doc.Name;
            }
            return { 操作结果: "新建文档成功，文档名为：" + newDocName };
        }

        case "OpenFile": {
            let filePath = jsonObj.filepath;
            if (window.Application) {
                window.Application.Workbooks.OpenFromUrl(filePath);
            }
            return { 操作结果: "打开文件成功" };
        }
    }

    return { 其它xxx: "" };
}

// 挂载到 window
window.openOfficeFileFromSystemDemo = openOfficeFileFromSystemDemo;
window.InvokeFromSystemDemo = InvokeFromSystemDemo;
