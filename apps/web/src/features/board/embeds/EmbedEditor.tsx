import { useState } from 'react';
import type { EmbedInputType } from 'contract';
import { embedDocument } from 'contract';
import { Modal, Button } from '../../../ui';
export function EmbedEditor({ element, onClose, onSave }: {
    element: EmbedInputType;
    onClose: () => void;
    onSave: (data: {
        text: string;
        html: string;
    }) => Promise<boolean>;
}) {
    const [title, setTitle] = useState(element.text), [html, setHtml] = useState(element.html), [busy, setBusy] = useState(false);
    return <Modal title="Edit HTML and CSS" wide onClose={onClose}><p className="muted">Self-contained HTML and CSS. Scripts, forms and outside assets are disabled.</p><form onSubmit={async (e) => { e.preventDefault(); if (!title.trim())
        return; setBusy(true); try {
        if (await onSave({ text: title.trim(), html }))
            onClose();
    }
    finally {
        setBusy(false);
    } }}><label>Mockup title<input autoFocus value={title} required maxLength={200} onChange={e => setTitle(e.target.value)}/></label><label>HTML and CSS<textarea className="embed-code" spellCheck={false} rows={12} maxLength={20000} value={html} onChange={e => setHtml(e.target.value)}/></label><div className="embed-editor-meta"><span>{html.length.toLocaleString()} / 20,000 characters</span><span>Live preview</span></div><iframe className="embed-preview" title="HTML mockup preview" sandbox="" referrerPolicy="no-referrer" srcDoc={embedDocument(html)}/><div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save mockup'}</Button></div></form></Modal>;
}
