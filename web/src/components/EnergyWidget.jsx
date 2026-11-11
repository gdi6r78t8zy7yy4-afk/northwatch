import React from 'react';

// Widgetkorts-skal: hela kortet är klickbart och öppnar modalförstoring.
// Underpunkter i brödet (elområden, länder, rutter) är egna knappar som
// stoppar bubbling och öppnar med eget filter – e.target-guarden gör att
// tangentbordsaktivering i underpunkt inte dubbelutlöser kortet.
export default function EnergyWidget({ widget, onOpen, wide = false, children }) {
  const open = () => onOpen?.(widget.id);
  return <article className={'nw-widget' + (wide ? ' nw-widget-wide' : '')}
    role="button" tabIndex={0} aria-label={`${widget.title} – öppna detaljer`}
    onClick={open}
    onKeyDown={event => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
        event.preventDefault(); open();
      }
    }}>
    <header className="nw-widget-head">
      <h2>{widget.title}</h2>
      <span className="nw-widget-open" aria-hidden="true">⤢</span>
    </header>
    <div className="nw-widget-hint">{widget.hint}</div>
    <div className="nw-widget-body">{children}</div>
  </article>;
}

// Klickbar underpunkt inuti ett widgetkort.
export function WidgetItem({ children, onOpen, active = false }) {
  return <button type="button" className={'nw-widget-item' + (active ? ' on' : '')}
    onClick={event => { event.stopPropagation(); onOpen?.(); }}
    onKeyDown={event => event.stopPropagation()}>
    {children}
  </button>;
}
