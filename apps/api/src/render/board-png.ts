import { drawScene3D } from './scene3d';
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { Element } from 'contract';
import { DrawingRegionSchema } from 'contract';
import type { BoardData } from '../db/store';
export type Region = {
    x: number;
    y: number;
    w: number;
    h: number;
};
export type BoardImage = {
    mimeType: 'image/png';
    data: string;
    seq: number;
    width: number;
    height: number;
    region: Region;
};
const colors = { yellow: '#f6e7a6', blue: '#d7e6ef', green: '#d6e9d2', pink: '#f0d7db', purple: '#e4dcf1', white: '#f1f0e8' };
const cache = new Map<string, BoardImage>();
let cachedBytes = 0;
function size(e: Element) { return { w: 'w' in e ? e.w : e.type === 'text' ? Math.min(1000, Math.max(80, e.text.length * 12)) : 0, h: 'h' in e ? e.h : 60 }; }
function contentBounds(b: BoardData): Region {
    const list = Object.values(b.elements).filter(e => e.type !== 'arrow');
    if (!list.length)
        return { x: 0, y: 0, w: 800, h: 500 };
    const x = Math.min(...list.map(e => e.x)) - 24, y = Math.min(...list.map(e => e.y)) - 24;
    return { x, y, w: Math.max(...list.map(e => e.x + size(e).w)) - x + 24, h: Math.max(...list.map(e => e.y + size(e).h)) - y + 24 };
}
function text(ctx: SKRSContext2D, value: string, x: number, y: number, width: number, height: number, fontSize = 15) {
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textBaseline = 'top';
    const words = value.slice(0, 4000).split(/(\s+)/);
    let line = '', top = y;
    for (const word of words) {
        if ((ctx.measureText(line + word).width > width || word.includes('\n')) && line) {
            ctx.fillText(line, x, top, width);
            line = '';
            top += fontSize * 1.4;
            if (top > y + height - fontSize)
                return;
        }
        line += word.replace(/\n/g, ' ');
    }
    if (line)
        ctx.fillText(line, x, top, width);
}
/** Numeric board rendering plus trusted Three.js-generated primitive paths. No browser or network. */
export function renderBoard(b: BoardData, inputRegion?: Region): BoardImage {
    const region = inputRegion ? DrawingRegionSchema.parse(inputRegion) : contentBounds(b);
    const key = JSON.stringify([b.board.id, b.board.seq, region]);
    const hit = cache.get(key);
    if (hit) {
        cache.delete(key);
        cache.set(key, hit);
        return hit;
    }
    const scale = Math.min(2, 2000 / Math.max(region.w, region.h));
    const width = Math.max(1, Math.min(2000, Math.ceil(region.w * scale))), height = Math.max(1, Math.min(2000, Math.ceil(region.h * scale)));
    const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.scale(scale, scale);
    ctx.translate(-region.x, -region.y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const deadline = performance.now() + 1500;
    for (const id of b.board.order) {
        if (performance.now() > deadline)
            throw new Error('Board rendering exceeded its time budget.');
        const e = b.elements[id];
        if (!e)
            continue;
        ctx.save();
        ctx.strokeStyle = '#111111';
        ctx.fillStyle = '#111111';
        ctx.lineWidth = 1.5;
        if (e.type === 'drawing') {
            ctx.translate(e.x, e.y);
            ctx.lineWidth = 3;
            for (const stroke of e.strokes) {
                if (performance.now() > deadline)
                    throw new Error('Board rendering exceeded its time budget.');
                ctx.beginPath();
                ctx.moveTo(stroke[0] * e.w / e.vw, stroke[1] * e.h / e.vh);
                for (let i = 2; i < stroke.length; i += 2)
                    ctx.lineTo(stroke[i] * e.w / e.vw, stroke[i + 1] * e.h / e.vh);
                if (stroke.every((n, i) => n === stroke[i % 2]))
                    ctx.lineTo(stroke[0] * e.w / e.vw + .01, stroke[1] * e.h / e.vh);
                ctx.stroke();
            }
        }
        else if (e.type === 'arrow') {
            const a = b.elements[e.from], z = b.elements[e.to];
            if (a && z) {
                const x = a.x + size(a).w / 2, y = a.y + size(a).h / 2, u = z.x + size(z).w / 2, v = z.y + size(z).h / 2;
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(u, v);
                const angle = Math.atan2(v - y, u - x);
                ctx.moveTo(u - 10 * Math.cos(angle - .5), v - 10 * Math.sin(angle - .5));
                ctx.lineTo(u, v);
                ctx.lineTo(u - 10 * Math.cos(angle + .5), v - 10 * Math.sin(angle + .5));
                ctx.stroke();
                if (e.label)
                    text(ctx, e.label, (x + u) / 2, (y + v) / 2 - 18, 250, 40, 12);
            }
        }
        else if (e.type === 'scene3d') {
            ctx.fillStyle = '#ffffff'; ctx.fillRect(e.x, e.y, e.w, e.h);
            drawScene3D(ctx, e);
            ctx.strokeRect(e.x, e.y, e.w, e.h); ctx.fillStyle = '#111111';
            text(ctx, e.text, e.x + 10, e.y + 7, e.w - 20, 24, 13);
            text(ctx, `${e.parts.length} named parts · ${Math.round(e.explode * 100)}% pulled apart`, e.x + 10, e.y + e.h - 25, e.w - 20, 22, 11);
        }
        else if (e.type === 'embed') {
            ctx.fillStyle = '#f1f0e8';
            ctx.fillRect(e.x, e.y, e.w, e.h);
            ctx.strokeRect(e.x, e.y, e.w, e.h);
            ctx.fillStyle = '#111111';
            text(ctx, e.text, e.x + 14, e.y + 14, e.w - 28, 50, 16);
            text(ctx, 'HTML / CSS mockup — open on the board to view', e.x + 14, e.y + 64, e.w - 28, 70, 12);
        }
        else if (e.type === 'text') {
            text(ctx, e.text, e.x, e.y, size(e).w, 400, e.size === 'title' ? 32 : e.size === 'large' ? 24 : e.size === 'small' ? 13 : 18);
        }
        else {
            ctx.fillStyle = colors[e.color];
            ctx.beginPath();
            if (e.type === 'shape' && e.kind === 'ellipse')
                ctx.ellipse(e.x + e.w / 2, e.y + e.h / 2, e.w / 2, e.h / 2, 0, 0, Math.PI * 2);
            else if (e.type === 'shape' && e.kind === 'diamond') {
                ctx.moveTo(e.x + e.w / 2, e.y);
                ctx.lineTo(e.x + e.w, e.y + e.h / 2);
                ctx.lineTo(e.x + e.w / 2, e.y + e.h);
                ctx.lineTo(e.x, e.y + e.h / 2);
                ctx.closePath();
            }
            else
                ctx.roundRect(e.x, e.y, e.w, e.h, e.type === 'shape' && e.kind === 'rounded' ? 16 : 1);
            ctx.fill();
            if (e.type === 'shape')
                ctx.stroke();
            ctx.fillStyle = '#111111';
            text(ctx, e.text, e.x + 16, e.y + 16, e.w - 32, e.h - 32);
        }
        ctx.restore();
    }
    const data = canvas.toBuffer('image/png').toString('base64');
    const image: BoardImage = { mimeType: 'image/png', data, seq: b.board.seq, width, height, region };
    while (cache.size >= 8 || cachedBytes + data.length > 16 * 1024 * 1024) {
        const oldest = cache.keys().next().value;
        if (!oldest)
            break;
        cachedBytes -= cache.get(oldest)!.data.length;
        cache.delete(oldest);
    }
    if (data.length <= 16 * 1024 * 1024) {
        cache.set(key, image);
        cachedBytes += data.length;
    }
    return image;
}
