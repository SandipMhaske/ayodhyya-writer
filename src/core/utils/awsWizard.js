// AWS setup-wizard logic — pure validation + CloudFormation param/command builders.
// No DOM, no network: the UI renders the 10 steps (spec §51), tests cover everything here.
// Secrets are NEVER part of this module: tokens/keys live in backend env only.
export const AWS_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-central-1',
  'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1',
  'sa-east-1', 'af-south-1', 'me-south-1',
];

const fail = (error) => ({ ok: false, error });
const pass = (warning) => ({ ok: true, ...(warning ? { warning } : {}) });

export function validateBucket(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return fail('Bucket name is required.');
  if (s.length < 3 || s.length > 63) return fail('Bucket names are 3–63 characters.');
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(s)) return fail('Lowercase letters, digits, dots, hyphens; must start/end alphanumeric.');
  if (s.includes('..') || s.includes('-.') || s.includes('.-')) return fail('No adjacent dots/hyphens.');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return fail('Must not look like an IP address.');
  return pass();
}

export function validateRegion(v) {
  const s = String(v || '').trim();
  if (!s) return fail('Region is required.');
  if (!/^[a-z]{2}-[a-z-]+-\d$/.test(s)) return fail('Not an AWS region format (e.g. ap-south-1).');
  if (!AWS_REGIONS.includes(s)) return pass(`Uncommon region — verify it supports S3 + ACM: ${s}.`);
  return pass();
}

export function validateDomain(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return fail('Domain is required.');
  if (s.includes('://')) return fail('Domain only, no protocol (no https://).');
  if (s.length > 253) return fail('Domain too long.');
  if (!/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,}$/.test(s)) return fail('Not a valid hostname (e.g. www.ayodhyya.com).');
  return pass();
}

export function validateDistributionId(v) {
  const s = String(v || '').trim();
  if (!s) return pass('No distribution yet — create one from the template first, then return here.');
  if (!/^[A-Z0-9]{13,14}$/.test(s)) return fail('Distribution IDs look like E1234567890ABC (13–14 uppercase alphanumerics).');
  return pass();
}

export function validateAcmArn(v) {
  const s = String(v || '').trim();
  if (!s) return pass('No certificate yet — request one in ACM (us-east-1) first.');
  if (!/^arn:aws:acm:us-east-1:\d{12}:certificate\/[0-9a-f-]{36}$/i.test(s)) return fail('Must be a us-east-1 ACM certificate ARN (CloudFront requirement).');
  return pass();
}

export function validateAccountId(v) {
  const s = String(v || '').trim();
  if (!s) return fail('AWS account ID is required.');
  if (!/^\d{12}$/.test(s)) return fail('Account ID is exactly 12 digits.');
  return pass();
}

export function validateHostedZoneId(v, { required = false } = {}) {
  const s = String(v || '').trim().toUpperCase();
  if (!s) return required ? fail('Hosted zone ID is required when creating the DNS record.') : pass('Skipped — point external DNS at the CloudFront domain instead.');
  if (!/^[A-Z0-9]{10,32}$/.test(s)) return fail('Zone IDs look like Z2FDTNDATAQYW2.');
  return pass();
}

export function defaultBucketFor(domain) {
  return String(domain || '').trim().toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') + '-site';
}

export function buildProfile(input = {}) {
  const errors = [];
  const check = (field, result) => { if (!result.ok) errors.push({ field, message: result.error }); return result; };
  const domain = String(input.domain || '').trim().toLowerCase();
  const bucket = String(input.bucket || (domain ? defaultBucketFor(domain) : '')).trim().toLowerCase();
  const region = String(input.region || 'ap-south-1').trim();
  check('domain', validateDomain(domain));
  check('bucket', validateBucket(bucket));
  check('region', validateRegion(region));
  const dist = check('distributionId', validateDistributionId(input.distributionId));
  const cert = check('certificate', validateAcmArn(input.acmArn));
  if (input.accountId != null && String(input.accountId).trim() !== '') check('accountId', validateAccountId(input.accountId));
  if (input.createDns !== false) check('hostedZoneId', validateHostedZoneId(input.hostedZoneId, { required: true }));
  const profile = {
    siteId: input.siteId || '', domain, bucket,
    distributionId: String(input.distributionId || '').trim(),
    region, strategy: 'atomic-s3-cloudfront',
    createDns: input.createDns !== false,
    hostedZoneId: String(input.hostedZoneId || '').trim().toUpperCase(),
  };
  return { profile, errors, warnings: [dist.warning, cert.warning].filter(Boolean) };
}

export function cfnDeployCommand({ stackName = 'ayodhyya-site', template = 'infra/cloudformation/static-site.yaml', profile = {}, acmArn = '', enableWaf = false } = {}) {
  const params = {
    DomainName: profile.domain || '',
    HostedZoneId: profile.hostedZoneId || '',
    AcmCertificateArn: acmArn,
    EnableWAF: enableWaf ? 'true' : 'false',
    CreateDnsRecord: profile.createDns === false ? 'false' : 'true',
  };
  const overrides = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}="${v}"`).join(' ');
  return `aws cloudformation deploy --stack-name ${stackName} --template-file ${template} --capabilities CAPABILITY_IAM${overrides ? ` --parameter-overrides ${overrides}` : ''}`;
}
