import sharp from "sharp";
import { ValidationError } from "@/shared/errors";

export const IMAGE_INPUT_PIXEL_LIMIT = 40_000_000;
export const PHOTO_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function preparePropertyImage(data: Buffer, mime: string) {
  if (!PHOTO_MIMES.has(mime)) throw new ValidationError("Фотографии: только JPEG, PNG или WebP");
  try {
    const image = sharp(data, { limitInputPixels: IMAGE_INPUT_PIXEL_LIMIT, failOn: "warning", animated: false });
    const meta = await image.metadata();
    if (!meta.width || !meta.height || (meta.pages ?? 1) > 1) throw new Error("Unsupported image");
    const oriented = image.rotate();
    const full = mime === "image/png" ? oriented.clone().png() : mime === "image/webp" ? oriented.clone().webp({ quality: 90 }) : oriented.clone().jpeg({ quality: 90 });
    return {
      data: await full.toBuffer(),
      thumbnail: await oriented.clone().resize(480, 320, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer(),
    };
  } catch {
    throw new ValidationError("Изображение повреждено или превышает лимит 40 мегапикселей");
  }
}
