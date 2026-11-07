import { WifiOffIcon } from "lucide-react";
export function JobOfflineNotice() {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
        <WifiOffIcon className="h-4 w-4" />
        Offline mode
      </div>
    </div>
  );
}
