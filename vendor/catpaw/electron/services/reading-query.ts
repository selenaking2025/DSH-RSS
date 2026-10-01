import { ReadingError, todayReadingWindow, type ReadingQuery } from '../contracts/smart-reading';

function dateValue(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!match) throw new ReadingError('请输入 YYYY-MM-DD 格式的日期。');
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== +match[1] || date.getMonth() !== +match[2] - 1 || date.getDate() !== +match[3]) throw new ReadingError('日期无效。');
  return date;
}
export function parseReadingQuery(text: string, sources: { feeds: { id: string; title: string | null }[]; groups: { id: string; name: string }[] }, now = new Date()): ReadingQuery {
  if (!text.trim() || text.length > 2000) throw new ReadingError('请输入不超过 2000 字的筛选条件。');
  if (/只[看要].*(?:已读|收藏)|(?:only|just)\s+(?:read|starred)/i.test(text)) throw new ReadingError('当前支持全部文章或只看未读；已读、收藏条件请使用阅读器原有筛选。');
  const window = todayReadingWindow(now), start = new Date(window.since), end = new Date(window.until);
  start.setDate(start.getDate() - 6);
  const dates = text.match(/\b\d{4}-\d{2}-\d{2}\b/g);
  if (dates?.length) {
    if (dates.length > 2) throw new ReadingError('一次筛选最多指定一个起止日期范围。');
    start.setTime(dateValue(dates[0]).getTime());
    const last = dateValue(dates[1] ?? dates[0]); last.setDate(last.getDate() + 1); end.setTime(last.getTime());
  } else if (/昨天|yesterday/i.test(text)) {
    start.setTime(window.since); start.setDate(start.getDate() - 1); end.setTime(window.since);
  } else if (/今天|今日|today/i.test(text)) start.setTime(window.since);
  else if (/本周|this week/i.test(text)) { start.setTime(window.since); start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); }
  else if (/本月|this month/i.test(text)) { start.setTime(window.since); start.setDate(1); }
  else {
    const days = text.match(/(?:最近|过去|近|last|past)\s*(\d+|一|二|两|三|四|五|六|七|八|九|十)\s*(天|周|星期|days?|weeks?)/i);
    if (days) {
      const number = Number(days[1]) || ({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 } as Record<string, number>)[days[1]];
      const count = number * (/周|星期|weeks?/i.test(days[2]) ? 7 : 1);
      if (!count || count < 1 || count > 366) throw new ReadingError('请将查询范围设在 1–366 天内。');
      start.setTime(window.since); start.setDate(start.getDate() - (count - 1));
    } else if (/上周|上个月|上月|去年|前年|last month|last year|(?:最近|过去|近|last|past)\s*\S*\s*(?:月|年|months?|years?)/i.test(text)) {
      throw new ReadingError('请用具体日期范围，例如 2026-08-01 至 2026-08-31，或在条件中调整日期。');
    }
  }
  if (end <= start || end.getTime() - start.getTime() > 367 * 86400000) throw new ReadingError('日期范围无效，请选择一年以内的范围。');
  const feedIds = sources.feeds.filter((feed) => feed.title && feed.title.length > 1 && text.toLowerCase().includes(feed.title.toLowerCase())).map((f) => f.id);
  const groupIds = sources.groups.filter((group) => group.name.length > 1 && text.includes(group.name)).map((g) => g.id);
  return { text: text.trim(), description: text.trim(), since: start.getTime(), until: end.getTime(),
    onlyUnread: /未读|unread/i.test(text), feedIds, groupIds };
}
