/** Longest edge sent to the recognition: enough detail for food, and keeps the upload and the API cost small. */
const MAX_EDGE = 1568;

/**
 * Reads a photo picked from the camera or the library and returns it as a resized JPEG in base64 (no data: prefix).
 * The browser applies the EXIF orientation when it draws the image, so portrait photos stay upright.
 */
export async function photoForRecognition(file: File): Promise<{ mediaType: "image/jpeg"; data: string; previewUrl: string }> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("unreadable image"));
      img.src = url;
    });
    const ratio = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.round(image.naturalWidth * ratio);
    const height = Math.round(image.naturalHeight * ratio);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    context.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return { mediaType: "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1), previewUrl: dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}
