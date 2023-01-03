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

const uploadFiles = (files) => {
  return Promise.all(
    files.map((file) => {
      const fileStream = fs.createReadStream(file.newPath);

      const uploadParams = {
        Bucket: bucketName,
        Body: fileStream,
        Key: file.filename,
      };

      return s3.upload(uploadParams).promise();
    })
  );
};
// exports.uploadFiles = uploadFiles;

//download file from S3
const getFileStream = (fileKey) => {
  const downloadParams = {
    Key: fileKey,
    Bucket: bucketName,
  };

  return s3.getObject(downloadParams).createReadStream();
};
// exports.getFileStream = getFileStream;

const deleteObjects = async (imageKeysToDelete = []) => {
  // convert array of keys to objects of Key
  const objects = imageKeysToDelete.map((key) => ({ Key: key }));

  const bucketParams = {
    Bucket: bucketName,
    Delete: { Objects: objects },
  };

  try {
    // const data = await s3Client.send(new DeleteObjectsCommand(bucketParams));
    const data = s3.deleteObjects(bucketParams, function (err, data) {
      if (err) console.log(err, err.stack);
      // an error occurred
      else console.log(data); // successful response
    });
    return data; // For unit tests.
    console.log("Success. Object deleted.");
  } catch (err) {
    console.log("Error", err);
  }
};
// exports.deleteObjects = deleteObjects;

module.exports = {
  uploadFiles,
  getFileStream,
  deleteObjects,
};
