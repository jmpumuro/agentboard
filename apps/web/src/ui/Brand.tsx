/** One wordmark shared by the sign-in screen and expanding navigation. */
export function Brand({ showName = true }: {
    showName?: boolean;
}) {
    return <><span className="logo" aria-hidden="true">a<span>·</span></span>{showName && <span className="brand-name"><span className="brand-agent">Agent</span><span className="brand-board">Board</span></span>}</>;
}
