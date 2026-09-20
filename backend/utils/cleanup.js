const fs = require('fs');

function cleanupFile(filePath) {
    fs.unlink(filePath, (err) => {
        if (err) {
            console.error('Cleanup Error:', err.message);
        }
    });
}

module.exports = cleanupFile;