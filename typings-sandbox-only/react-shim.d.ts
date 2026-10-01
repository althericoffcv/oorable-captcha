// SANDBOX-ONLY ambient shim, used solely by this repo's local tsc verification
// scripts (never referenced by any package's real tsconfig.json / npm run
// build). This environment has no network access to install the real
// `@types/react`, which a real consumer gets normally since `react` is a
// peerDependency. Minimal by design: just the surface OorableCaptcha.tsx
// actually uses, written from React's own public API, not copied from any
// package.
declare module "react" {
  export type ReactNode = unknown;
  export type Ref<T> = { current: T | null } | ((instance: T | null) => void) | null;
  export type RefObject<T> = { readonly current: T | null };
  export type CSSProperties = Record<string, string | number | undefined>;

  export function useRef<T>(initialValue: T): { current: T };
  export function useRef<T>(initialValue: T | null): { current: T | null };
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useImperativeHandle<T>(ref: Ref<T> | undefined, create: () => T, deps?: readonly unknown[]): void;

  export interface ForwardRefRenderFunction<T, P = {}> {
    (props: P, ref: Ref<T>): ReactNode;
  }
  export interface RefAttributes<T> {
    ref?: Ref<T>;
  }
  export type ForwardRefExoticComponent<P> = {
    (props: P): ReactNode;
    displayName?: string;
  };
  export function forwardRef<T, P = {}>(
    render: ForwardRefRenderFunction<T, P>,
  ): ForwardRefExoticComponent<P & RefAttributes<T>>;
}

declare module "react/jsx-runtime" {
  export default unknown;
}

declare namespace JSX {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface IntrinsicElements {
    [elemName: string]: any;
  }
  type Element = unknown;
}
