/** Resolves a blob name to a short-lived read URL and renders it. */
import { usePhotoUrl } from "../api/hooks";
import { Spinner } from "./ui";

export function Photo({ blob, className = "", onClick }: { blob: string; className?: string; onClick?: () => void }) {
  const { data, isLoading, isError } = usePhotoUrl(blob);
  if (isLoading) return <div className={`flex items-center justify-center bg-panel-2 ${className}`}><Spinner /></div>;
  if (isError || !data) return <div className={`flex items-center justify-center bg-panel-2 text-xs text-slate-500 ${className}`}>no photo</div>;
  return <img src={data.url} alt="evidence" className={`object-cover ${className}`} onClick={onClick} loading="lazy" />;
}
