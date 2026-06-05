// QR generation, fully client-side (no external QR service). Uses the `qrcode`
// library's ESM build from jsDelivr. The QR encodes the join deep-link, so it
// updates dynamically whenever the game code changes.
let QRCodeLib = null;

async function lib() {
  if (!QRCodeLib) {
    QRCodeLib = await import("https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm");
  }
  return QRCodeLib;
}

/** Render `text` as a QR code into the given canvas element. */
export async function drawQR(canvas, text, size = 280) {
  const QR = await lib();
  await QR.toCanvas(canvas, text, {
    width: size,
    margin: 1,
    color: { dark: "#0f172a", light: "#ffffff" },
    errorCorrectionLevel: "M",
  });
}
