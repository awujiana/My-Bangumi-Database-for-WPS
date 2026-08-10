/**
 * 显示连接测试结果弹窗
 * 在 GitHub 配置测试完成后显示详细结果
 */
export declare function showConnectionTestDialog(result: {
    success: boolean;
    statusCode: number | null;
    responseTime: number;
    url: string;
    sourceType: string;
    errorMessage?: string | undefined;
}): void;
/**
 * 关闭连接测试结果弹窗
 */
export declare function hideConnectionTestDialog(): void;
//# sourceMappingURL=githubConfigDialog.d.ts.map