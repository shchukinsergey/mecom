import { useEffect, useRef, useState } from 'react';
import { DecisionFieldHelp, type DecisionHelpField } from './DecisionFieldHelp';

export interface PlayerDecisionHelpProps {
  field: DecisionHelpField;
  label: string;
  id: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}

/** Click/tap and keyboard help; the original field definitions remain authoritative. */
export function PlayerDecisionHelp({ field, label, id, open, onToggle, onClose }: PlayerDecisionHelpProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const restoreAndClose = () => { onClose(); trigger.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!open) { setPosition(null); return; }
    const anchor = trigger.current;
    const popup = panel.current;
    if (!anchor || !popup) return;
    const rect = anchor.getBoundingClientRect();
    const viewport = window.visualViewport;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const popupWidth = Math.max(0, Math.min(360, width - 32));
    const maxHeight = Math.max(0, height - 32);
    // Size to the visible viewport before measuring, including keyboard/zoom.
    popup.style.width = `${popupWidth}px`;
    popup.style.maxHeight = `${maxHeight}px`;
    const box = popup.getBoundingClientRect();
    const leftEdge = viewport?.offsetLeft ?? 0;
    const topEdge = viewport?.offsetTop ?? 0;
    const proposedTop = rect.bottom + 8 + box.height <= topEdge + height - 16 ? rect.bottom + 8 : rect.top - box.height - 8;
    setPosition({
      width: popupWidth, maxHeight,
      left: Math.max(leftEdge + 16, Math.min(rect.left, leftEdge + width - box.width - 16)),
      top: Math.max(topEdge + 16, Math.min(proposedTop, topEdge + height - box.height - 16)),
    });
    close.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !popup.contains(event.target) && !anchor.contains(event.target)) onClose();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation();
      onClose(); anchor.focus({ preventScroll: true });
    };
    const dismiss = () => onClose();
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => {
      if (!anchor.getClientRects().length || anchor.closest('[hidden]')) onClose();
    });
    for (let node = anchor.parentElement; node; node = node.parentElement) observer?.observe(node, { attributes: true, attributeFilter: ['hidden', 'class', 'style', 'aria-hidden'] });
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keyboard, true);
    document.addEventListener('visibilitychange', dismiss);
    window.addEventListener('resize', dismiss);
    viewport?.addEventListener('resize', dismiss);
    viewport?.addEventListener('scroll', dismiss);
    return () => {
      observer?.disconnect();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keyboard, true);
      document.removeEventListener('visibilitychange', dismiss);
      window.removeEventListener('resize', dismiss);
      viewport?.removeEventListener('resize', dismiss);
      viewport?.removeEventListener('scroll', dismiss);
    };
  }, [open, onClose]);
  const help = <div ref={panel} id={`${id}-popover`} className="pc-help-popover" role="dialog" aria-label={`Подсказка: ${label}`} hidden={!open}
    style={open ? { position: 'fixed', zIndex: 1000, width: position?.width ?? 'min(360px, calc(100vw - 32px))', maxWidth: 'calc(100vw - 32px)', maxHeight: position?.maxHeight ?? 'calc(100dvh - 32px)', overflowY: 'auto', left: position?.left ?? 16, top: position?.top ?? 16, visibility: position ? 'visible' : 'hidden' } : undefined}>
    <div className="pc-help-heading"><strong>{label}</strong><button ref={close} type="button" className="pc-help-close" aria-label="Закрыть подсказку" onClick={restoreAndClose} style={{ minWidth: 44, minHeight: 44 }}>×</button></div>
    <DecisionFieldHelp field={field} id={id} />
  </div>;
  return <span className="pc-field-help">
    <button ref={trigger} type="button" className="pc-help-button pc-help-trigger" aria-label={`Подсказка: ${label}`} aria-expanded={open} aria-controls={`${id}-popover`} onClick={onToggle} style={{ minWidth: 44, minHeight: 44 }}><span>?</span></button>
    {help}
  </span>;
}
