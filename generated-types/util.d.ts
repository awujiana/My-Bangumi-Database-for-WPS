export function bgmLog(level: any, message: any): void;
export function getApp(): any;
export function colNumToLetter(col: any): string;
export function getCell(ws: any, row: any, col: any): any;
export function getCellValue(ws: any, row: any, col: any): string;
export function readCell(ws: any, row: any, col: any): string;
export function setCellValue(ws: any, row: any, col: any, value: any): boolean;
export function getSheetByIndex(sheetIndex: any): any;
export function escapeHtml(text: any): string;
export function storeBgToken(token: any): boolean;
export function clearBgToken(): boolean;
export function loadBgToken(): string | null;
export function _setBgmUserId(id: any): void;
export function _getBgmUserId(): null;
export function _getUserApiPath(): string;
export function _fetchBgmUserInfo(callback: any): void;
export function fetchBgmUserInfo(): Promise<any>;
export function shellExecuteByOAAssist(param: any): void;
export function GetUrlPath(): any;
export function showBangumiPanel(): void;
export function trim(str: any): string;
export function wpsPrompt(message: any, defaultValue: any): Promise<any>;
export function wpsMsgBox(message: any, buttons: any, icon: any): Promise<any>;
export function sleep(ms: any): void;
export function showAlertDialog(title: any, message: any): void;
export function closeAlertDialog(): void;
export const WPS_Enum: import("./core/constants.js").WPSEnum;
export namespace BGM {
    export namespace cache {
        let totalRows: number;
        let userId: null;
        let username: null;
        let sidCache: Map<any, any>;
        let listCache: never[];
    }
    export namespace sheet {
        let lockedIndex: null;
        let lockedName: null;
        let isLocked: boolean;
    }
    export namespace sync {
        let isRunning: boolean;
        let lastSyncTime: null;
    }
    export let LOG_LEVEL: 1;
    export { LOG_LEVELS };
    export { ERROR_LEVELS };
    export { ErrorLevel };
    export { BgmError };
    export namespace Dialog {
        function alert(title: any, message: any): void;
        function confirm(message: any, onConfirm: any, onCancel: any): void;
        function error(title: any, message: any): void;
        function input(title: any, prompt: any, defaultValue: any, onOk: any, onCancel: any): void;
        function show(type: any, title: any, message: any, options: any): void;
    }
    export namespace Message {
        function send(data: any, targetOrigin: any): boolean;
        function postMessage(data: any, targetOrigin: any): boolean;
    }
    export function postMessage_1(data: any, targetOrigin: any): boolean;
    export { postMessage_1 as postMessage };
    export function showDialog(title: any, message: any): void;
    export function showConfirm(title: any, message: any, onConfirm: any, onCancel: any): void;
    export function handleError(error: any, options: any): BgmError;
    export function safeExecute(fn: any, context: any, options: any): any;
}
import { BgmError } from './tools/index.js';
import { ErrorLevel } from './tools/index.js';
import { XL } from './core/constants.js';
import { BGM_CONFIG } from './core/constants.js';
import { BGM_COLOR } from './core/constants.js';
import { LOG_LEVELS } from './core/constants.js';
import { ERROR_LEVELS } from './core/constants.js';
import { PANEL_CONFIG } from './core/constants.js';
import { BGM_SUBJECT_TYPES } from './core/constants.js';
import { SYNC_STATUS } from './core/constants.js';
export { BgmError, ErrorLevel, XL, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, ERROR_LEVELS, PANEL_CONFIG, BGM_SUBJECT_TYPES, SYNC_STATUS };
//# sourceMappingURL=util.d.ts.map