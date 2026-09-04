const fs = require('fs');

function atomicWriteFile(file, text) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.copyFileSync(tmp, file);
    try {
      fs.unlinkSync(tmp);
    } catch (err) {
      // ignore
    }
  }
}

function atomicWriteBuffer(file, buf) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, buf);
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.copyFileSync(tmp, file);
    try {
      fs.unlinkSync(tmp);
    } catch (err) {
      // ignore
    }
  }
}

module.exports = {
  atomicWriteFile,
  atomicWriteBuffer
};
