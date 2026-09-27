import { SettingsCard } from "./settings-card";
import { TagsEditor } from "./tags-editor";
import { useStorageConnection } from "./use-storage-connection";

export function BucketTagsSettings({ bucket }: { bucket: string }) {
  const { readOnly } = useStorageConnection();
  return (
    <SettingsCard title="Tags">
      <TagsEditor target={{ bucket }} readOnly={readOnly} />
    </SettingsCard>
  );
}
