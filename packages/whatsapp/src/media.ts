/** True when the bytes start with a WebP header ("RIFF" ... "WEBP"). */
export function isWebp(buf: Uint8Array): boolean {
  if (buf.length < 12) {
    return false;
  }
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...buf.subarray(from, to));
  return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
}
