// IDeploymentProvider abstraction — core CMS never talks AWS directly.
// Browser calls the protected deployment service; tools/CI can use LocalFilesystem or the
// AwsS3CloudFront provider via the backend (STS least-privilege, see server/deployment-service).
import { deploymentVersion, hashContent } from '../core/utils/utils.js';

export class LocalFilesystemProvider {
  constructor({ outDir, fs }) { this.outDir = outDir; this.fs = fs; this.name = 'local-filesystem'; }
  async deploy({ files, version }) {
    const { mkdir, writeFile } = this.fs;
    let n = 0;
    for (const [p, content] of files) {
      const full = this.outDir + '/' + p;
      await mkdir(full.split('/').slice(0, -1).join('/'), { recursive: true });
      await writeFile(full, content);
      n++;
    }
    return { ok: true, provider: this.name, version, filesWritten: n, url: 'file://' + this.outDir };
  }
  async rollback() { return { ok: false, error: 'Filesystem provider keeps history in deployments store — restore via backup.' }; }
}

export class AwsS3CloudFrontDeploymentProvider {
  // All secret-bearing operations run in the protected backend. This class only shapes
  // requests: changed-file list, cache behaviors, invalidation paths.
  constructor({ profile, api }) { this.profile = profile; this.api = api; this.name = 'aws-s3-cloudfront'; }
  changedPaths(allChanged) {
    // HTML invalidated individually; fingerprinted assets are immutable (no invalidation needed).
    // Encoded variants (.zst/.br/.gz) are SEPARATE cache objects at the edge — invalidate them too.
    const base = [...new Set((allChanged || []).map((p) => String(p).replace(/\.(br|zst|gz)$/, '')))];
    const urls = base
      .filter((p) => /\.(html|xml|json|txt)$/i.test(p))
      .map((p) => '/' + p.replace(/index\.html$/, '').replace(/^\//, ''));
    const withVariants = [...new Set(urls.flatMap((u) => [u, `${u}.br`, `${u}.zst`, `${u}.gz`]))];
    if (!withVariants.length) return ['/*'];
    return withVariants.slice(0, 96); // stay under the 100-path free invalidation budget
  }
  cacheControlFor(path) {
    const base = String(path).replace(/\.(br|zst|gz)$/, ''); // encoded variant inherits the original's policy
    if (/assets\.[a-f0-9]{6}\./.test(base) || /-[a-f0-9]{6}\.(css|js|webp)$/.test(base)) return 'public,max-age=31536000,immutable';
    if (/\.(html|xml|json)$/.test(base)) return 'public,max-age=300,must-revalidate';
    if (/\.(css|js)$/.test(base)) return 'public,max-age=86400';
    return 'public,max-age=3600';
  }
  async deploy({ files, changed, version, contentHash }) {
    if (!this.api?.post) throw new Error('No deployment-service API configured (offline?).');
    return this.api.post('/api/deploy', {
      profile: publicProfile(this.profile),
      version, contentHash,
      files: changed.map((p) => ({ path: p, cacheControl: this.cacheControlFor(p) })),
      // NOTE: file bodies are streamed by tools/deploy.mjs via presigned URLs; browser sends deltas only.
    });
  }
  async rollback({ version }) {
    if (!this.api?.post) throw new Error('No deployment-service API configured (offline?).');
    return this.api.post('/api/rollback', { profile: publicProfile(this.profile), version });
  }
}

export function publicProfile(profile = {}) {
  // Strip anything secret before it ever leaves the device log/UI.
  const { siteId, domain, bucket, distributionId, region, strategy } = profile;
  return { siteId, domain, bucket, distributionId, region, strategy };
}

export function newDeploymentVersion(date) { return deploymentVersion(date); }

export function buildDeploymentManifest({ siteId, version, contentHash, templateHash, files, deployer }) {
  return {
    deploymentId: `deployment-${version.replace(/\./g, '')}-${hashContent(contentHash + version)}`,
    version, siteId, timestamp: new Date().toISOString(),
    contentHash, templateHash, filesChanged: files.length, files,
    status: 'Success', deployer: deployer || 'local',
  };
}
