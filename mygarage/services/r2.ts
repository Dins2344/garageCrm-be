import { AwsClient } from 'aws4fetch';
import { getMyGarageEnv } from '../config/env';

let client: AwsClient | null = null;
const aws = (): AwsClient => {
  if (!client) {
    const { accessKeyId, secretAccessKey } = getMyGarageEnv().r2;
    client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
  }
  return client;
};

const objectUrl = (key: string): string => {
  const { accountId, bucket } = getMyGarageEnv().r2;
  return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`;
};

export const objectKey = (userId: string, fileId: string): string => `u/${userId}/${fileId}`;

const presign = async (method: 'PUT' | 'GET', key: string, ttlSeconds: number): Promise<string> =>
  (await aws().sign(`${objectUrl(key)}?X-Amz-Expires=${ttlSeconds}`, { method, aws: { signQuery: true } })).url;

export const presignPut = (key: string, ttlSeconds: number): Promise<string> => presign('PUT', key, ttlSeconds);
export const presignGet = (key: string, ttlSeconds: number): Promise<string> => presign('GET', key, ttlSeconds);

/** Size in bytes, or null when the object does not exist. Throws on any other failure. */
export const headObjectSize = async (key: string): Promise<number | null> => {
  const res = await aws().fetch(objectUrl(key), { method: 'HEAD' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 HEAD failed with status ${res.status}`);
  return Number(res.headers.get('content-length'));
};

/** A missing object counts as deleted. Throws on any other failure. */
export const deleteObject = async (key: string): Promise<void> => {
  const res = await aws().fetch(objectUrl(key), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE failed with status ${res.status}`);
};
