export function friendlyReaderError(error?: unknown) {
  const detail = (error instanceof Error ? error.message : error ? String(error) : "").replace(/^Error invoking remote method [^:]+: (?:Error: )?/, "");
      if (!detail) return '';
      if (detail === 'URL_EXISTS') return '这个订阅地址已经存在。';
      if (detail === 'FEED_CHANGED_DURING_SYNC') return '订阅已修改或删除，本次旧任务已停止，请按需重新刷新。';
      if (detail === 'FEED_NOT_FOUND') return '找不到该订阅源。';
      if (detail === 'URL_CHANGE_CONFIRMATION_REQUIRED') return '修改订阅地址需要明确确认。';
      if (detail === 'GROUP_NOT_FOUND') return '找不到该文件夹。';
      if (detail === 'GROUP_PARENT_NOT_FOUND') return '所选的上级文件夹已经不存在。';
      if (detail === 'GROUP_NAME_REQUIRED') return '请填写文件夹名称。';
      if (detail === 'GROUP_NAME_EXISTS') return '这里已经有同名的文件夹。';
      if (detail === 'GROUP_CYCLE') return '文件夹不能移动到它自己或它的子文件夹里。';
      if (detail === 'OPML_PREVIEW_REQUIRED') return '导入前请先选择 OPML 文件并预览。';
      if (detail === 'OPML_PREVIEW_EXPIRED') return 'OPML 预览已过期，请重新选择文件。';
      if (detail === 'SOURCE_ENDPOINT_NOT_FOUND') return '该端点已经不存在。';
      if (detail === 'X_API_FEED_NOT_ELIGIBLE') return 'Catpaw 无法从这个订阅源识别出 X 账号。';
      if (detail === 'X_API_NOT_CONFIGURED') return '启用这个实验性回退前，请先配置 X API Bearer Token。';
      if (detail === 'FEED_DISCOVERY_URL_INVALID') return '请输入有效的 HTTP 或 HTTPS 网址。';
      if (detail.startsWith('FEED_DISCOVERY_HTTP_')) return `网站返回了 HTTP ${detail.split('_').pop()}。`;
      if (detail === 'REFRESH_DAILY_TIME_INVALID') return '请选择有效的每日刷新时间。';
      if (detail === 'REFRESH_HISTORY_START_YEAR_INVALID') return '历史起始年份需要在 1990 到今年之间。';
      if (detail === 'REFRESH_HISTORY_MAX_PAGES_INVALID') return '单源最大回补页数需要在 1 到 300 之间。';
      if (detail === 'FEED_INTERVAL_INVALID') return '请选择有效的订阅源刷新间隔。';
      if (detail === 'FEED_FETCH_TIMEOUT') return '订阅源请求超时，可以重试或切换网络。';
      if (detail === 'WECHAT_LOGIN_REQUIRED') {
        return '需要登录微信，点击「登录微信」后继续。';
      }
      if (detail === 'CANCELLED') return '';
      if (detail.startsWith('IPC_INVALID_INPUT')) return '输入内容不符合要求，请检查后再试。';
      if (detail.includes('SQLITE_BUSY')) return '数据正在保存，请稍后重试。';
      if (/TIMEOUT|ETIMEDOUT|ECONN|ENOTFOUND/.test(detail)) return '网络请求未完成，请检查连接后重试。';
      if (detail.includes('NOT_A_CATPAW_BACKUP')) return '请选择 Catpaw 导出的数据备份。';
      if (detail.includes('BACKUP_REQUIRES_NEWER_APP')) return '这份备份需要更新版本的 Catpaw。';
      if (/BACKUP_|RESTORE_/.test(detail)) return '备份校验未通过，当前数据已保留。';
      if (detail.includes('QUEUE_FULL')) return '后台任务较多，请稍后重试。';
      return /^[A-Z_]+(?::|$)/.test(detail) ? '操作未完成，可导出诊断信息以便排查。' : detail;
}
