import { useEffect, useState } from "react";

export function Icon({ name }: { name: string }) {
  return <svg aria-hidden="true"><use href={`/assets/icons.svg#${name}`} /></svg>;
}

export function ImageWithState({
  src,
  alt,
  className,
  loading = "lazy",
  fetchPriority = "auto",
  retryable = true,
  onClick,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
  retryable?: boolean;
  onClick?: () => void;
}) {
  const [state, setState] = useState<"loading" | "ready" | "error">(src ? "loading" : "error");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { setState(src ? "loading" : "error"); }, [src]);
  if (!src) return <span className={`image-state ${className ?? ""} is-error`} role="img" aria-label={`${alt}不可用`} />;
  return <span className={`image-state ${className ?? ""} ${state}`}>
    <img key={`${src}:${attempt}`} src={src} alt={alt} loading={loading} decoding="async" fetchPriority={fetchPriority} onLoad={() => setState("ready")} onError={() => setState("error")} onClick={onClick} />
    {state === "loading" && <span className="image-state-loading" aria-hidden="true"><i /></span>}
    {state === "error" && <span className="image-state-error" role={retryable ? "button" : undefined} tabIndex={retryable ? 0 : undefined} onClick={retryable ? () => { setAttempt((value) => value + 1); setState("loading"); } : undefined} onKeyDown={retryable ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setAttempt((value) => value + 1); setState("loading"); } } : undefined}>{retryable ? "重新加载" : "图片不可用"}</span>}
  </span>;
}
