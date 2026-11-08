import { AwsClient } from 'aws4fetch';
import { getMyGarageEnv } from '../config/env';
import { isObjectIdHex } from '../../utils/ids';
import { isFileId } from './ids';

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

/** Every R2 caller builds its key here, so a crafted id can never reach another user's object or the bucket root. */
export const objectKey = (userId: string, fileId: string): string => {
  if (!isObjectIdHex(userId) || !isFileId(fileId)) throw new Error('Invalid object key parts');
  return `u/${userId}/${fileId}`;
};

const presign = async (method: 'PUT' | 'GET', key: string, ttlSeconds: number, headers?: Record<string, string>): Promise<string> =>
  (await aws().sign(`${objectUrl(key)}?X-Amz-Expires=${ttlSeconds}`, { method, headers, aws: { signQuery: true, allHeaders: true } })).url;

// The phone must send exactly this Content-Length on the PUT, or R2 rejects the signature.
// It is the ciphertext size declared at upload-url.
export const presignPut = (key: string, ttlSeconds: number, size: number): Promise<string> =>
  presign('PUT', key, ttlSeconds, { 'content-length': String(size) });
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
