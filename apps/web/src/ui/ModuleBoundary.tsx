import { Component, type ReactNode } from 'react';
export class ModuleBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() { return this.state.failed ? <div className="scene3d-module-error" role="alert"><p>The 3D view could not load.</p><button onClick={() => window.location.reload()}>Reload app</button></div> : this.props.children; }
}
