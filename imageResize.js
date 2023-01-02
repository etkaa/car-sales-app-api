const sharp = require("sharp");

async function resizeUploadedImage(file) {
  console.log("resizing image");
  await sharp(file.path)
    .resize(640, 480, {
      fit: sharp.fit.cover,
      withoutEnlargement: true,
    })
    .toFile(`images/${file.filename}`);
  file = { ...file, path: `images/${file.filename}` };
  return file;
}
exports.resizeUploadedImage = resizeUploadedImage;
