import { ArchiveIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTableTabs } from "@/lib/table-tabs";
import { BucketSettings } from "./bucket-settings";
import { MultipartUploads } from "./multipart-uploads";
import { ObjectBrowser } from "./object-browser";
import { useStorageConnection } from "./use-storage-connection";

export function BucketView({ bucket }: { bucket: string }) {
  const { connection } = useStorageConnection();
  const openBucketTab = useTableTabs((state) => state.openBucketTab);
  const [tab, setTab] = useState("objects");

  useEffect(() => {
    openBucketTab({ bucket });
  }, [bucket, openBucketTab]);

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full min-h-0 w-full flex-col gap-0">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
        <ArchiveIcon className="size-5 shrink-0 text-orange-500" />
        <h1 className="truncate text-base font-semibold tracking-tight" title={bucket}>
          {bucket}
        </h1>
        <TabsList className="ml-auto">
          <TabsTrigger value="objects">Objekte</TabsTrigger>
          <TabsTrigger value="settings">Einstellungen</TabsTrigger>
          <TabsTrigger value="uploads">Unvollständige Uploads</TabsTrigger>
        </TabsList>
      </header>
      <TabsContent value="objects" className="min-h-0 flex-1">
        <ObjectBrowser bucket={bucket} active={tab === "objects"} />
      </TabsContent>
      <TabsContent value="settings" className="min-h-0 flex-1 overflow-auto">
        <BucketSettings bucket={bucket} />
      </TabsContent>
      <TabsContent value="uploads" className="min-h-0 flex-1 overflow-auto">
        <MultipartUploads bucket={bucket} />
      </TabsContent>
    </Tabs>
  );
}
