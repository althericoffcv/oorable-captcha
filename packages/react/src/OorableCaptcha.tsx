import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from "react";
import { CaptchaWidget, type CaptchaHandle, type RenderOptions } from "@oorable/captcha-web";

/**
 * This component is deliberately a thin wrapper: all challenge logic, DOM
 * building, accessibility and theming live in @oorable/captcha-web's
 * CaptchaWidget (browser-tested in that package). Re-implementing that in
 * JSX would duplicate a few hundred lines of tested behavior for no benefit
 * -- React only needs to own the mount point and forward props/refs.
 */
export interface OorableCaptchaProps extends Omit<RenderOptions, "onSuccess" | "onError" | "onExpired"> {
  onSuccess?: (token: string) => void;
  onError?: (error: { code: string; message: string }) => void;
  onExpired?: () => void;
  className?: string;
  style?: CSSProperties;
}

export type OorableCaptchaRef = CaptchaHandle;

/**
 * <OorableCaptcha siteKey="..." type="meme-puzzle" onSuccess={setToken} />
 *
 * Mounts on mount, tears down on unmount, and remounts with a fresh
 * challenge whenever a prop that changes the *kind* of challenge (siteKey,
 * type, apiBaseUrl, difficulty, locale, theme...) changes -- callback props
 * are read from a ref instead, so passing a new inline arrow function on
 * every render does not remount the widget.
 */
export const OorableCaptcha = forwardRef<OorableCaptchaRef, OorableCaptchaProps>(function OorableCaptcha(props, ref) {
  const { className, style, ...rest } = props;
  const mountRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<CaptchaWidget | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useImperativeHandle(ref, () => ({
    reset: () => widgetRef.current?.reset() ?? Promise.resolve(),
    destroy: () => widgetRef.current?.destroy(),
    getToken: () => widgetRef.current?.getToken(),
    get element() {
      return widgetRef.current?.element ?? mountRef.current!;
    },
  }));

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    mount.replaceChildren();
    const widget = new CaptchaWidget(mount, {
      ...rest,
      onSuccess: (token) => propsRef.current.onSuccess?.(token),
      onError: (error) => propsRef.current.onError?.(error),
      onExpired: () => propsRef.current.onExpired?.(),
    });
    widgetRef.current = widget;
    void widget.start();
    return () => {
      widget.destroy();
      widgetRef.current = null;
    };
    // Re-create only when a prop that changes the challenge itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rest.siteKey,
    rest.type,
    rest.apiBaseUrl,
    rest.difficulty,
    rest.locale,
    rest.theme,
    rest.sessionId,
    rest.dragAndDrop,
    rest.tokenFieldName,
    rest.nonce,
    rest.messages,
    rest.fetch,
  ]);

  return <div ref={mountRef} className={className} style={style} />;
});

OorableCaptcha.displayName = "OorableCaptcha";
