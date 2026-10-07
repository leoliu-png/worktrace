import type { MobiusMatchDecision } from '@/lib/mobius-match';

export function MobiusMatchDetails({ decisions, locale }: { decisions?: MobiusMatchDecision[]; locale: 'zh' | 'en' }) {
  if (!decisions?.length) return null;
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const choice = (value: string) => value === 'NONE' ? text('无明确匹配', 'No clear match') : value;
  const methods = { jev: 'Jev', rules: text('关键词规则', 'Keyword rules'), identifier: text('日志中的 Issue 编号', 'Explicit issue identifier') };
  return <div className="wt-match-decisions">{decisions.map((decision, index) => <details className="wt-match-decision" key={index}>
    <summary>{text('匹配方式', 'Matching method')}：{methods[decision.method]}{decision.probability !== undefined && <span>{text('选择概率', 'Selection probability')} {percent(decision.probability)}</span>}</summary>
    <div className="wt-match-decision-body">
      {decisions.length > 1 && <p>{decision.entry.text}</p>}
      {decision.selected && <p>{text('选择结果', 'Selected')}：{choice(decision.selected)}</p>}
      {decision.method === 'jev' && <>
        <dl className="wt-match-metrics">
          {decision.confidence !== undefined && <div><dt>Confidence</dt><dd>{percent(decision.confidence)}</dd></div>}
          {decision.margin !== undefined && <div><dt>{text('领先幅度', 'Lead over runner-up')}</dt><dd>{percent(decision.margin)}</dd></div>}
          {decision.candidateCount !== undefined && <div><dt>{text('参与匹配的 Issue', 'Candidate issues')}</dt><dd>{decision.candidateCount}</dd></div>}
        </dl>
        {!!decision.candidates?.length && <ul className="wt-match-candidates">{decision.candidates.map((candidate) => <li key={candidate.identifier}><span>{choice(candidate.identifier)}{candidate.title && ` · ${candidate.title}`}</span><strong>{percent(candidate.probability)}</strong></li>)}</ul>}
        {decision.thresholds && <p className="wt-match-note">{text(`自动匹配要求：选择概率 ≥ ${percent(decision.thresholds.probability)}，confidence ≥ ${percent(decision.thresholds.confidence)}，领先幅度 ≥ ${percent(decision.thresholds.margin)}。`, `Automatic matching requires probability ≥ ${percent(decision.thresholds.probability)}, confidence ≥ ${percent(decision.thresholds.confidence)}, and lead ≥ ${percent(decision.thresholds.margin)}.`)}</p>}
        {decision.model && <p className="wt-match-note">{text('使用模型', 'Model')}：{decision.model}</p>}
      </>}
    </div>
  </details>)}</div>;
}
