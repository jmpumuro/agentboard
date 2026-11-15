import { useEffect, useState, type RefObject } from 'react';
export function useCanvasSize(ref: RefObject<HTMLDivElement | null>, ready: boolean) {
    const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
    useEffect(() => { const update = () => { const box = ref.current?.getBoundingClientRect(); if (box?.width && box.height)
        setSize({ width: box.width, height: box.height }); }; update(); const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null; if (ref.current)
        observer?.observe(ref.current); window.addEventListener('resize', update); return () => { observer?.disconnect(); window.removeEventListener('resize', update); }; }, [ref, ready]);
    return size;
}
