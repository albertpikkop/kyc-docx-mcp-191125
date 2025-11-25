/**
 * S3/R2 Storage for Report Uploads
 * 
 * Uploads HTML reports to S3-compatible storage (AWS S3 or Cloudflare R2)
 * and returns signed URLs valid for 7 days.
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// S3 configuration from environment variables
const s3Config = {
  endpoint: process.env.S3_ENDPOINT || process.env.R2_ENDPOINT, // R2 endpoint if using Cloudflare
  region: process.env.S3_REGION || 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
  },
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true', // Required for R2
};

const BUCKET_NAME = process.env.S3_BUCKET_NAME || process.env.R2_BUCKET_NAME || 'kyc-reports';
const SIGNED_URL_EXPIRY = 7 * 24 * 60 * 60; // 7 days in seconds

// Initialize S3 client
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    // Validate required config
    if (!s3Config.credentials.accessKeyId || !s3Config.credentials.secretAccessKey) {
      throw new Error('S3 credentials not configured. Set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY environment variables.');
    }
    
    s3Client = new S3Client(s3Config);
  }
  return s3Client;
}

/**
 * Upload HTML report to S3/R2 and return signed URL
 * 
 * @param html - HTML content of the report
 * @param customerId - Customer identifier
 * @param runId - Run identifier
 * @returns Signed URL valid for 7 days
 */
export async function uploadReport(
  html: string,
  customerId: string,
  runId: string
): Promise<string> {
  const client = getS3Client();
  
  // Generate S3 key: reports/{customerId}/report-{runId}.html
  const key = `reports/${customerId}/report-${runId}.html`;
  
  // Content type
  const contentType = 'text/html; charset=utf-8';
  
  // Upload to S3
  const putCommand = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: html,
    ContentType: contentType,
    CacheControl: 'public, max-age=3600', // Cache for 1 hour
  });
  
  try {
    await client.send(putCommand);
    
    // Generate signed URL for reading (valid for 7 days)
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });
    
    const signedUrl = await getSignedUrl(client, getCommand, {
      expiresIn: SIGNED_URL_EXPIRY,
    });
    
    return signedUrl;
  } catch (error: any) {
    console.error(`Failed to upload report to S3:`, error);
    throw new Error(`S3 upload failed: ${error?.message || 'Unknown error'}`);
  }
}

/**
 * Get signed URL for an existing report
 * 
 * @param customerId - Customer identifier
 * @param runId - Run identifier
 * @returns Signed URL valid for 7 days, or null if report doesn't exist
 */
export async function getReportSignedUrl(
  customerId: string,
  runId: string
): Promise<string | null> {
  const client = getS3Client();
  
  const key = `reports/${customerId}/report-${runId}.html`;
  
  try {
    // Generate signed URL
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });
    
    const signedUrl = await getSignedUrl(client, getCommand, {
      expiresIn: SIGNED_URL_EXPIRY,
    });
    
    return signedUrl;
  } catch (error: any) {
    // If object doesn't exist, return null
    if (error?.name === 'NoSuchKey' || error?.Code === 'NoSuchKey') {
      return null;
    }
    console.error(`Failed to get signed URL for report:`, error);
    throw new Error(`Failed to get signed URL: ${error?.message || 'Unknown error'}`);
  }
}

/**
 * Check if S3 storage is configured
 */
export function isS3Configured(): boolean {
  return !!(
    s3Config.credentials.accessKeyId &&
    s3Config.credentials.secretAccessKey &&
    BUCKET_NAME
  );
}

