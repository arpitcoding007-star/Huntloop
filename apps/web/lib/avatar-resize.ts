import { AVATAR_EDGE, AVATAR_MAX_LENGTH } from "./avatar";

/** Larger files are refused before decoding: a phone photo is a few MB. */
export const AVATAR_MAX_FILE_BYTES = 15 * 1024 * 1024;

/**
 * A chosen picture as the JPEG data URL `savePictureAction` accepts: cropped
 * to the centred square, drawn at 256×256 and re-encoded, which drops EXIF
 * (location, camera, date) along with everything else outside the pixels.
 * The server strips metadata again, because it cannot rely on this running.
 *
 * Browser only: needs `createImageBitmap` and a canvas.
 */
export async function resizeToAvatar(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp|gif|avif|heic|heif)$/i.test(file.type)) {
    throw new Error("Choose a JPEG, PNG or WebP picture.");
  }
  if (file.size > AVATAR_MAX_FILE_BYTES) throw new Error("That file is over 15 MB. Choose a smaller picture.");

  let bitmap: ImageBitmap;
  try {
    /* `from-image` applies the EXIF orientation before it is discarded, so a
       portrait phone photo is not stored on its side. */
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("That picture could not be read. Try a JPEG or PNG.");
  }

  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_EDGE;
  canvas.height = AVATAR_EDGE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot prepare the picture.");
  /* JPEG has no transparency: a transparent PNG would otherwise turn black. */
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, AVATAR_EDGE, AVATAR_EDGE);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_EDGE, AVATAR_EDGE);
  bitmap.close();

  for (const quality of [0.86, 0.75, 0.62, 0.5]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= AVATAR_MAX_LENGTH) return url;
  }
  throw new Error("That picture is too detailed to store. Try another.");
}
