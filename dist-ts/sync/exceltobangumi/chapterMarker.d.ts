/**
 * 获取条目的所有章节 ID（按集号排序）
 * @param sid 条目 ID
 * @param token API Token
 * @param signal 可选 AbortSignal，用于取消请求
 */
export declare function fetchEpisodeIds(sid: string | number, token: string, signal?: AbortSignal): Promise<number[]>;
/**
 * 标记前 N 集为已完成
 * @param sid 条目 ID
 * @param epCount 集数
 * @param token API Token
 * @param signal 可选 AbortSignal，用于取消请求
 */
export declare function markEpisodesComplete(sid: string | number, epCount: number, token: string, signal?: AbortSignal): Promise<{
    success: boolean;
    message: string;
}>;
//# sourceMappingURL=chapterMarker.d.ts.map