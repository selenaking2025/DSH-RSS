import React, { useEffect, useState } from 'react';
export type Question = { title: string; detail: string; confirmLabel?: string };
export function createConfirmation() {
  let listener: ((question: Question | null) => void) | undefined;
  let settle: ((answer: boolean) => void) | undefined;
  const answer = (value: boolean) => { settle?.(value); settle = undefined; listener?.(null); };
  return {
    ask(question: Question): Promise<boolean> {
      if (!listener || settle) return Promise.resolve(false);
      return new Promise(resolve => { settle = resolve; listener!(question); });
    },
    answer,
    subscribe(next: (question: Question | null) => void) {
      listener = next;
      return () => { answer(false); listener = undefined; };
    },
  };
}
export function Confirmation({ controller }: { controller: ReturnType<typeof createConfirmation> }) {
  const [question, setQuestion] = useState<Question | null>(null);
  useEffect(() => controller.subscribe(setQuestion), [controller]);
  if (!question) return null;
  return <div className="modal-overlay" role="alertdialog" aria-modal="true" aria-label={question.title}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); controller.answer(false); }
      if (event.key === 'Tab') {
        const buttons = event.currentTarget.querySelectorAll('button');
        const root = event.currentTarget.getRootNode() as ShadowRoot;
        event.preventDefault(); (root.activeElement === buttons[0] ? buttons[1] : buttons[0])?.focus();
      }
    }}>
    <div className="modal-card maintenance-modal">
      <div className="modal-body"><h2>{question.title}</h2><p style={{ whiteSpace: 'pre-line' }}>{question.detail}</p></div>
      <div className="modal-actions">
        <button className="modal-button" autoFocus onClick={() => controller.answer(false)}>取消</button>
        <button className="modal-button primary" onClick={() => controller.answer(true)}>{question.confirmLabel ?? '确认'}</button>
      </div>
    </div>
  </div>;
}
