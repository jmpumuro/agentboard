import { memo } from 'react';
import { embedDocument } from 'contract';
/** Geometry is owned by the outer board element. Frames remount only for changed HTML. */
export const EmbedView = memo(function EmbedView({ html, title, visible = true }: {
    html: string;
    title: string;
    visible?: boolean;
}) {
    return <div className="embed-card"><div className="embed-title"><span aria-hidden="true">&lt;/&gt;</span><span>{title}</span></div>{visible ? <iframe key={html} className="embed-frame" title={title} sandbox="" referrerPolicy="no-referrer" tabIndex={-1} srcDoc={embedDocument(html)}/> : <div className="embed-unmounted">HTML / CSS mockup</div>}</div>;
});
