/**
 * Free Tier Limiter
 * 
 * Limits credit assessments per organization based on FREE_DECISIONS_PER_ORG
 */

import { prisma } from '../kyc/prismaHelpers.js';

const FREE_DECISIONS_PER_ORG = parseInt(process.env.FREE_DECISIONS_PER_ORG || '10', 10);

/**
 * Check if org has exceeded free tier limit
 */
export async function checkFreeTierLimit(orgId: string): Promise<{
  allowed: boolean;
  used: number;
  limit: number;
  message?: string;
}> {
  // Count credit assessments for this org
  const count = await prisma.auditEvent.count({
    where: {
      orgId,
      eventType: 'credit_assessment',
    },
  });

  if (count >= FREE_DECISIONS_PER_ORG) {
    return {
      allowed: false,
      used: count,
      limit: FREE_DECISIONS_PER_ORG,
      message: `You have reached the free tier limit of ${FREE_DECISIONS_PER_ORG} credit assessments. Please upgrade your plan to continue.`,
    };
  }

  return {
    allowed: true,
    used: count,
    limit: FREE_DECISIONS_PER_ORG,
  };
}


