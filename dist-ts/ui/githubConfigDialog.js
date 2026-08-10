/**
 * 显示连接测试结果弹窗
 * 在 GitHub 配置测试完成后显示详细结果
 */
export function showConnectionTestDialog(result) {
    const modal = document.getElementById('connectionTestModal');
    const body = document.getElementById('connectionTestBody');
    if (!modal || !body)
        return;
    const { success, statusCode, responseTime, url, sourceType, errorMessage } = result;
    // 根据数据源类型获取显示名称
    const sourceTypeNames = {
        github: 'GitHub',
        gitlab: 'GitLab',
        gitee: 'Gitee',
        gist: 'Gist',
        local: '本地文件',
    };
    const sourceLabel = sourceTypeNames[sourceType] || sourceType;
    // 构造结果详情 HTML
    const statusColor = success ? '#4CAF50' : '#f44336';
    const statusText = success ? '✅ 连接成功' : '❌ 连接失败';
    const responseText = responseTime > 0 ? `${responseTime}ms` : '超时';
    const statusCodeText = statusCode !== null ? String(statusCode) : '无响应';
    const bodyHtml = `
    <div class="connection-test-result">
      <div class="connection-status" style="color:${statusColor};">
        <strong>${statusText}</strong>
      </div>
      <div class="connection-test-details">
        <div class="detail-row">
          <span class="detail-label">测试地址：</span>
          <span class="detail-value" title="${escapeHtml(url)}">${escapeHtml(url)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">数据源类型：</span>
          <span class="detail-value">${escapeHtml(sourceLabel)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">响应时间：</span>
          <span class="detail-value">${responseText}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">状态码：</span>
          <span class="detail-value" style="color:${statusColor};">${statusCodeText}</span>
        </div>
        ${errorMessage ? `
        <div class="detail-row error-row">
          <span class="detail-label">错误信息：</span>
          <span class="detail-value error-msg">${escapeHtml(errorMessage)}</span>
        </div>` : ''}
      </div>
    </div>
  `;
    body.innerHTML = bodyHtml;
    modal.style.display = 'block';
}
/**
 * 关闭连接测试结果弹窗
 */
export function hideConnectionTestDialog() {
    const modal = document.getElementById('connectionTestModal');
    if (modal) {
        modal.style.display = 'none';
    }
}
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
