import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { preparePropertyImage, IMAGE_INPUT_PIXEL_LIMIT } from "@/modules/documents/domain/property-image";
import { validateUpload } from "@/modules/documents/domain/file-policy";

describe("property images", () => {
  it("validates signatures, forbidden formats and byte limits", () => {
    expect(validateUpload("a.jpg", Buffer.from("<svg/>"), ["jpg"], 100)).toHaveProperty("error");
    expect(validateUpload("a.svg", Buffer.from("<svg/>"), ["svg"], 100)).toHaveProperty("error");
    expect(validateUpload("a.html", Buffer.from("<html/>"), ["html"], 100)).toHaveProperty("error");
    expect(validateUpload("a.txt", Buffer.alloc(101), ["txt"], 100)).toHaveProperty("error");
  });
  it("removes EXIF including GPS by re-encoding full image and thumbnail", async () => {
    const original = await sharp({ create: { width: 100, height: 80, channels: 3, background: "red" } }).jpeg().withExif({ IFD0: { Artist: "Synthetic test" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "55/1 1/1 0/1" } }).toBuffer();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const out = await preparePropertyImage(original, "image/jpeg");
    for (const data of [out.data, out.thumbnail]) {
      const meta = await sharp(data).metadata();
      expect(meta.exif).toBeUndefined(); expect(meta.xmp).toBeUndefined(); expect(meta.iptc).toBeUndefined();
    }
    expect((await sharp(out.thumbnail).metadata()).format).toBe("webp");
  });
  it("rejects an image exceeding limitInputPixels before decoding", async () => {
    const oversized = await sharp({ create: { width: 6400, height: 6400, channels: 3, background: "white" } }).png().toBuffer();
    expect(6400 * 6400).toBeGreaterThan(IMAGE_INPUT_PIXEL_LIMIT);
    await expect(preparePropertyImage(oversized, "image/png")).rejects.toThrow("40 мегапикселей");
  });
  it("rejects SVG, HTML and truncated raster data", async () => {
    await expect(preparePropertyImage(Buffer.from("<svg/>"), "image/svg+xml")).rejects.toThrow();
    await expect(preparePropertyImage(Buffer.from("<html/>"), "text/html")).rejects.toThrow();
    await expect(preparePropertyImage(Buffer.from([255, 216, 255]), "image/jpeg")).rejects.toThrow();
  });
});
