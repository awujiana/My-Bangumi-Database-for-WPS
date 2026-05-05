/**
 * 全局 Window 类型扩展
 * 定义项目自定义的全局函数
 */

interface BGMDialogOptions {
  onConfirm?: () => void;
  onCancel?: () => void;
  defaultValue?: string;
}

interface BGMAlert {
  (message: string, title?: string): void;
}

interface BGMConfirm {
  (message: string, onConfirm?: () => void, onCancel?: () => void): void;
}

interface BGMError {
  (message: string, title?: string): void;
}

interface BGMInput {
  (title: string, prompt: string, defaultValue: string, 
   onOk?: (value: string) => void, onCancel?: () => void): void;
}

interface BGMPrompt {
  (message: string, defaultValue?: string): string | null;
}

interface WPSPrompt {
  (message: string, defaultValue?: string): string | null;
}

declare interface Window {
  // 对话框相关
  BGMAlert?: BGMAlert;
  BGMConfirm?: BGMConfirm;
  BGMError?: BGMError;
  BGMInput?: BGMInput;
  BGMPrompt?: BGMPrompt;
  
  // 自定义对话框组件
  BGMDialog?: {
    alert: (title: string, message: string) => void;
    confirm: (title: string, message: string, options?: BGMDialogOptions) => void;
    error: (title: string, message: string) => void;
    input: (title: string, prompt: string, defaultValue: string, 
            onOk?: (value: string) => void, onCancel?: () => void) => void;
    show: (type: 'alert' | 'confirm' | 'error' | 'input', 
           title: string, message: string, options?: BGMDialogOptions) => void;
  };
  
  // WPS 特定
  wpsPrompt?: WPSPrompt;
  
  // Excel/WPS 事件
  onSelectModeChange?: () => void;
  
  // 回调相关
  _bgmConfirmCallback?: {
    confirm?: () => void;
    cancel?: () => void;
  };
  
  // Promise 版本 API
  fetchAllUserCollectionsAsync?: (token: string, userId: string) => Promise<BGMCollection[]>;
  fetchAllUserCollectionsByScrapingAsync?: (token: string, types: string[]) => Promise<BGMCollection[]>;
  httpRequestAsync?: (method: string, url: string, options?: HttpRequestOptions) => Promise<HttpResponse>;
}

// 回调函数类型
type DialogCallback = () => void;
type InputCallback = (value: string) => void;
type ConfirmCallback = (confirmed: boolean) => void;

// WPS Office Application 全局变量声明
declare const Application: unknown;
