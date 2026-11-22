/**
 * Fixed full-viewport background, rendered once in the root layout behind
 * everything (`-z-10`, no pointer events). Both theme layers are in the DOM
 * and the `dark` / `light` class on <html> picks one, so there is no
 * hydration flash and no client JS.
 *
 * Neon orange on black (owner, 2026-11-22): pure CSS glows instead of Lume's
 * lime gradient photo, drifting slowly like Lume's.
 */
export function AppBackground() {
  return (
    <div aria-hidden data-app-bg className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 hidden bg-[#050505] dark:block">
        <div className="absolute -inset-[15%] will-change-transform [animation:bg-drift_90s_ease-in-out_infinite_alternate] bg-[radial-gradient(42%_55%_at_68%_18%,rgba(255,106,26,1)_0%,rgba(255,80,0,0.55)_38%,transparent_72%),radial-gradient(30%_40%_at_92%_70%,rgba(255,150,40,0.7)_0%,transparent_70%),radial-gradient(35%_45%_at_15%_95%,rgba(255,60,0,0.4)_0%,transparent_70%)] blur-[40px]" />
        <div className="absolute inset-0 bg-[#050505]/20" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(0,0,0,0.55)_100%)]" />
      </div>

      <div className="absolute inset-0 hidden bg-gradient-to-br from-[#fbf4ee] to-[#f3e2d4] light:block">
        <div className="absolute -inset-[15%] bg-[radial-gradient(40%_50%_at_70%_15%,rgba(255,106,26,0.28)_0%,transparent_70%),radial-gradient(35%_45%_at_10%_90%,rgba(255,140,40,0.16)_0%,transparent_70%)] blur-[40px]" />
      </div>
    </div>
  )
}
