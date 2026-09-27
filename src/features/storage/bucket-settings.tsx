import { BucketStatsCard } from "./bucket-stats-card";
import { BucketTagsSettings } from "./bucket-tags-settings";
import { EncryptionSettings } from "./encryption-settings";
import { LifecycleSettings } from "./lifecycle-settings";
import { ObjectLockSettings } from "./object-lock-settings";
import { PolicySettings } from "./policy-settings";
import { RawConfigSettings } from "./raw-config-settings";
import { VersioningSettings } from "./versioning-settings";

const CORS = `<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>https://example.com</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3000</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>`;

const NOTIFICATION = `<NotificationConfiguration>
  <QueueConfiguration>
    <Queue>arn:minio:sqs::primary:webhook</Queue>
    <Event>s3:ObjectCreated:*</Event>
    <Filter><S3Key><FilterRule><Name>prefix</Name><Value>uploads/</Value></FilterRule></S3Key></Filter>
  </QueueConfiguration>
</NotificationConfiguration>`;

const REPLICATION = `<ReplicationConfiguration>
  <Role>arn:aws:iam::123456789012:role/replication</Role>
  <Rule>
    <ID>replicate-all</ID>
    <Status>Enabled</Status>
    <Priority>1</Priority>
    <DeleteMarkerReplication><Status>Disabled</Status></DeleteMarkerReplication>
    <Filter><Prefix></Prefix></Filter>
    <Destination><Bucket>arn:aws:s3:::target-bucket</Bucket></Destination>
  </Rule>
</ReplicationConfiguration>`;

const WEBSITE = `<WebsiteConfiguration>
  <IndexDocument><Suffix>index.html</Suffix></IndexDocument>
  <ErrorDocument><Key>error.html</Key></ErrorDocument>
</WebsiteConfiguration>`;

export function BucketSettings({ bucket }: { bucket: string }) {
  return (
    <div className="mx-auto grid max-w-4xl gap-4 p-4">
      <BucketStatsCard bucket={bucket} />
      <div className="grid gap-4 lg:grid-cols-2">
        <VersioningSettings bucket={bucket} />
        <EncryptionSettings bucket={bucket} />
      </div>
      <ObjectLockSettings bucket={bucket} />
      <BucketTagsSettings bucket={bucket} />
      <PolicySettings bucket={bucket} />
      <LifecycleSettings bucket={bucket} />
      <RawConfigSettings
        bucket={bucket}
        resource="cors"
        title="CORS"
        description="Cross-Origin-Zugriff aus Browsern."
        template={CORS}
      />
      <RawConfigSettings
        bucket={bucket}
        resource="notification"
        title="Ereignis-Benachrichtigungen"
        description="Webhooks, Queues oder Lambda bei Objekt-Ereignissen."
        template={NOTIFICATION}
        deletable={false}
      />
      <RawConfigSettings
        bucket={bucket}
        resource="replication"
        title="Replikation"
        description="Objekte automatisch in einen anderen Bucket spiegeln (Versionierung nötig)."
        template={REPLICATION}
      />
      <RawConfigSettings
        bucket={bucket}
        resource="website"
        title="Static Website"
        description="Bucket als Website ausliefern."
        template={WEBSITE}
      />
      <RawConfigSettings
        bucket={bucket}
        resource="acl"
        title="ACL"
        description="Zugriffskontrollliste (nur lesend)."
        readOnly
      />
      <RawConfigSettings
        bucket={bucket}
        resource="location"
        title="Region"
        description="Standort des Buckets."
        readOnly
      />
    </div>
  );
}
