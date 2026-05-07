/**
 * ��ʾ Token ���öԻ���
 */
export function showTokenDialog(currentToken: any): void;
/**
 * ��ʾ�û�ID���öԻ���
 */
export function showUserIdDialog(): void;
/**
 * ���� Token ״̬��ʾ
 */
export function updateTokenStatus(): void;
/**
 * �����û�ID״̬��ʾ
 */
export function updateUserIdStatus(): void;
/**
 * ���û��ղ�ҳ��
 */
export function openUserCollection(): void;
/**
 * ���� Token ��Ч��
 */
export function testTokenValidity(): void;
/**
 * ���Ե�������
 */
export function testDebugConnection(): void;
/**
 * ����������
 */
export function onAction(action: any): void;
/**
 * �����ִ��ͬ��
 */
export function syncFromPanel(): void;
/**
 * ���Ե�����Ŀ����
 */
export function testSingleUpdateFromPanel(): void;
/**
 * ��BGMͬ���ղر��
 */
export function syncCollectionFromBgm(): void;
/**
 * ͨ�� API ��ʽͬ���ղأ������棩
 * ���� Token ��֤����ȡ�������͡�����д��ͬ����¼���༶��ɫ���
 */
export function syncFromBgmByAPI(sheetIndex: any): void;
/**
 * ������ϴ���Ŀ��������
 * ֧�����ֵ��÷�ʽ��
 *   markUploadedItems(sheetIndex, collections) - ֱ�Ӵ�����������
 *   markUploadedItems(sheetName) - �����������ƣ��Զ���ȡ�ղ����ݺ���
 */
export function markUploadedItems(sheetIndexOrName: any, collections: any): void;
/**
 * ������������
 */
export function clearSheetMarks(sheetIndexOrName: any): void;
//# sourceMappingURL=handlers.d.ts.map