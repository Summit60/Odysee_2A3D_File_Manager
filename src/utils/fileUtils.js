const fs = require('fs');
const path = require('path');
const axios = require('axios');

/**
 * Organizes files into a folder structure based on developer and file name.
 * @param {string} baseFolder - Base folder for file storage.
 * @param {string} devName - Developer's name.
 * @param {string} fileName - File name.
 * @returns {string} - Full path of the organized file.
 */
function organizeFiles(baseFolder, devName, fileName) {
    const devFolder = path.join(baseFolder, sanitizeName(devName));
    if (!fs.existsSync(devFolder)) {
        fs.mkdirSync(devFolder, { recursive: true });
    }
    return path.join(devFolder, sanitizeName(fileName));
}

/**
 * Sanitizes a name to ensure it's file system-safe.
 * @param {string} name - Name to sanitize.
 * @returns {string} - Sanitized name.
 */
function sanitizeName(name) {
    return name.replace(/[<>:"/\\|?*]/g, '_'); // Replace invalid characters with underscores
}

/**
 * Checks if a file exists at the specified path.
 * @param {string} filePath - Path of the file to check.
 * @returns {boolean} - True if the file exists, false otherwise.
 */
function fileExists(filePath) {
    return fs.existsSync(filePath);
}

module.exports = {
    deleteFile,

};
