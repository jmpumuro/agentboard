import React from 'react';
import type { DrawingInputType } from 'contract';
export const DrawingView = React.memo(function DrawingView({ drawing }: {
    drawing: DrawingInputType;
}) {
    return <svg className="drawing-ink" viewBox={`0 0 ${drawing.vw} ${drawing.vh}`} preserveAspectRatio="none" role="img" aria-label={drawing.text}>
  {drawing.strokes.map((stroke, index) => <polyline key={index} points={stroke.join(' ')} fill="none" stroke="currentColor" strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round"/>)}
 </svg>;
});
