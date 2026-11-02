import { MAX_DAILY_MODEL_TOKENS, type ModelUsageStatus } from '../../../../../electron/contracts/model-usage';

type Props = {
  usage: ModelUsageStatus;
  enabled: boolean;
  limit: string;
  disabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onLimitChange: (limit: string) => void;
};

export function ModelUsageSettings({ usage, enabled, limit, disabled, onEnabledChange, onLimitChange }: Props) {
  return <fieldset className="model-usage-settings" disabled={disabled}>
    <legend>摘要与翻译共享额度</legend>
    <p className="model-usage-total" role="status">今日已计入 {usage.usedTokens.toLocaleString('zh-CN')} Token · {usage.requests.toLocaleString('zh-CN')} 次请求</p>
    {usage.estimatedRequests > 0 ? <p>其中 {usage.estimatedRequests} 次仍按预留量计入，可能正在处理，或未收到完整用量。</p> : null}
    <label className="model-usage-toggle">
      <input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} />
      <span>启用每日用量上限</span>
    </label>
    {enabled ? <label className="modal-row">
      <span>每日上限（Token）</span>
      <input type="number" min={1} max={MAX_DAILY_MODEL_TOKENS} step={1} value={limit}
        onChange={(event) => onLimitChange(event.target.value)} />
    </label> : null}
    <p>按本地日期每天重置。所有模型的摘要、翻译、分段和重试共同累计；精选的 Jev 额度单独计算。</p>
    <p>每次请求先预留输入与最大输出用量，余额不足时停止。服务返回用量后更新；失败或取消且用量未知时保留预留值。</p>
    <p>Token 是文本用量单位，不是金额。估算与实际用量可能有差异，费用以模型服务账单为准。长文会在开始前提示多次调用。</p>
  </fieldset>;
}
