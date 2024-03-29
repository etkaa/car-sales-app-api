require("dotenv").config();
const fs = require("fs");
const S3 = require("aws-sdk/clients/s3");

const bucketName = process.env.AWS_BUCKET_NAME;
const region = process.env.AWS_BUCKET_REGION;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_KEY;

const s3 = new S3({
  region,
  accessKeyId,
  secretAccessKey,
});

///upload file to S3///

const uploadFiles = (resizedFiles, nickname) => {
  return Promise.all(
    resizedFiles.map((file) => {
      const fileStream = fs.createReadStream(file.newPath);

      const uploadParams = {
        Bucket: bucketName,
        Body: fileStream,
        Key: `${nickname + "-" + file.filename}`,
      };

      return s3.upload(uploadParams).promise();
    })
  );
};
exports.uploadFiles = uploadFiles;

///download file from S3///

const getFileStream = async (fileKey) => {
  const downloadParams = {
    Key: fileKey,
    Bucket: bucketName,
  };

  return s3.getObject(downloadParams).createReadStream();
};
exports.getFileStream = getFileStream;

///delete file from S3///

const deleteObjects = async (imageKeysToDelete = []) => {
  // convert array of keys to objects of Key
  const objects = imageKeysToDelete.map((key) => ({ Key: key }));

  const bucketParams = {
    Bucket: bucketName,
    Delete: { Objects: objects },
  };

  return new Promise((resolve, reject) => {
    s3.deleteObjects(bucketParams, function (err, data) {
      if (err) {
        console.log("Error deleting objects from S3", err);
        reject(err);
      } else {
        console.log("Successfully deleted objects from S3");
        resolve(data);
      }
    });
  });
};
exports.deleteObjects = deleteObjects;
