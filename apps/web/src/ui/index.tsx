import { Bot, Copy, RefreshCw, X } from 'lucide-react';
import React, { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
export const ToastContext = createContext<(text: string, action?: () => void) => void>(() => { });
export function useToast() { return useContext(ToastContext); }
export function Button({ children, onClick, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) { return <button className={'btn ' + className} onClick={onClick} {...rest}>{children}</button>; }
export function IconButton({ label, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string;
}) { return <button className="icon-btn" title={label} aria-label={label} {...props}>{children}</button>; }
export function Modal({ title, children, onClose, wide = false }: {
    title: string;
    children: ReactNode;
    onClose: () => void;
    wide?: boolean;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
    return <dialog ref={ref} className={wide ? 'wide' : ''} onCancel={onClose} onClick={e => {
            if (e.target === ref.current)
                onClose();
        }}><div className="dialog-head"><h2>{title}</h2><IconButton label="Close dialog" onClick={onClose}><X size={20}/></IconButton></div>{children}</dialog>;
}
export function Load({ error, refetch }: {
    error?: Error | null;
    refetch?: () => void;
}) { return error ? <div className="empty"><p>{error.message}</p><Button onClick={refetch}><RefreshCw size={15}/>Try again</Button></div> : <div className="skeleton"><i /><i /><i /></div>; }
export function Stamp({ kind = 'user', name, size = '' }: {
    kind?: string;
    name: string;
    size?: string;
}) { return <span title={name} className={'avatar ' + kind + ' ' + size}>{kind === 'agent' ? <Bot size={15}/> : name.slice(0, 1).toUpperCase()}</span>; }
export function CopyCode({ value }: {
    value: string;
}) {
    const toast = useToast();
    return <div className="code-block"><pre>{value}</pre><IconButton label="Copy to clipboard" onClick={async () => {
            try {
                await navigator.clipboard.writeText(value);
                toast('Copied.');
            }
            catch {
                toast('Select and copy the text manually.');
            }
        }}><Copy size={15}/></IconButton></div>;
}
