import Scraper from 'real-estate-scrapper';
import sharp from 'sharp';
async function main() {
  const scraper = await Scraper.create({ browser: true });
  await scraper.close();
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).webp().toBuffer();
  console.log(JSON.stringify({ event: 'container.smoke_ok', node: process.version,
    platform: process.platform, arch: process.arch, sharp: sharp.versions.sharp, webpBytes: image.length,
    chrome: process.env.SCRAPER_CHROME_PATH }));
}
main().catch(() => { console.error(JSON.stringify({ event: 'container.smoke_failed' })); process.exitCode = 1; });
