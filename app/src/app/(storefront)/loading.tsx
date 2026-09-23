import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="flex flex-1 flex-col gap-3 p-4">
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}
