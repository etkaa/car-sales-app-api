const sharp = require("sharp");

async function resizeUploadedImage(file) {
  console.log("resizing image");
  await sharp(file.path)
    .resize(640, 480, {
      fit: sharp.fit.cover,
      withoutEnlargement: true,
    })
    .toFile(`${file.filename}`);
  // Modify the path property of the original file object directly
  // file.path = `${file.filename}`;
  file.newPath = `${file.filename}`;
  // file = { ...file, path: `${file.filename}` };
  return file;
}
exports.resizeUploadedImage = resizeUploadedImage;
