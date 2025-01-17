const { BlobServiceClient } = require("@azure/storage-blob");
const crypto = require("crypto");
const Jimp = require("jimp");

module.exports = {
  async uploadImageToAzure(file, filename, type, userId, context) {
    if (type !== "image/jpeg" && type !== "image/png") {
      const error = new Error(
        "Invalid file type. Only JPEG and PNG files are allowed."
      );
      error.status = 415;
      throw error;
    }

    const blobServiceClient = BlobServiceClient.fromConnectionString(
      process.env.AZURE_STORAGE_CONNECTION_STRING
    );
    const containerClient = blobServiceClient.getContainerClient(
      process.env.AZURE_STORAGE_CONTAINER_NAME
    );
    const random_str = crypto.randomBytes(5).toString("hex");
    const new_file_url = `${userId}-${random_str}.png`;
    const blockBlobClient = containerClient.getBlockBlobClient(new_file_url);
    console.log("file", file);
    console.log("Jimp", Jimp);

    const image = await Jimp.read(file);
    const resizedImage = image.resize(250, Jimp.AUTO);
    const resizedImageBuffer = await resizedImage.getBufferAsync(Jimp.MIME_PNG);

    const uploadOptions = {
      blobHTTPHeaders: {
        blobContentType: type,
      },
    };

    await blockBlobClient.uploadData(resizedImageBuffer, uploadOptions);

    return `${process.env.AZURE_STORAGE_CDN_URL}${blockBlobClient._containerName}/${blockBlobClient._name}`;
  },
};
