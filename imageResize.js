const sharp = require("sharp");

async function resizeUploadedImage(file) {
  console.log("resizing image");
  await sharp(file.path)
    .resize(640, 480, {
      fit: sharp.fit.cover,
      withoutEnlargement: true,
    })
    .toFile(`${file.filename}`);
  file = { ...file, path: `${file.filename}` };
  return file;
}
exports.resizeUploadedImage = resizeUploadedImage;
