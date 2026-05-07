
/**
 * 系统演示模块
 * @module systemdemo
 * @description 处理来自业务系统的调用
 */

function openOfficeFileFromSystemDemo(param) {
    let jsonObj = (typeof(param) == 'string' ? JSON.parse(param) : param);
    let message = "\u4ECE\u4E1A\u52A1\u7CFB\u7EDF\u4F20\u8FC7\u6765\u7684\u53C2\u6570\u4E3A：" + JSON.stringify(jsonObj);
    
    // 使用自定义对话框
    if (typeof window.BGMAlert === 'function') {
        window.BGMAlert(message, '\u7CFB\u7EDF\u6F14\u793A');
    } else {
        window.alert(message);
    }
    
    return { wps加载项项返回: jsonObj.filepath + ", \u8FD9\u4E2A\u5730\u5740\u7ED9\u7684\u4E0D\u6B63\u786E" };
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
            return { 操作结果: "\u65B0\u5EFA\u6587\u6863\u6210\u529F，\u6587\u6863\u540D\u4E3A：" + newDocName };
        }

        case "OpenFile": {
            let filePath = jsonObj.filepath;
            if (window.Application) {
                window.Application.Workbooks.OpenFromUrl(filePath);
            }
            return { 操作结果: "\u6253\u5F00\u6587\u4EF6\u6210\u529F" };
        }
    }

    return { 其它xxx: "" };
}

// 挂载到 window
window.openOfficeFileFromSystemDemo = openOfficeFileFromSystemDemo;
window.InvokeFromSystemDemo = InvokeFromSystemDemo;
