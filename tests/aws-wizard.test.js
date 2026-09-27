import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBucket, validateRegion, validateDomain, validateDistributionId,
  validateAcmArn, validateAccountId, validateHostedZoneId,
  defaultBucketFor, buildProfile, cfnDeployCommand,
} from '../src/core/utils/awsWizard.js';

describe('wizard validators', () => {
  it('accepts good values', () => {
    assert.ok(validateBucket('ayodhyya-prod-site').ok);
    assert.ok(validateRegion('ap-south-1').ok);
    assert.ok(validateDomain('www.ayodhyya.com').ok);
    assert.ok(validateDistributionId('E1234567890ABC').ok);
    assert.ok(validateDistributionId('').ok, 'distribution optional');
    assert.ok(validateAcmArn('arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012').ok);
    assert.ok(validateAccountId('123456789012').ok);
    assert.ok(validateHostedZoneId('Z2FDTNDATAQYW2', { required: true }).ok);
  });
  it('rejects bad values with actionable messages', () => {
    assert.match(validateBucket('Bad_Name!').error, /Lowercase/);
    assert.match(validateBucket('192.168.0.1').error, /IP/);
    assert.match(validateRegion('moon-1').error, /format/);
    assert.ok(validateRegion('xx-new-9').warning, 'unknown-but-plausible region warns');
    assert.match(validateDomain('https://x.com').error, /protocol/);
    assert.match(validateDistributionId('abc').error, /E123/);
    assert.match(validateAcmArn('arn:aws:acm:eu-west-1:1:certificate/x').error, /us-east-1/);
    assert.match(validateAccountId('123').error, /12 digits/);
    assert.match(validateHostedZoneId('', { required: true }).error, /required/);
    assert.ok(validateHostedZoneId('', {}).ok, 'zone optional when external DNS');
  });
});

describe('profile + command builders', () => {
  it('builds a profile with defaults and collects errors', () => {
    const { profile, errors } = buildProfile({ siteId: 's1', domain: 'www.ayodhyya.com', region: 'ap-south-1', hostedZoneId: 'Z2FDTNDATAQYW2' });
    assert.equal(errors.length, 0);
    assert.equal(profile.bucket, 'ayodhyya-com-site');
    assert.equal(profile.strategy, 'atomic-s3-cloudfront');
    const bad = buildProfile({ domain: 'not a domain', bucket: 'Bad_Name!', region: 'x', createDns: true, hostedZoneId: '' });
    assert.ok(bad.errors.length >= 4, 'one error per bad field');
    assert.ok(bad.errors.some((e) => e.field === 'domain'));
  });
  it('renders a deploy command with only filled params', () => {
    const cmd = cfnDeployCommand({ profile: { domain: 'www.ayodhyya.com', hostedZoneId: '', createDns: false }, acmArn: '' });
    assert.match(cmd, /aws cloudformation deploy/);
    assert.match(cmd, /DomainName="www\.ayodhyya\.com"/);
    assert.match(cmd, /CreateDnsRecord="false"/);
    assert.ok(!cmd.includes('HostedZoneId'), 'empty params omitted');
    assert.ok(!cmd.includes('EnableWAF="true"'), 'WAF stays off by default');
  });
  it('defaults bucket from domain', () => {
    assert.equal(defaultBucketFor('WWW.Example.COM'), 'example-com-site');
  });
});
